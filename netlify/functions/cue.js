'use strict';
// Live day-of Cue Sheet backend. Vendors reach their day with a private link
// (no login); the coordinator runs the show from /cue/<event>/control.
//  - Show state (GO calls, clock mode, check-ins) lives in the "Cue State" field
//    on the event's task in the Day-Of Cue Sheets list. Only coordinator actions
//    and check-in folding write it.
//  - Vendor check-ins and alerts are task comments, so Afia is notified in ClickUp.
const crypto = require('crypto');
const { EVENTS } = require('./_cue-events');

const BASE = 'https://api.clickup.com/api/v2';
const STATE_FIELD = '745508ca-6e71-4541-8d49-a10a9acab836';
const MARK = 'AMG_CUE_V1:';
const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' };
const reply = (status, body) => ({ statusCode: status, headers, body: JSON.stringify(body) });

async function api(path, opts = {}) {
  const r = await fetch(BASE + path, { ...opts, headers: { Authorization: process.env.CLICKUP_API_TOKEN, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
  if (!r.ok) throw Error('ClickUp request failed: ' + r.status);
  return r.json();
}

// ---------- links + auth ----------
function tokenFor(slug, vendor) {
  return crypto.createHmac('sha256', process.env.CUE_SECRET).update(`${slug}:${vendor.id}:${vendor.rev || 1}`).digest('base64url').slice(0, 16);
}
function same(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function vendorByToken(slug, ev, token) {
  return ev.vendors.find((v) => same(tokenFor(slug, v), token)) || null;
}
function isCoordinator(key) {
  return !!key && same(key, process.env.CUE_SECRET);
}

// ---------- clock ----------
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

// ---------- state ----------
const blank = () => ({ v: 1, mode: 'practice', anchor: null, calls: {}, done: {}, checkins: {}, seen: [] });
function readState(task) {
  const f = (task.custom_fields || []).find((x) => x.id === STATE_FIELD);
  try {
    const d = f && f.value ? JSON.parse(f.value) : null;
    return d && typeof d === 'object' ? { ...blank(), ...d } : blank();
  } catch (_) {
    return blank();
  }
}
async function writeState(taskId, state) {
  state.updatedAt = Date.now();
  if (state.seen.length > 200) state.seen = state.seen.slice(-200);
  await api('/task/' + encodeURIComponent(taskId) + '/field/' + STATE_FIELD, { method: 'POST', body: JSON.stringify({ value: JSON.stringify(state) }) });
}

// Short warm-instance cache so a room full of phones doesn't hammer ClickUp.
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
// Check-in comments are folded into state so they outlive the comment page.
function fold(state, evs) {
  let changed = false;
  for (const e of evs) {
    if (e.type !== 'checkin' || state.seen.includes(e.id)) continue;
    if (!state.checkins[e.vendor]) state.checkins[e.vendor] = { at: e.at, show: e.show };
    state.seen.push(e.id);
    changed = true;
  }
  return changed;
}

// ---------- views ----------
function publicMoment(m) {
  return { id: m.id, time: m.time, dur: m.dur, title: m.title, location: m.location || '', lane: m.lane || null, vendors: m.vendors || [], notes: m.notes || '' };
}
function basics(slug, ev) {
  return { slug, name: ev.name, kind: ev.kind, dateLabel: ev.dateLabel, venue: ev.venue, tz: ev.tz, lanes: ev.lanes, coordinator: ev.coordinator };
}
function liveView(state) {
  return { mode: state.mode, anchor: state.anchor, calls: state.calls, done: state.done, updatedAt: state.updatedAt || null };
}
function vendorView(slug, ev, v, state, now) {
  return {
    ok: true,
    now,
    event: basics(slug, ev),
    vendor: { id: v.id, name: v.name, role: v.role, arrival: v.arrival, checkedIn: state.checkins[v.id] || null },
    // Everyone sees what's happening at the event; only their own rows are detailed.
    moments: ev.moments.map((m) => (m.vendors.includes(v.id) ? publicMoment(m) : { id: m.id, time: m.time, dur: m.dur, title: m.title, lane: m.lane || null, vendors: [] })),
    roles: Object.fromEntries(ev.vendors.map((x) => [x.id, x.role])),
    state: liveView(state),
  };
}
function coordinatorView(slug, ev, state, evs, now, origin) {
  return {
    ok: true,
    now,
    event: basics(slug, ev),
    moments: ev.moments.map(publicMoment),
    vendors: ev.vendors.map((v) => ({ id: v.id, name: v.name, role: v.role, contact: v.contact || '', arrival: v.arrival, checkedIn: state.checkins[v.id] || null, link: `${origin}/cue/${slug}/${tokenFor(slug, v)}` })),
    alerts: evs.filter((e) => e.type === 'alert').slice(-30).reverse(),
    state: liveView(state),
  };
}

// ---------- actions ----------
function go(state, ev, m, now) {
  if (state.mode !== 'live' && !state.anchor) state.anchor = { real: now, show: m.time };
  const show = showMinutes(state, ev, now);
  const closed = [];
  for (const other of ev.moments) {
    if ((other.lane || null) !== (m.lane || null) || other.id === m.id) continue;
    if (state.calls[other.id] && !state.done[other.id]) {
      state.done[other.id] = now;
      closed.push(other.id);
    }
  }
  delete state.done[m.id];
  const seq = Math.max(0, ...Object.values(state.calls).map((c) => c.seq || 0)) + 1;
  state.calls[m.id] = { at: now, show, closed, seq };
}
function undo(state) {
  const last = Object.entries(state.calls).sort((a, b) => (b[1].seq || 0) - (a[1].seq || 0) || b[1].at - a[1].at)[0];
  if (!last) return false;
  const [id, call] = last;
  delete state.calls[id];
  delete state.done[id];
  for (const c of call.closed || []) delete state.done[c];
  if (!Object.keys(state.calls).length && state.mode !== 'live') state.anchor = null;
  return true;
}

exports.handler = async (event) => {
  if (!process.env.CLICKUP_API_TOKEN || !process.env.CUE_SECRET) return reply(503, { ok: false, error: 'Cue Sheet is not set up yet' });
  const origin = 'https://' + ((event.headers && (event.headers['x-forwarded-host'] || event.headers.host)) || 'ampersoundmediagroup.com');
  try {
    const q = event.queryStringParameters || {};
    let p = q;
    if (event.httpMethod === 'POST') {
      try { p = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { ok: false, error: 'Invalid JSON' }); }
    } else if (event.httpMethod !== 'GET') {
      return reply(405, { ok: false, error: 'Method not allowed' });
    }
    const slug = String(p.e || '');
    const ev = Object.prototype.hasOwnProperty.call(EVENTS, slug) ? EVENTS[slug] : null;
    if (!ev) return reply(404, { ok: false, error: 'Event not found' });
    const coord = isCoordinator(p.k);
    const vendor = coord ? null : vendorByToken(slug, ev, p.t);
    if (!coord && !vendor) return reply(p.k ? 401 : 404, { ok: false, error: p.k ? 'Wrong coordinator passcode' : 'This link is turned off' });
    const now = Date.now();

    if (event.httpMethod === 'GET') {
      const { task, comments } = await loadTask(ev.taskId, coord);
      const state = readState(task), evs = events(comments);
      if (fold(state, evs) && coord) { try { await writeState(ev.taskId, state); } catch (e) { console.error('Fold write failed:', e.message); } }
      return reply(200, coord ? coordinatorView(slug, ev, state, evs, now, origin) : vendorView(slug, ev, vendor, state, now));
    }

    const action = String(p.action || '');
    if (vendor) {
      if (action !== 'checkin' && action !== 'alert') return reply(403, { ok: false, error: 'Not allowed' });
      const text = String(p.text || '').trim().slice(0, 500);
      if (action === 'alert' && !text) return reply(400, { ok: false, error: 'Write what is going on' });
      const level = p.level === 'urgent' ? 'urgent' : 'note';
      const { task } = await loadTask(ev.taskId, false);
      const show = showMinutes(readState(task), ev, now) ?? wallMinutes(now, ev.tz);
      const rec = { id: crypto.randomUUID(), type: action, vendor: vendor.id, by: vendor.name, at: now, show, level, text };
      const human = action === 'checkin' ? `✅ ${vendor.name} (${vendor.role}) checked in · ${fmt(show)}` : `${level === 'urgent' ? '🚨 URGENT' : '📣 Heads up'} from ${vendor.name}: ${text}`;
      await api('/task/' + encodeURIComponent(ev.taskId) + '/comment', { method: 'POST', body: JSON.stringify({ comment_text: `${human}\n\n${MARK}${JSON.stringify(rec)}`, notify_all: true }) });
      cache.delete(ev.taskId);
      return reply(200, { ok: true, at: now, show });
    }

    // Coordinator actions write the show state.
    const { task, comments } = await loadTask(ev.taskId, true);
    const state = readState(task);
    fold(state, events(comments));
    if (action === 'go' || action === 'finish') {
      const m = ev.moments.find((x) => x.id === p.momentId);
      if (!m) return reply(404, { ok: false, error: 'Moment not found' });
      if (action === 'go') go(state, ev, m, now);
      else if (state.calls[m.id]) state.done[m.id] = now;
    } else if (action === 'undo') {
      if (!undo(state)) return reply(409, { ok: false, error: 'Nothing to undo' });
    } else if (action === 'reset') {
      Object.assign(state, { ...blank(), mode: state.mode, seen: state.seen });
    } else if (action === 'mode') {
      state.mode = p.mode === 'live' ? 'live' : 'practice';
      state.anchor = null;
    } else {
      return reply(400, { ok: false, error: 'Unknown action' });
    }
    await writeState(ev.taskId, state);
    cache.delete(ev.taskId);
    return reply(200, coordinatorView(slug, ev, state, events(comments), now, origin));
  } catch (e) {
    console.error('Cue error:', e.message);
    return reply(503, { ok: false, error: 'Cue Sheet is unavailable, try again in a moment' });
  }
};

exports._test = { tokenFor, vendorByToken, go, undo, fold, events, showMinutes, wallMinutes, readState, blank };
