'use strict';
// Cue Sheet plans: import an agenda (sessions) and a crew list from CSV, preview what changes,
// then publish. The published plan lives in the event task's "Cue Plan" field, so it is visible
// in ClickUp, and each publish posts a comment, so ClickUp keeps the version history.
//
// Sessions CSV: Room, Start, End (or Length), Title, Location, Crew, Call, Notes
// Crew CSV:     Name, Role, Phone, Email, Arrive, Share, Person
// Headers are matched loosely ("Start time", "Session", "Stage" all work). Times take
// "1:30 PM", "1:30pm", "13:30" or "1 PM". Length takes "45", "45m", "1h 15m" or "1:15".
const crypto = require('crypto');

const MAX_ROWS = 400, MAX_CREW = 300, MAX_JSON = 90000;

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((x) => x.trim()));
}

const norm = (h) => String(h || '').toLowerCase().replace(/[^a-z]/g, '');
const ALIASES = {
  room: ['room', 'stage', 'track', 'lane', 'space', 'venue room'],
  start: ['start', 'starttime', 'begins', 'time', 'from'],
  end: ['end', 'endtime', 'ends', 'to', 'until'],
  length: ['length', 'duration', 'dur', 'minutes', 'mins'],
  title: ['title', 'session', 'name', 'moment', 'cue', 'item', 'what'],
  location: ['location', 'where', 'place'],
  crew: ['crew', 'who', 'team', 'vendors', 'assigned', 'staff'],
  call: ['call', 'calltime', 'crewcall', 'standby'],
  notes: ['notes', 'note', 'details', 'description'],
  role: ['role', 'job', 'position', 'department', 'dept'],
  phone: ['phone', 'mobile', 'cell', 'phonenumber'],
  email: ['email', 'emailaddress'],
  arrive: ['arrive', 'arrival', 'arriveby', 'checkin', 'loadin'],
  share: ['share', 'sharecontact', 'okaytoshare', 'sharecontactinfo'],
  person: ['person', 'contact', 'contactname'],
};
function columns(header, wanted) {
  const idx = {};
  const h = header.map(norm);
  for (const key of wanted) {
    const names = ALIASES[key].map(norm);
    const i = h.findIndex((x) => names.includes(x));
    if (i >= 0) idx[key] = i;
  }
  return idx;
}

function parseTime(raw) {
  const s = String(raw || '').trim().toLowerCase().replace(/\./g, '');
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0), ap = m[3];
  if (min > 59 || h > 23) return null;
  if (ap) { if (h < 1 || h > 12) return null; if (ap[0] === 'p' && h !== 12) h += 12; if (ap[0] === 'a' && h === 12) h = 0; }
  else if (!m[2]) return null; // "7" alone is ambiguous
  return h * 60 + min;
}
function parseLength(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  let m = s.match(/^(\d{1,3})\s*(m|min|mins|minutes)?$/); if (m) return Number(m[1]);
  m = s.match(/^(\d{1,2}):(\d{2})$/); if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = s.match(/^(?:(\d{1,2})\s*h(?:rs?|ours?)?)?\s*(?:(\d{1,3})\s*m(?:in(?:ute)?s?)?)?$/);
  if (m && (m[1] || m[2])) return Number(m[1] || 0) * 60 + Number(m[2] || 0);
  return null;
}
const clip = (x, n) => String(x == null ? '' : x).trim().slice(0, n);
const slugify = (s) => clip(s, 60).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'crew';
const sid = (room, start, title) => 's' + crypto.createHash('sha1').update(`${room}|${start}|${title.toLowerCase()}`).digest('hex').slice(0, 10);
function phoneOk(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (/^\d{10}$/.test(d)) d = '+1' + d; else if (/^1\d{10}$/.test(d)) d = '+' + d;
  return /^\+\d{10,15}$/.test(d);
}
const yes = (v) => /^(y|yes|true|1|x|ok|okay|✓)$/i.test(String(v || '').trim());

function buildCrew(text, issues) {
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const col = columns(rows[0], ['role', 'phone', 'email', 'arrive', 'share', 'person']);
  const nameIdx = rows[0].map(norm).findIndex((x) => ['name', 'crew', 'vendor', 'company', 'fullname'].includes(x));
  if (nameIdx < 0) { issues.errors.push('Crew list: needs a Name column.'); return []; }
  const out = [], used = new Set();
  rows.slice(1, MAX_CREW + 1).forEach((r, i) => {
    const line = i + 2, name = clip(r[nameIdx], 80);
    if (!name) return;
    let id = slugify(name), n = 2;
    while (used.has(id)) id = slugify(name) + '-' + n++;
    used.add(id);
    const v = { id, name, role: clip(r[col.role], 80) || 'Crew', rev: 1 };
    if (col.phone != null && r[col.phone]) { if (phoneOk(r[col.phone])) v.phone = clip(r[col.phone], 30); else issues.warnings.push(`Crew row ${line}: "${r[col.phone]}" isn't a phone number, left off.`); }
    if (col.email != null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r[col.email] || '')) v.email = clip(r[col.email], 120);
    if (col.person != null && r[col.person]) v.person = clip(r[col.person], 60);
    if (col.arrive != null && r[col.arrive]) { const t = parseTime(r[col.arrive]); if (t == null) issues.warnings.push(`Crew row ${line}: arrival "${r[col.arrive]}" isn't a time.`); else v.arrival = t; }
    if (col.share != null && yes(r[col.share])) v.share = true;
    if (!v.phone) issues.warnings.push(`${name} has no phone number, so they can't be called or texted their link.`);
    out.push(v);
  });
  if (rows.length - 1 > MAX_CREW) issues.errors.push(`Crew list: ${MAX_CREW} people max.`);
  return out;
}

function matchCrew(cell, crew) {
  const ids = new Set(), missing = [];
  for (const part of String(cell || '').split(/[;,/|]+/).map((x) => x.trim()).filter(Boolean)) {
    const p = part.toLowerCase();
    const hit = crew.filter((v) => v.name.toLowerCase() === p || v.id === slugify(part) || (v.person && v.person.toLowerCase() === p));
    const byRole = hit.length ? hit : crew.filter((v) => v.role.toLowerCase() === p);
    if (byRole.length) byRole.forEach((v) => ids.add(v.id)); else missing.push(part);
  }
  return { ids: [...ids], missing };
}

function buildSessions(text, crew, issues) {
  const rows = parseCSV(text);
  if (!rows.length) { issues.errors.push('Agenda: nothing to import.'); return { lanes: [], moments: [] }; }
  const col = columns(rows[0], ['room', 'start', 'end', 'length', 'title', 'location', 'crew', 'call', 'notes']);
  if (col.start == null || col.title == null) { issues.errors.push('Agenda: needs at least a Start column and a Title column.'); return { lanes: [], moments: [] }; }
  const lanes = [], moments = [], seen = new Set();
  rows.slice(1, MAX_ROWS + 1).forEach((r, i) => {
    const line = i + 2, title = clip(r[col.title], 120);
    if (!title) return;
    const start = parseTime(r[col.start]);
    if (start == null) { issues.errors.push(`Agenda row ${line} (${title}): start "${r[col.start] || ''}" isn't a time like 1:30 PM.`); return; }
    let dur = col.length != null ? parseLength(r[col.length]) : null;
    if (dur == null && col.end != null && r[col.end]) { const e = parseTime(r[col.end]); if (e != null) dur = e >= start ? e - start : e + 1440 - start; }
    if (dur == null || dur <= 0) { if ((col.length != null && r[col.length]) || (col.end != null && r[col.end])) issues.warnings.push(`Agenda row ${line} (${title}): couldn't read the length, used 15 min.`); dur = 15; }
    const room = clip(col.room != null ? r[col.room] : '', 60) || 'Main';
    if (!lanes.includes(room)) lanes.push(room);
    let id = sid(room, start, title), n = 2;
    while (seen.has(id)) id = sid(room, start, title) + n++;
    seen.add(id);
    const m = { id, lane: room, time: start, dur: Math.min(dur, 720), title };
    if (col.location != null && r[col.location]) m.location = clip(r[col.location], 80); else m.location = room;
    if (col.notes != null && r[col.notes]) m.notes = clip(r[col.notes], 300);
    if (col.call != null && r[col.call]) {
      const raw = String(r[col.call]).trim(), t = parseTime(raw), before = raw.match(/^-?\s*(\d{1,3})\s*(m|min|mins)?\s*(before)?$/i);
      if (t != null) m.call = t; else if (before) m.call = start - Number(before[1]); else issues.warnings.push(`Agenda row ${line} (${title}): call time "${raw}" isn't a time.`);
    }
    const { ids, missing } = matchCrew(col.crew != null ? r[col.crew] : '', crew);
    m.vendors = ids;
    if (missing.length) issues.warnings.push(`Agenda row ${line} (${title}): ${missing.map((x) => `"${x}"`).join(', ')} not on the crew list.`);
    moments.push(m);
  });
  if (rows.length - 1 > MAX_ROWS) issues.errors.push(`Agenda: ${MAX_ROWS} sessions max.`);
  // Overlaps in the same room usually mean a typo in a time.
  for (const room of lanes) {
    const list = moments.filter((m) => m.lane === room).sort((a, b) => a.time - b.time);
    for (let i = 1; i < list.length; i++) if (list[i].time < list[i - 1].time + list[i - 1].dur) issues.warnings.push(`${room}: "${list[i].title}" starts before "${list[i - 1].title}" ends.`);
  }
  return { lanes, moments };
}

// Build a plan from CSV. Crew is optional; without it the current crew list is kept.
function buildPlan({ sessions, crew }, current) {
  const issues = { errors: [], warnings: [] };
  const crewList = crew && String(crew).trim() ? buildCrew(crew, issues) : (current && current.vendors) || [];
  const { lanes, moments } = buildSessions(sessions, crewList, issues);
  const plan = { v: 1, lanes, moments: moments.sort((a, b) => a.time - b.time || lanes.indexOf(a.lane) - lanes.indexOf(b.lane)), vendors: crewList };
  // Keep each person's link revision, so re-importing never changes anyone's link.
  if (current && current.vendors) for (const v of plan.vendors) { const old = current.vendors.find((x) => x.id === v.id); if (old && old.rev) v.rev = old.rev; }
  // No arrival time on the crew list: ask them in 30 minutes before their first call or session.
  for (const v of plan.vendors) {
    if (v.arrival != null) continue;
    const mine = plan.moments.filter((m) => (m.vendors || []).includes(v.id)).map((m) => (m.call != null ? m.call : m.time));
    if (mine.length) v.arrival = Math.max(0, Math.min(...mine) - 30);
  }
  if (!moments.length && !issues.errors.length) issues.errors.push('Agenda: no sessions found.');
  if (JSON.stringify(plan).length > MAX_JSON) issues.errors.push('This plan is too big to save. Split it into one event per day.');
  return { plan, issues };
}

function diff(prev, next) {
  const before = new Map(((prev && prev.moments) || []).map((m) => [m.id, m])), after = new Map(next.moments.map((m) => [m.id, m]));
  const key = (m) => JSON.stringify([m.time, m.dur, m.location, m.notes, m.call, (m.vendors || []).slice().sort()]);
  const added = next.moments.filter((m) => !before.has(m.id)), removed = [...before.values()].filter((m) => !after.has(m.id));
  const changed = next.moments.filter((m) => before.has(m.id) && key(before.get(m.id)) !== key(m));
  const crewBefore = new Set(((prev && prev.vendors) || []).map((v) => v.id)), crewAfter = new Set(next.vendors.map((v) => v.id));
  return {
    added: added.map((m) => ({ id: m.id, title: m.title, lane: m.lane, time: m.time })),
    removed: removed.map((m) => ({ id: m.id, title: m.title, lane: m.lane, time: m.time })),
    changed: changed.map((m) => ({ id: m.id, title: m.title, lane: m.lane, time: m.time, was: before.get(m.id).time })),
    crewAdded: next.vendors.filter((v) => !crewBefore.has(v.id)).map((v) => v.name),
    crewRemoved: ((prev && prev.vendors) || []).filter((v) => !crewAfter.has(v.id)).map((v) => v.name),
  };
}

function readPlan(task, fieldId) {
  const f = ((task && task.custom_fields) || []).find((x) => x.id === fieldId);
  if (!f || !f.value) return null;
  try {
    const p = JSON.parse(f.value);
    if (!p || !Array.isArray(p.moments) || !Array.isArray(p.lanes) || !Array.isArray(p.vendors)) return null;
    return p;
  } catch (_) { return null; }
}

// The event the app runs: server config (task, coordinator, songs) plus the published plan.
function effective(ev, plan) {
  if (!plan) return ev;
  // An imported plan brings its own sessions, so the built-in demo songs don't apply. A real agreement's songs still do.
  const { sampleSongs, ...rest } = ev;
  return { ...rest, lanes: plan.lanes.length ? plan.lanes : ev.lanes, moments: plan.moments, vendors: plan.vendors, planVersion: plan.version || 1, planAt: plan.publishedAt || null, planHistory: plan.history || [] };
}

const TEMPLATES = {
  sessions: 'Room,Start,End,Title,Location,Crew,Call,Notes\nMain Stage,9:00 AM,9:45 AM,Opening keynote,Ballroom A,"Jordan Reyes; Sam Okafor; Dana Hale",8:40 AM,Hale lav mic #3\nBreakout 1,10:00 AM,10:50 AM,Workshop: pricing your services,Room 250,"Priya Shah; Luis Ortega",,\n',
  crew: 'Name,Role,Phone,Email,Arrive,Share\nJordan Reyes,Stage manager · Main Stage,(801) 555-0111,,7:30 AM,yes\nSam Okafor,AV lead,(801) 555-0121,,7:00 AM,yes\nDana Hale,Keynote speaker,,,8:15 AM,no\nPriya Shah,Room captain · Room 250,(801) 555-0131,,8:00 AM,yes\nLuis Ortega,AV tech · breakouts,(801) 555-0122,,7:30 AM,yes\n',
};

module.exports = { parseCSV, parseTime, parseLength, buildPlan, diff, readPlan, effective, slugify, TEMPLATES, MAX_JSON };
