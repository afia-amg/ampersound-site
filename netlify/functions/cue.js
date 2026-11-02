'use strict';
// Live Cue Sheet: coordinator credentials are accepted only in Authorization headers.
// V2 is mandatory. The legacy CUE_SECRET is never used as a fallback.
//
// Show-day safety model:
// - Vendor check-ins, alerts, and alert acknowledgments are append-only ClickUp comments.
//   They are derived on every read and never rewritten, so they cannot be lost to a race.
// - Only show-flow actions (GO, finish, undo, reset, clock mode) and the pre-show check
//   write the Cue State field. Show-flow actions carry the console's `rev`; a stale console
//   gets 409 plus the current state instead of silently overwriting another device.
// - Each reset or switch to Show day starts a new `session`. Everything before `since` is
//   rehearsal and is ignored: GOs, check-ins and alerts never leak into the real show.
// - Show day cannot start until every pre-show check item is ticked.
// - Coordinator broadcasts and each vendor's "Got it" are append-only comments too, so the
//   console always knows who has (and hasn't) seen a message to everyone.
// - The show-day point of contact (planner or day-of coordinator) comes from the event task's
//   "Point of Contact" + "Point of Contact Phone" fields, so it can change per event without a deploy.
// - Close out ends the show: it needs Show day and every alert resolved, freezes show-flow
//   actions, moves the ClickUp task to WRAPPED, and swaps each vendor page for a thank-you
//   with the Google review link. That page hides the timeline and phone numbers, and the
//   link turns itself off CLOSED_LINK_DAYS later. Reopen undoes a close out made by mistake.
const crypto = require('crypto');
const { EVENTS } = require('./_cue-events');

const BASE = 'https://api.clickup.com/api/v2';
const STATE_FIELD = '745508ca-6e71-4541-8d49-a10a9acab836';
const CONTACT_NAME = '18983b32-756c-49a7-8b37-855b528d8e45';
const CONTACT_PHONE = '666ee8c5-587c-42cf-86f0-a9d2ba20534a';
const MARK = 'AMG_CUE_V1:';
const READY = ['timeline', 'caller', 'contacts', 'links', 'signal', 'printed'];
const FLOW = ['go', 'finish', 'undo', 'reset', 'mode', 'closeout', 'reopen'];
const REVIEW_URL = 'https://g.page/r/Cd1Ctsiv6egXEAE/review';
const CLOSED_LINK_DAYS = 30;
const WRAPPED = 'wrapped';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const reply = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { Authorization: process.env.CLICKUP_API_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw Error('ClickUp request failed: ' + r.status);
  return r.json();
}
function tokenFor(slug, vendor) {
  return crypto.createHmac('sha256', process.env.CUE_SECRET_V2).update(`${slug}:${vendor.id}:${vendor.rev || 1}`).digest('base64url').slice(0, 16);
}
function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function vendorByToken(slug, ev, token) {
  return ev.vendors.find((v) => same(tokenFor(slug, v), token)) || null;
}
function isCoordinator(key) {
  return !!key && same(key, process.env.CUE_SECRET_V2);
}
function wallMinutes(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (k) => Number((parts.find((p) => p.type === k) || {}).value || 0);
  return get('hour') * 60 + get('minute') + get('second') / 60;
}
function showMinutes(state, ev, ms) {
  if (state.mode === 'live') return wallMinutes(ms, ev.tz);
  if (!state.anchor) return null;
  return state.anchor.show + (ms - state.anchor.real) / 60000;
}
function fmt(min) {
  if (min == null) return '';
  const m = ((Math.round(min) % 1440) + 1440) % 1440, h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${h % 12 || 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
}
const blank = () => ({ v: 1, mode: 'practice', anchor: null, calls: {}, done: {}, checkins: {}, seen: [], rev: 0, session: 1, since: 0, ready: {}, closed: null });
function readState(task) {
  const f = (task.custom_fields || []).find((x) => x.id === STATE_FIELD);
  let d = null;
  try { d = f && f.value ? JSON.parse(f.value) : null; } catch (_) { d = null; }
  const s = d && typeof d === 'object' && !Array.isArray(d) ? { ...blank(), ...d } : blank();
  for (const k of ['calls', 'done', 'checkins', 'ready']) if (!s[k] || typeof s[k] !== 'object') s[k] = {};
  s.rev = Number(s.rev) || 0; s.session = Number(s.session) || 1; s.since = Number(s.since) || 0;
  if (!s.closed || typeof s.closed !== 'object' || !Number(s.closed.at)) s.closed = null;
  return s;
}
async function writeState(taskId, state) {
  state.updatedAt = Date.now();
  state.seen = [];
  await api('/task/' + encodeURIComponent(taskId) + '/field/' + STATE_FIELD, { method: 'POST', body: JSON.stringify({ value: JSON.stringify(state) }) });
}
// Normalise a ClickUp phone value ("+1 801 555 0100", "(801) 555-0100") to E.164 plus a readable label.
function phoneOf(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(d)) d = '+1' + d; else if (/^1\d{10}$/.test(d)) d = '+' + d;
  if (!/^\+\d{10,15}$/.test(d)) return null;
  const us = d.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return { phone: d, phoneLabel: us ? `(${us[1]}) ${us[2]}-${us[3]}` : d };
}
// Point of contact for this event, from ClickUp. Blank fields fall back to the event's default.
// A name without a phone never borrows the default phone, so vendors never call the wrong person.
function withContact(ev, task) {
  const val = (id) => { const f = (task.custom_fields || []).find((x) => x.id === id); return f && f.value != null ? String(f.value).trim() : ''; };
  const name = val(CONTACT_NAME).slice(0, 60), tel = phoneOf(val(CONTACT_PHONE));
  if (!name && !tel) return ev;
  const coordinator = { name: name || ev.coordinator.name, phone: '', phoneLabel: '' };
  if (tel) Object.assign(coordinator, tel);
  else if (!name) Object.assign(coordinator, { phone: ev.coordinator.phone, phoneLabel: ev.coordinator.phoneLabel });
  return { ...ev, coordinator };
}
const cache = new Map();
async function loadTask(taskId, fresh) {
  const hit = cache.get(taskId);
  if (!fresh && hit && Date.now() - hit.at < 4000) return hit;
  const [task, comments] = await Promise.all([api('/task/' + encodeURIComponent(taskId)), api('/task/' + encodeURIComponent(taskId) + '/comment')]);
  const entry = { at: Date.now(), task, comments: comments.comments || [] };
  cache.set(taskId, entry);
  return entry;
}
function events(comments) {
  const out = [];
  for (const c of comments) {
    const text = String(c.comment_text || '');
    const i = text.indexOf(MARK);
    if (i < 0) continue;
    try {
      const e = JSON.parse(text.slice(i + MARK.length).trim().split('\n')[0]);
      if (e && e.id && e.type) out.push(e);
    } catch (_) { /* not ours */ }
  }
  return out.sort((a, b) => a.at - b.at);
}
// Everything the show knows that came from comments, for the current session only.
function derive(state, evs) {
  const cur = evs.filter((e) => Number(e.at) >= state.since);
  const checkins = {};
  for (const e of cur) if (e.type === 'checkin' && !checkins[e.vendor]) checkins[e.vendor] = { at: e.at, show: e.show };
  const status = {};
  for (const e of cur) {
    if ((e.type !== 'ack' && e.type !== 'resolve') || !e.ref) continue;
    const st = status[e.ref] || (status[e.ref] = { ack: null, resolved: null });
    if (!st.ack) st.ack = { at: e.at, by: e.by };
    if (e.type === 'resolve' && !st.resolved) st.resolved = { at: e.at, by: e.by };
  }
  const alerts = cur.filter((e) => e.type === 'alert').map((a) => ({ ...a, ack: (status[a.id] || {}).ack || null, resolved: (status[a.id] || {}).resolved || null }));
  const got = {};
  for (const e of cur) {
    if (e.type !== 'gotit' || !e.ref || !e.vendor) continue;
    const g = got[e.ref] || (got[e.ref] = {});
    if (!g[e.vendor]) g[e.vendor] = e.at;
  }
  const broadcasts = cur.filter((e) => e.type === 'broadcast').map((b) => ({ id: b.id, at: b.at, show: b.show, level: b.level, text: b.text, by: b.by, to: b.to || null, gotIt: got[b.id] || {} }));
  // Who tapped the Google review link since the latest close out. A tap is not proof a review was posted.
  const reviewTaps = {};
  if (state.closed) for (const e of evs) if (e.type === 'reviewtap' && e.vendor && Number(e.at) >= state.closed.at && !reviewTaps[e.vendor]) reviewTaps[e.vendor] = e.at;
  state.checkins = checkins;
  return { alerts, broadcasts, reviewTaps };
}
function publicMoment(m) {
  return { id: m.id, time: m.time, dur: m.dur, title: m.title, location: m.location || '', lane: m.lane || null, vendors: m.vendors || [], notes: m.notes || '' };
}
function basics(slug, ev) {
  return { slug, name: ev.name, kind: ev.kind, dateLabel: ev.dateLabel, venue: ev.venue, tz: ev.tz, lanes: ev.lanes, coordinator: ev.coordinator };
}
function liveView(state) {
  return { mode: state.mode, anchor: state.anchor, calls: state.calls, done: state.done, rev: state.rev, session: state.session, since: state.since, updatedAt: state.updatedAt || null, closed: state.closed };
}
const reviewUrl = (ev) => ev.reviewUrl || REVIEW_URL;
const linkExpired = (state, now) => !!state.closed && now - state.closed.at > CLOSED_LINK_DAYS * 864e5;
// After close out a vendor only gets a thank-you and the review link: no timeline, no phone numbers, no messages.
function closedVendorView(slug, ev, v, state, reviewTaps, now) {
  return {
    ok: true, now, closed: { at: state.closed.at, until: state.closed.at + CLOSED_LINK_DAYS * 864e5 },
    event: { slug, name: ev.name, kind: ev.kind, dateLabel: ev.dateLabel, venue: ev.venue, tz: ev.tz },
    vendor: { id: v.id, name: v.name, role: v.role }, review: { url: reviewUrl(ev), tapped: !!reviewTaps[v.id] },
  };
}
function vendorView(slug, ev, v, state, alerts, broadcasts, now) {
  // Messages to everyone, plus messages sent only to this vendor. Never another vendor's direct message.
  const toAll = broadcasts.filter((b) => !b.to || b.to === v.id).slice(-5).reverse()
    .map((b) => ({ id: b.id, at: b.at, show: b.show, level: b.level, text: b.text, by: b.by, direct: !!b.to, gotIt: !!b.gotIt[v.id] }));
  const mine = alerts.filter((a) => a.vendor === v.id).slice(-5).reverse()
    .map((a) => ({ id: a.id, at: a.at, show: a.show, level: a.level, text: a.text, ack: !!a.ack, ackAt: a.ack ? a.ack.at : null, resolved: !!a.resolved }));
  return {
    ok: true, now, event: basics(slug, ev),
    vendor: { id: v.id, name: v.name, role: v.role, arrival: v.arrival, checkedIn: state.checkins[v.id] || null },
    moments: ev.moments.map((m) => (m.vendors.includes(v.id) ? publicMoment(m) : { id: m.id, time: m.time, dur: m.dur, title: m.title, lane: m.lane || null, vendors: [] })),
    roles: Object.fromEntries(ev.vendors.map((x) => [x.id, x.role])), state: liveView(state), myAlerts: mine, broadcasts: toAll,
  };
}
function coordinatorView(slug, ev, state, alerts, broadcasts, now, origin, reviewTaps) {
  return {
    closed: state.closed, review: { url: reviewUrl(ev), tapped: Object.keys(reviewTaps || {}) }, linksOffAt: state.closed ? state.closed.at + CLOSED_LINK_DAYS * 864e5 : null,
    ok: true, now, event: basics(slug, ev), moments: ev.moments.map(publicMoment), ready: READY.filter((k) => state.ready[k]),
    vendors: ev.vendors.map((v) => ({ id: v.id, name: v.name, role: v.role, contact: v.contact || '', arrival: v.arrival, checkedIn: state.checkins[v.id] || null, link: `${origin}/cue/${slug}/${tokenFor(slug, v)}` })),
    alerts: alerts.slice(-30).reverse(), state: liveView(state),
    broadcasts: broadcasts.slice(-10).reverse().map((b) => ({ ...b, gotIt: ev.vendors.filter((v) => b.gotIt[v.id]).map((v) => v.id) })),
  };
}
function go(state, ev, m, now) {
  if (state.mode !== 'live' && !state.anchor) state.anchor = { real: now, show: m.time };
  const show = showMinutes(state, ev, now);
  const closed = [];
  for (const other of ev.moments) {
    if ((other.lane || null) !== (m.lane || null) || other.id === m.id) continue;
    if (state.calls[other.id] && !state.done[other.id]) { state.done[other.id] = now; closed.push(other.id); }
  }
  delete state.done[m.id];
  const seq = Math.max(0, ...Object.values(state.calls).map((c) => c.seq || 0)) + 1;
  state.calls[m.id] = { at: now, show, closed, seq };
}
function undo(state) {
  const last = Object.entries(state.calls).sort((a, b) => (b[1].seq || 0) - (a[1].seq || 0) || b[1].at - a[1].at)[0];
  if (!last) return false;
  const [id, call] = last;
  delete state.calls[id]; delete state.done[id];
  for (const c of call.closed || []) delete state.done[c];
  if (!Object.keys(state.calls).length && state.mode !== 'live') state.anchor = null;
  return true;
}
// Start a clean session: rehearsal GOs, check-ins and alerts stay in ClickUp history but stop counting.
function freshSession(state, now) {
  Object.assign(state, { anchor: null, calls: {}, done: {}, checkins: {}, session: state.session + 1, since: now });
}
async function comment(taskId, text, rec, notify) {
  await api('/task/' + encodeURIComponent(taskId) + '/comment', { method: 'POST', body: JSON.stringify({ comment_text: `${text}\n\n${MARK}${JSON.stringify(rec)}`, notify_all: !!notify }) });
}
exports.handler = async (event) => {
  if (!process.env.CLICKUP_API_TOKEN || !process.env.CUE_SECRET_V2) return reply(503, { ok: false, error: 'Cue Sheet is not set up yet' });
  const origin = 'https://' + ((event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || 'ampersoundmediagroup.com');
  try {
    const q = event.queryStringParameters || {};
    let p = q;
    if (event.httpMethod === 'POST') {
      try { p = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { ok: false, error: 'Invalid JSON' }); }
    } else if (event.httpMethod !== 'GET') { return reply(405, { ok: false, error: 'Method not allowed' }); }
    if (!p || typeof p !== 'object' || Array.isArray(p)) return reply(400, { ok: false, error: 'Invalid request' });
    if (Object.prototype.hasOwnProperty.call(q, 'k') || Object.prototype.hasOwnProperty.call(p, 'k')) {
      return reply(400, { ok: false, error: 'Use the updated console to sign in' });
    }
    const authEntry = Object.entries(event.headers || {}).find(([name]) => name.toLowerCase() === 'authorization');
    const auth = authEntry ? String(authEntry[1]) : '';
    const key = /^Bearer /i.test(auth) ? auth.slice(7) : '';
    const slug = String(p.e || '');
    let ev = Object.prototype.hasOwnProperty.call(EVENTS, slug) ? EVENTS[slug] : null;
    if (!ev) return reply(404, { ok: false, error: 'Event not found' });
    const coord = isCoordinator(key);
    const vendor = coord ? null : vendorByToken(slug, ev, p.t);
    if (!coord && !vendor) return reply(auth ? 401 : 404, { ok: false, error: auth ? 'Wrong coordinator passcode' : 'This link is turned off' });
    const now = Date.now();
    if (event.httpMethod === 'GET') {
      // Reads never write. Check-ins and alert status are derived from comments every time.
      const { task, comments } = await loadTask(ev.taskId, coord);
      ev = withContact(ev, task);
      const state = readState(task), { alerts, broadcasts, reviewTaps } = derive(state, events(comments));
      if (coord) return reply(200, coordinatorView(slug, ev, state, alerts, broadcasts, now, origin, reviewTaps));
      if (state.closed) return linkExpired(state, now) ? reply(404, { ok: false, error: 'This link is turned off' }) : reply(200, closedVendorView(slug, ev, vendor, state, reviewTaps, now));
      return reply(200, vendorView(slug, ev, vendor, state, alerts, broadcasts, now));
    }
    const action = String(p.action || '');
    if (vendor) {
      // A closed-out show only takes the review tap. Check-ins, alerts and Got it are over.
      const { task, comments } = await loadTask(ev.taskId, action === 'review');
      const st = readState(task);
      if (st.closed && linkExpired(st, now)) return reply(404, { ok: false, error: 'This link is turned off' });
      if (action === 'review') {
        if (!st.closed) return reply(409, { ok: false, error: 'Reviews open after the event is closed out' });
        const { reviewTaps } = derive(st, events(comments));
        if (!reviewTaps[vendor.id]) {
          const rec = { id: crypto.randomUUID(), type: 'reviewtap', vendor: vendor.id, by: vendor.name, at: now };
          await comment(ev.taskId, `⭐ ${vendor.name} (${vendor.role}) opened the Google review link`, rec, false);
          cache.delete(ev.taskId);
        }
        return reply(200, { ok: true, url: reviewUrl(ev) });
      }
      if (st.closed) return reply(409, { ok: false, error: 'This event is wrapped. Thank you!' });
    }
    if (vendor && action === 'gotit') {
      // "Got it" on a message to everyone. Idempotent: a second tap posts nothing.
      const { task, comments } = await loadTask(ev.taskId, true);
      const st = readState(task), { broadcasts } = derive(st, events(comments));
      const b = broadcasts.find((x) => x.id === p.ref && (!x.to || x.to === vendor.id));
      if (!b) return reply(404, { ok: false, error: 'Message not found' });
      if (!b.gotIt[vendor.id]) {
        const rec = { id: crypto.randomUUID(), type: 'gotit', ref: b.id, vendor: vendor.id, by: vendor.name, at: now, session: st.session };
        await comment(ev.taskId, `👍 ${vendor.name} got it: "${b.text}"`, rec, false);
        cache.delete(ev.taskId);
      }
      return reply(200, { ok: true, ref: b.id });
    }
    if (vendor) {
      if (action !== 'checkin' && action !== 'alert') return reply(403, { ok: false, error: 'Not allowed' });
      const text = String(p.text || '').trim().slice(0, 500);
      if (action === 'alert' && !text) return reply(400, { ok: false, error: 'Write what is going on' });
      const level = p.level === 'urgent' ? 'urgent' : 'note';
      const { task } = await loadTask(ev.taskId, false);
      const st = readState(task);
      const show = showMinutes(st, ev, now) ?? wallMinutes(now, ev.tz);
      const rec = { id: crypto.randomUUID(), type: action, vendor: vendor.id, by: vendor.name, at: now, show, level, text, session: st.session };
      const human = action === 'checkin' ? `✅ ${vendor.name} (${vendor.role}) checked in · ${fmt(show)}` : `${level === 'urgent' ? '🚨 URGENT' : '📣 Heads up'} from ${vendor.name}: ${text}`;
      await comment(ev.taskId, human, rec, true);
      cache.delete(ev.taskId);
      return reply(200, { ok: true, id: rec.id, at: now, show, session: st.session });
    }
    const { task, comments } = await loadTask(ev.taskId, true);
    ev = withContact(ev, task);
    const state = readState(task), evs = events(comments);
    let { alerts, broadcasts, reviewTaps } = derive(state, evs);
    const view = () => coordinatorView(slug, ev, state, alerts, broadcasts, now, origin, reviewTaps);
    // Once closed out, the show is frozen. Only Reopen (and clearing old alerts) still works.
    if (state.closed && (action === 'broadcast' || action === 'ready' || (FLOW.includes(action) && action !== 'reopen'))) {
      return reply(409, { ...view(), ok: false, error: 'This show is closed out. Reopen it first.' });
    }

    if (action === 'broadcast') {
      // Message to every vendor, or to one vendor with `to`. Not a show-flow action, so it never fights a GO over `rev`.
      const text = String(p.text || '').trim().slice(0, 500);
      if (!text) return reply(400, { ok: false, error: 'Write a message first' });
      const target = p.to ? ev.vendors.find((v) => v.id === p.to) : null;
      if (p.to && !target) return reply(400, { ok: false, error: 'Pick a vendor from the list' });
      const level = p.level === 'urgent' ? 'urgent' : 'note';
      const show = showMinutes(state, ev, now) ?? wallMinutes(now, ev.tz);
      const rec = { id: crypto.randomUUID(), type: 'broadcast', by: ev.coordinator.name, at: now, show, level, text, session: state.session };
      if (target) rec.to = target.id;
      const who = target ? target.name : 'everyone';
      await comment(ev.taskId, `${level === 'urgent' ? '🚨 URGENT to ' + who : '📢 To ' + who} from ${ev.coordinator.name}: ${text}`, rec, false);
      cache.delete(ev.taskId);
      ({ alerts, broadcasts } = derive(state, evs.concat(rec)));
      return reply(200, { ...view(), sent: rec.id });
    }

    if (action === 'ack' || action === 'resolve') {
      const a = alerts.find((x) => x.id === p.alertId);
      if (!a) return reply(404, { ok: false, error: 'Alert not found' });
      const rec = { id: crypto.randomUUID(), type: action, ref: a.id, by: ev.coordinator.name, at: now };
      await comment(ev.taskId, `${action === 'ack' ? '👀 Seen' : '✔ Resolved'} by ${ev.coordinator.name}: ${a.by}, "${a.text}"`, rec, false);
      cache.delete(ev.taskId);
      ({ alerts, broadcasts } = derive(state, evs.concat(rec)));
      return reply(200, view());
    }
    if (action === 'ready') {
      if (!READY.includes(p.item)) return reply(400, { ok: false, error: 'Unknown check item' });
      if (p.on) state.ready[p.item] = now; else delete state.ready[p.item];
      await writeState(ev.taskId, state); cache.delete(ev.taskId);
      return reply(200, view());
    }
    if (!FLOW.includes(action)) return reply(400, { ok: false, error: 'Unknown action' });
    let closing = null;
    if (p.rev !== undefined && Number(p.rev) !== state.rev) {
      return reply(409, { ...view(), ok: false, error: 'Another device changed the show. Check the screen, then tap again.' });
    }
    if (action === 'go' || action === 'finish') {
      const m = ev.moments.find((x) => x.id === p.momentId);
      if (!m) return reply(404, { ok: false, error: 'Moment not found' });
      if (action === 'go') go(state, ev, m, now); else if (state.calls[m.id]) state.done[m.id] = now;
    } else if (action === 'undo') {
      if (!undo(state)) return reply(409, { ...view(), ok: false, error: 'Nothing to undo' });
    } else if (action === 'closeout') {
      if (state.mode !== 'live') return reply(409, { ...view(), ok: false, error: 'Close out is for Show day. Switch to Show day first.' });
      const open = alerts.filter((a) => !a.resolved);
      if (open.length) return reply(409, { ...view(), ok: false, error: `Resolve ${open.length === 1 ? 'the open alert' : 'all ' + open.length + ' open alerts'} first.`, openAlerts: open.map((a) => a.id) });
      const prev = (task.status && task.status.status) || '';
      let wrapped = false;
      try { await api('/task/' + encodeURIComponent(ev.taskId), { method: 'PUT', body: JSON.stringify({ status: WRAPPED }) }); wrapped = true; }
      catch (e) { console.error('Cue close out: status update failed:', e.message); }
      state.closed = { at: now, by: ev.coordinator.name, prevStatus: prev && prev !== WRAPPED ? prev : 'live', wrapped };
      const here = ev.vendors.filter((v) => state.checkins[v.id]).length;
      closing = { text: `🏁 Show closed out by ${ev.coordinator.name} · ${here} of ${ev.vendors.length} vendors checked in · ${alerts.length} alert${alerts.length === 1 ? '' : 's'}, all resolved. ${wrapped ? 'Task moved to WRAPPED.' : 'Move this task to WRAPPED by hand, the automatic move failed.'} Vendors now see a thank-you with the Google review link; their links turn off in ${CLOSED_LINK_DAYS} days.`, rec: { id: crypto.randomUUID(), type: 'closeout', by: ev.coordinator.name, at: now, wrapped } };
    } else if (action === 'reopen') {
      if (!state.closed) return reply(409, { ...view(), ok: false, error: 'This show is not closed out' });
      const back = state.closed.prevStatus || 'live';
      try { await api('/task/' + encodeURIComponent(ev.taskId), { method: 'PUT', body: JSON.stringify({ status: back }) }); }
      catch (e) { console.error('Cue reopen: status update failed:', e.message); }
      closing = { text: `↩ Show reopened by ${ev.coordinator.name}. Vendor pages show the timeline again.`, rec: { id: crypto.randomUUID(), type: 'reopen', by: ev.coordinator.name, at: now } };
      state.closed = null;
    } else if (action === 'reset') {
      freshSession(state, now);
    } else if (action === 'mode') {
      const to = p.mode === 'live' ? 'live' : 'practice';
      if (to === 'live' && state.mode !== 'live') {
        const missing = READY.filter((k) => !state.ready[k]);
        if (missing.length) return reply(409, { ...view(), ok: false, error: 'Finish the pre-show check first', missing });
        freshSession(state, now);
      }
      state.mode = to; state.anchor = null;
    }
    state.rev += 1;
    await writeState(ev.taskId, state); cache.delete(ev.taskId);
    if (closing) { try { await comment(ev.taskId, closing.text, closing.rec, false); } catch (e) { console.error('Cue close out comment failed:', e.message); } }
    ({ alerts, broadcasts, reviewTaps } = derive(state, evs));
    return reply(200, view());
  } catch (e) {
    console.error('Cue error:', e.message);
    return reply(503, { ok: false, error: 'Cue Sheet is unavailable, try again in a moment' });
  }
};
exports._test = { tokenFor, vendorByToken, go, undo, derive, events, showMinutes, wallMinutes, readState, blank, READY, phoneOf, withContact, CONTACT_NAME, CONTACT_PHONE, REVIEW_URL, CLOSED_LINK_DAYS };
