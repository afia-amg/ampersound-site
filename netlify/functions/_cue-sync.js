'use strict';
// Client portal -> Cue Sheet. When a booked client saves their day-of timeline in the portal,
// it becomes the event's draft run of show (the Cue Plan field), so nobody retypes it.
//
// Safety model:
// - Only a plan the portal itself wrote (source: 'portal') is ever replaced. Once the coordinator
//   publishes a plan from the console (crew list, edits, approval), the portal never overwrites it;
//   later client edits post one review note on the Cue Sheet task instead.
// - Inside LOCK_DAYS of the event the timeline is locked: client changes are noted, never applied.
// - Rows without a readable time are skipped and listed on the task, never guessed.
// - The plan is re-read right before writing, so a plan published a moment ago is never replaced.
// - Songs keep flowing live from the agreement. Moments are tagged with the portal song keys they
//   play (first dance, exit, ...) so the DJ sees the right song on the right moment.
const crypto = require('crypto');

const PLAN_FIELD = '438f723f-5ff2-459d-a223-51727b0c2403';
const NOTE_MARK = 'AMG_CUE_PORTAL_V1:';
const LOCK_DAYS = 14;
const DEFAULT_LANE = 'Run of show';
const LAST_DUR = 30;
const MAX_ROWS = 120;
const SONG_RULES = [
  [/prelude|guests? arriv|seating/i, ['prelude']],
  [/ceremony|processional|aisle/i, ['bridalParty', 'aisle']],
  [/ceremony|recessional/i, ['recessional']],
  [/cocktail/i, ['cocktail']],
  [/entrance|introduction/i, ['entrance']],
  [/first dance/i, ['firstDance']],
  [/father[\s/&-]*daughter/i, ['fatherDaughter']],
  [/mother[\s/&-]*son/i, ['motherSon']],
  [/cake/i, ['cake']],
  [/bouquet|garter/i, ['bouquet']],
  [/last dance/i, ['privateLast']],
  [/karaoke/i, ['karaoke']],
  [/exit|send[\s-]*off|sparkler/i, ['exit']],
];

const clip = (x, n) => String(x == null ? '' : x).trim().slice(0, n);

function parseTime(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\./g, '');
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || 0), ap = m[3];
  if (min > 59 || h > 23) return null;
  if (ap) {
    if (h < 1 || h > 12) return null;
    if (ap[0] === 'p' && h !== 12) h += 12;
    if (ap[0] === 'a' && h === 12) h = 0;
  } else if (!m[2]) return null; // "7" alone is ambiguous
  return h * 60 + min;
}
// Rows after midnight (load-out, late exits) sort after the evening, not before breakfast.
const order = (t) => (t < 5 * 60 ? t + 1440 : t);
// Same id recipe as console imports, so a re-import keeps each moment's identity.
const sid = (lane, start, title) => 's' + crypto.createHash('sha1').update(`${lane}|${start}|${title.toLowerCase()}`).digest('hex').slice(0, 10);
const isMusic = (v) => v.music === true || (v.music !== false && /\bDJ\b/i.test(v.role || ''));

function songKeys(title) {
  const out = [];
  for (const [re, keys] of SONG_RULES) if (re.test(title)) for (const k of keys) if (!out.includes(k)) out.push(k);
  return out;
}

function timelineHash(timeline) {
  const rows = (timeline && Array.isArray(timeline.moments) ? timeline.moments : []).map((r) => [clip(r && r.time, 20), clip(r && r.event, 120)]);
  return crypto.createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

function readPlan(task) {
  const f = ((task && task.custom_fields) || []).find((x) => x.id === PLAN_FIELD);
  if (!f || !f.value) return null;
  try {
    const p = JSON.parse(f.value);
    return p && Array.isArray(p.moments) && Array.isArray(p.lanes) && Array.isArray(p.vendors) ? p : null;
  } catch (_) { return null; }
}

function planFromTimeline(timeline, ev, current) {
  const rows = (timeline && Array.isArray(timeline.moments) ? timeline.moments : []).slice(0, MAX_ROWS);
  const skipped = [], items = [];
  rows.forEach((r, i) => {
    const title = clip(r && r.event, 120), raw = clip(r && r.time, 20);
    if (!title && !raw) return;
    if (!title) { skipped.push(`row ${i + 1} has a time (${raw}) but no moment`); return; }
    const time = parseTime(raw);
    if (time == null) { skipped.push(`"${title}" (${raw ? `"${raw}" isn't a time like 5:00 PM` : 'no time'})`); return; }
    items.push({ title, time });
  });
  items.sort((a, b) => order(a.time) - order(b.time));
  const base = current && Array.isArray(current.vendors) && current.vendors.length ? current.vendors : (ev.vendors || []);
  const vendors = base.map((v) => ({ ...v }));
  const music = vendors.filter(isMusic).map((v) => v.id);
  const lane = (ev.lanes && ev.lanes[0]) || DEFAULT_LANE;
  const seen = new Set();
  const moments = items.map((it, i) => {
    const next = items[i + 1];
    let dur = next ? order(next.time) - order(it.time) : LAST_DUR;
    if (dur <= 0) dur = LAST_DUR;
    dur = Math.min(dur, 720);
    let id = sid(lane, it.time, it.title), n = 2;
    while (seen.has(id)) id = sid(lane, it.time, it.title) + n++;
    seen.add(id);
    const m = { id, lane, time: it.time, dur, title: it.title, location: '', vendors: music.slice() };
    const songs = songKeys(it.title);
    if (songs.length) m.songs = songs;
    return m;
  });
  return { plan: { v: 1, lanes: [lane], moments, vendors }, skipped };
}

function daysUntil(date, now) {
  const t = Date.parse(String(date || '') + 'T12:00:00Z');
  return Number.isNaN(t) ? Infinity : (t - now) / 864e5;
}

function findEvent(events, agreementTaskId) {
  const hit = Object.entries(events || {}).find(([, e]) => e && e.agreementTaskId && e.agreementTaskId === agreementTaskId);
  return hit ? { slug: hit[0], ev: hit[1] } : null;
}

// One note per distinct client change, so autosave never floods the task.
async function noteOnce(api, taskId, key, text) {
  const mark = NOTE_MARK + key;
  const d = await api('/task/' + encodeURIComponent(taskId) + '/comment');
  if ((d.comments || []).some((c) => String(c.comment_text || '').includes(mark))) return false;
  await api('/task/' + encodeURIComponent(taskId) + '/comment', { method: 'POST', body: JSON.stringify({ comment_text: `${text}\n\n${mark}`, notify_all: false }) });
  return true;
}

async function syncTimeline({ agreementTaskId, timeline, api, now = Date.now(), events }) {
  const found = findEvent(events || require('./_cue-events').EVENTS, agreementTaskId);
  if (!found) return { synced: false, reason: 'no-cue-event' };
  const { slug, ev } = found;
  const hash = timelineHash(timeline);
  const task = await api('/task/' + encodeURIComponent(ev.taskId));
  const current = readPlan(task);
  if (current && current.source === 'portal' && current.portalHash === hash) return { synced: false, reason: 'unchanged', slug };
  const locked = daysUntil(ev.date, now) <= LOCK_DAYS;
  const coordinatorPlan = !!current && current.source !== 'portal';
  if (locked || coordinatorPlan) {
    const why = locked ? `the event is ${LOCK_DAYS} days out or less, so the run of show is locked` : 'a coordinator-published plan is already live';
    await noteOnce(api, ev.taskId, hash, `📝 The client changed their day-of timeline in the portal, but ${why}. Nothing on the Cue Sheet changed. Review the timeline on the agreement's Portal Planning field and re-import it in the console only if it should apply.`);
    return { synced: false, reason: locked ? 'locked' : 'coordinator-plan', slug };
  }
  const { plan, skipped } = planFromTimeline(timeline, ev, current);
  if (!plan.moments.length) {
    if (skipped.length) await noteOnce(api, ev.taskId, hash, `📝 The client saved a timeline in the portal, but no row had a readable time, so the Cue Sheet was not changed. Skipped: ${skipped.join('; ')}.`);
    return { synced: false, reason: 'no-moments', slug, skipped };
  }
  const fresh = readPlan(await api('/task/' + encodeURIComponent(ev.taskId)));
  const before = (current && current.version) || 0;
  if ((fresh && fresh.source !== 'portal') || ((fresh && fresh.version) || 0) !== before) return { synced: false, reason: 'changed-during-sync', slug };
  const version = before + 1;
  const summary = { sessions: plan.moments.length, rooms: plan.lanes.length, crew: plan.vendors.length };
  Object.assign(plan, {
    source: 'portal', portalHash: hash, version, publishedAt: now, by: 'Client portal',
    history: [{ version, at: now, by: 'Client portal', ...summary }, ...((current && current.history) || [])].slice(0, 20),
  });
  await api('/task/' + encodeURIComponent(ev.taskId) + '/field/' + PLAN_FIELD, { method: 'POST', body: JSON.stringify({ value: JSON.stringify(plan) }) });
  if (skipped.length) await noteOnce(api, ev.taskId, hash + ':skipped', `📋 Draft run of show v${version} synced from the client portal (${plan.moments.length} moments). Skipped rows to check with the client: ${skipped.join('; ')}.`);
  return { synced: true, slug, version, moments: plan.moments.length, skipped };
}

module.exports = { syncTimeline, planFromTimeline, parseTime, songKeys, timelineHash, readPlan, findEvent, PLAN_FIELD, NOTE_MARK, LOCK_DAYS };
