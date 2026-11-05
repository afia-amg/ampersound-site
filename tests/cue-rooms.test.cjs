'use strict';
// Conferences: imported plans, room stage-manager links, rooms that never block each other,
// and offline resends that never post twice.
const assert = require('node:assert/strict'), path = require('node:path'), { test } = require('node:test');
const FN = path.resolve(__dirname, '..', 'netlify/functions/cue.js');
const PLAN = require('../netlify/functions/_cue-plan');

function harness() {
  const db = { fields: {}, comments: [], posts: [], sheet: null, n: 0 };
  global.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => 'application/json' } });
    if (u.startsWith('https://docs.google.com/')) {
      if (!db.sheet) return { ok: false, status: 401, headers: { get: () => 'text/html' }, text: async () => '<html>' };
      db.sheetUrl = u; return { ok: true, status: 200, headers: { get: () => 'text/csv' }, text: async () => db.sheet };
    }
    if (method === 'GET' && /\/task\/[^/?]+$/.test(u)) return ok({ id: 'task', status: { status: 'live' }, custom_fields: Object.entries(db.fields).map(([id, value]) => ({ id, value })) });
    if (method === 'GET' && /\/comment(\?|$)/.test(u)) return ok({ comments: u.includes('?') ? [] : db.comments.slice().reverse() });
    if (method === 'POST' && u.includes('/field/')) { const id = u.split('/field/')[1]; db.fields[id] = JSON.parse(opts.body).value; return ok({}); }
    if (method === 'POST' && u.endsWith('/comment')) { const b = JSON.parse(opts.body); db.posts.push(b.comment_text); db.comments.push({ id: 'c' + (++db.n), date: String(Date.now()), comment_text: b.comment_text }); return ok({ id: 'c' }); }
    if (method === 'PUT') return ok({});
    return { ok: false, status: 500, json: async () => ({}) };
  };
  process.env.CLICKUP_API_TOKEN = 'token';
  process.env.CUE_SECRET_V2 = 'test-secret-passphrase-v2';
  delete require.cache[FN];
  return { db, h: require(FN) };
}
const send = async (h, method, q) => {
  const p = { ...q }, headers = { host: 'example.test' };
  if (p.k) headers.authorization = 'Bearer ' + p.k;
  delete p.k;
  const r = await h.handler(method === 'GET' ? { httpMethod: 'GET', queryStringParameters: p, headers } : { httpMethod: 'POST', body: JSON.stringify(p), headers });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const get = (h, q) => send(h, 'GET', q), post = (h, q) => send(h, 'POST', q);
const k = () => process.env.CUE_SECRET_V2;
const wait = (ms = 5) => new Promise((r) => setTimeout(r, ms));

const AGENDA = `Room,Start,End,Title,Location,Crew,Call,Notes
Main Stage,9:00 AM,9:45 AM,Opening keynote,Ballroom A,Jordan Reyes; Sam Okafor; Dana Hale,8:40 AM,Hale lav mic #3
Main Stage,10:00 AM,10:30 AM,Panel: founders,Ballroom A,Jordan Reyes; Sam Okafor,15 min before,
Breakout 1,9:30 AM,10:20 AM,Workshop: pricing,Room 250,Priya Shah; Luis Ortega,,
Breakout 1,10:30 AM,11:00 AM,Room turn,Room 250,Priya Shah,,
Breakout 2,9:30 AM,10:15,Session: AI for small ops,Room 251,Tasha Bell; Mystery Person,,`;
const CREW = `Name,Role,Phone,Email,Arrive,Share
Jordan Reyes,Stage manager · Main Stage,(801) 555-0111,,7:30 AM,yes
Sam Okafor,AV lead,(801) 555-0121,,7:00 AM,yes
Dana Hale,Keynote speaker,,,8:15 AM,no
Priya Shah,Room captain · Room 250,(801) 555-0131,,,yes
Luis Ortega,AV tech,(801) 555-0122,,7:30 AM,yes
Tasha Bell,Room captain · Room 251,801-555-0132,,8:00 AM,no`;

test('CSV import reads real-world agendas and flags problems', () => {
  const { plan, issues } = PLAN.buildPlan({ sessions: AGENDA, crew: CREW });
  assert.deepEqual(plan.lanes, ['Main Stage', 'Breakout 1', 'Breakout 2']);
  assert.equal(plan.moments.length, 5); assert.equal(plan.vendors.length, 6);
  const key = plan.moments.find((m) => m.title === 'Opening keynote');
  assert.equal(key.time, 540); assert.equal(key.dur, 45); assert.equal(key.call, 520); assert.deepEqual(key.vendors, ['jordan-reyes', 'sam-okafor', 'dana-hale']);
  assert.equal(plan.moments.find((m) => m.title === 'Panel: founders').call, 585, '"15 min before" works');
  assert.equal(plan.moments.find((m) => m.title === 'Session: AI for small ops').dur, 45, '24-hour end times work too');
  assert.ok(issues.warnings.some((w) => /Mystery Person/.test(w)), 'unknown crew names are flagged');
  assert.equal(plan.vendors.find((v) => v.id === 'priya-shah').arrival, 540, 'no arrival time: 30 min before their first session');
  assert.equal(plan.vendors.find((v) => v.id === 'dana-hale').share, undefined, 'contact sharing stays opt-in');
  const bad = PLAN.buildPlan({ sessions: 'Title,Start\nKeynote,soon\n' });
  assert.ok(bad.issues.errors.some((e) => /isn't a time/.test(e)));
  assert.ok(PLAN.buildPlan({ sessions: 'Foo,Bar\n1,2\n' }).issues.errors[0].includes('Start column'));
  assert.deepEqual(PLAN.parseCSV('a,"b, c","d ""q"""\r\n1,2,3'), [['a', 'b, c', 'd "q"'], ['1', '2', '3']]);
  const again = PLAN.buildPlan({ sessions: AGENDA, crew: CREW }, { ...plan, vendors: plan.vendors.map((v) => (v.id === 'sam-okafor' ? { ...v, rev: 3 } : v)) });
  assert.equal(again.plan.vendors.find((v) => v.id === 'sam-okafor').rev, 3, 're-importing keeps revoked-link revisions');
  assert.equal(again.plan.moments[0].id, plan.moments[0].id, 'session ids are stable across imports');
});

test('preview, publish and version check for an imported plan', async () => {
  const { db, h } = harness();
  let r = await post(h, { e: 'demo', k: k(), action: 'plan-preview', sessions: AGENDA, crew: CREW });
  assert.equal(r.status, 200); assert.equal(r.body.preview.summary.rooms, 3); assert.equal(r.body.preview.version, 0);
  assert.equal(r.body.preview.changes.removed.length, 14, 'preview shows the built-in schedule going away');
  assert.equal(db.fields['438f723f-5ff2-459d-a223-51727b0c2403'], undefined, 'preview never saves');
  assert.equal((await post(h, { e: 'demo', k: k(), action: 'plan-publish', sessions: AGENDA, crew: CREW, version: 3 })).status, 409, 'stale version is refused');
  r = await post(h, { e: 'demo', k: k(), action: 'plan-publish', sessions: AGENDA, crew: CREW, version: 0 });
  assert.equal(r.status, 200); assert.equal(r.body.published, 1);
  assert.deepEqual(r.body.event.lanes, ['Main Stage', 'Breakout 1', 'Breakout 2']);
  assert.equal(r.body.vendors.length, 6); assert.equal(r.body.rooms.length, 3); assert.match(r.body.rooms[0].link, /\/cue\/demo\/room\/[A-Za-z0-9_-]{16}$/);
  assert.equal(r.body.plan.version, 1); assert.equal(r.body.plan.history[0].sessions, 5);
  assert.match(db.posts.at(-1), /^📋 Plan v1 published by Afia: 5 sessions in 3 rooms, 6 crew \(5 new, 14 removed\)/);
  assert.equal((await post(h, { e: 'demo', k: k(), action: 'plan-publish', sessions: 'Title\nx', version: 1 })).status, 400, 'a plan with errors never publishes');
  // People from the plan get working links; people the plan removed lose theirs.
  const tok = (id) => h._test.tokenFor('demo', { id, rev: 1 });
  await wait();
  const v = await get(h, { e: 'demo', t: tok('jordan-reyes') });
  assert.equal(v.status, 200); assert.equal(v.body.vendor.name, 'Jordan Reyes');
  assert.equal(v.body.moments.find((m) => m.title === 'Opening keynote').call, 520, 'crew see their call time');
  assert.equal((await get(h, { e: 'demo', t: tok('photo') })).status, 404, 'built-in vendors are gone once a plan replaces them');
});

test('Google Sheets import: shared sheets work, private ones explain how to fix it', async () => {
  const { db, h } = harness();
  let r = await post(h, { e: 'demo', k: k(), action: 'plan-preview', sessionsUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=42' });
  assert.equal(r.status, 400); assert.match(r.body.error, /Anyone with the link/);
  db.sheet = AGENDA;
  r = await post(h, { e: 'demo', k: k(), action: 'plan-preview', sessionsUrl: 'https://docs.google.com/spreadsheets/d/abc123/edit#gid=42' });
  assert.equal(r.status, 200); assert.equal(db.sheetUrl, 'https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=42');
  assert.equal((await post(h, { e: 'demo', k: k(), action: 'plan-preview', sessionsUrl: 'https://evil.example/x.csv' })).status, 400, 'only Google Sheets');
});

async function conference() {
  const x = harness();
  await post(x.h, { e: 'demo', k: k(), action: 'plan-publish', sessions: AGENDA, crew: CREW, version: 0 });
  await wait();
  const c = await get(x.h, { e: 'demo', k: k() });
  const link = (lane) => c.body.rooms.find((r) => r.lane === lane).link.split('/').pop();
  return { ...x, c, link };
}

test('a room link runs only its own room', async () => {
  const { h, c, link } = await conference();
  const main = link('Main Stage'), b1 = link('Breakout 1');
  let r = await get(h, { e: 'demo', r: main });
  assert.equal(r.status, 200); assert.equal(r.body.role, 'room'); assert.equal(r.body.room, 'Main Stage');
  assert.deepEqual(r.body.moments.map((m) => m.title), ['Opening keynote', 'Panel: founders']);
  assert.deepEqual(r.body.crew.map((x) => x.name).sort(), ['Dana Hale', 'Jordan Reyes', 'Sam Okafor']);
  assert.equal(r.body.crew.find((x) => x.name === 'Dana Hale').phone, '', 'no phone unless they agreed to share');
  assert.equal(r.body.vendors, undefined, 'stage managers never see vendor links');
  const keynote = c.body.moments.find((m) => m.title === 'Opening keynote'), workshop = c.body.moments.find((m) => m.title === 'Workshop: pricing');
  assert.equal((await post(h, { e: 'demo', r: main, action: 'go', momentId: workshop.id, laneRev: 0 })).status, 404, 'cannot GO another room');
  for (const action of ['reset', 'mode', 'closeout', 'broadcast', 'ready', 'plan-publish']) assert.equal((await post(h, { e: 'demo', r: main, action, laneRev: 0 })).status, 403, action + ' is coordinator-only');
  r = await post(h, { e: 'demo', r: main, action: 'go', momentId: keynote.id, laneRev: 0 });
  assert.equal(r.status, 200); assert.ok(r.body.state.calls[keynote.id]); assert.equal(r.body.state.laneRev['Main Stage'], 1);
  // Breakout 1 never saw Main Stage's GO, and that's fine: its own room didn't change.
  r = await post(h, { e: 'demo', r: b1, action: 'go', momentId: workshop.id, laneRev: 0 });
  assert.equal(r.status, 200, 'rooms never block each other'); assert.ok(r.body.state.calls[keynote.id] && r.body.state.calls[workshop.id], 'both GOs are kept');
  assert.equal((await post(h, { e: 'demo', r: main, action: 'go', momentId: keynote.id, laneRev: 1 })).status, 409, 'already live');
  const second = c.body.moments.find((m) => m.title === 'Panel: founders');
  assert.equal((await post(h, { e: 'demo', r: main, action: 'go', momentId: second.id, laneRev: 0 })).status, 409, 'a stale screen in the same room is refused');
  // Undo in Breakout 1 undoes Breakout 1's GO, never Main Stage's newer one.
  r = await post(h, { e: 'demo', r: b1, action: 'undo', laneRev: 1 });
  assert.equal(r.status, 200); assert.ok(!r.body.state.calls[workshop.id]); assert.ok(r.body.state.calls[keynote.id]);
  r = await post(h, { e: 'demo', r: main, action: 'alert', text: 'Clicker dead', level: 'urgent', cid: 'abcdefgh01' });
  assert.equal(r.status, 200);
  const coord = await get(h, { e: 'demo', k: k() });
  assert.equal(coord.body.alerts[0].by, 'Main Stage stage manager');
  assert.equal((await get(h, { e: 'demo', r: 'AAAAAAAAAAAAAAAA' })).status, 404);
});

test('the coordinator is not blocked by other rooms either', async () => {
  const { h, c, link } = await conference();
  const keynote = c.body.moments.find((m) => m.title === 'Opening keynote'), workshop = c.body.moments.find((m) => m.title === 'Workshop: pricing');
  await post(h, { e: 'demo', r: link('Breakout 1'), action: 'go', momentId: workshop.id, laneRev: 0 });
  let r = await post(h, { e: 'demo', k: k(), action: 'go', momentId: keynote.id, rev: c.body.state.rev, laneRev: 0 });
  assert.equal(r.status, 200, 'old global rev, but Main Stage itself is unchanged');
  assert.equal((await post(h, { e: 'demo', k: k(), action: 'reset', rev: c.body.state.rev })).status, 409, 'reset still needs a current screen');
  r = await post(h, { e: 'demo', k: k(), action: 'undo', lane: 'Main Stage', rev: c.body.state.rev, laneRev: 1 });
  assert.equal(r.status, 200); assert.ok(!r.body.state.calls[keynote.id]); assert.ok(r.body.state.calls[workshop.id], 'room undo leaves other rooms alone');
});

test('offline resends never post twice, and keep the real check-in time', async () => {
  const { db, h, c } = await conference();
  const t = h._test.tokenFor('demo', { id: 'priya-shah', rev: 1 });
  const tapped = Date.now() - 4 * 60 * 1000;
  let r = await post(h, { e: 'demo', t, action: 'checkin', cid: 'queued-0001', tappedAt: tapped });
  assert.equal(r.status, 200);
  const posts = db.posts.length;
  r = await post(h, { e: 'demo', t, action: 'checkin', cid: 'queued-0001', tappedAt: tapped });
  assert.equal(r.body.dedup, true); assert.equal(db.posts.length, posts, 'the resend posted nothing');
  await post(h, { e: 'demo', t, action: 'message', to: 'all', text: 'Room 250 doors open', cid: 'queued-0002' });
  await post(h, { e: 'demo', t, action: 'message', to: 'all', text: 'Room 250 doors open', cid: 'queued-0002' });
  assert.equal(db.posts.filter((x) => x.includes('Room 250 doors open')).length, 1);
  const coord = await get(h, { e: 'demo', k: k() });
  const priya = coord.body.vendors.find((v) => v.id === 'priya-shah');
  assert.ok(Math.abs(priya.checkedIn.at - Date.now()) < 5000);
  const expected = h._test.wallMinutes(tapped, 'America/Denver');
  assert.ok(Math.abs(priya.checkedIn.show - expected) < 0.1, 'the check-in shows when they tapped, not when signal came back');
  assert.ok(c.body.state.rev >= 0);
});
