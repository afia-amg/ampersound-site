'use strict';
// Close out: show-day end, WRAPPED status, Google review ask, link expiry.
const assert = require('node:assert/strict'), path = require('node:path'), { test } = require('node:test');
const FN = path.resolve(__dirname, '..', 'netlify/functions/cue.js');
const STATE_FIELD = '745508ca-6e71-4541-8d49-a10a9acab836';
function harness() {
  const db = { field: null, comments: [], writes: 0, posts: [], notify: [], extra: [], status: 'live', statusPuts: [], failStatus: false };
  global.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (method === 'GET' && /\/task\/[^/]+$/.test(u)) return ok({ id: 'task', status: { status: db.status }, custom_fields: [{ id: STATE_FIELD, value: db.field }, ...db.extra] });
    if (method === 'PUT' && /\/task\/[^/]+$/.test(u)) { if (db.failStatus) return { ok: false, status: 500, json: async () => ({}) }; db.status = JSON.parse(opts.body).status; db.statusPuts.push(db.status); return ok({}); }
    if (method === 'GET' && u.endsWith('/comment')) return ok({ comments: db.comments.slice().reverse() });
    if (method === 'POST' && u.includes('/field/' + STATE_FIELD)) { db.field = JSON.parse(opts.body).value; db.writes++; return ok({}); }
    if (method === 'POST' && u.endsWith('/comment')) { const b = JSON.parse(opts.body); db.posts.push(b.comment_text); db.notify.push(b.notify_all); db.comments.push({ comment_text: b.comment_text }); return ok({ id: 'c' }); }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  process.env.CLICKUP_API_TOKEN = 'token';
  process.env.CUE_SECRET = 'test-legacy-secret';
  process.env.CUE_SECRET_V2 = 'test-secret-passphrase-v2';
  delete require.cache[FN];
  return { db, h: require(FN) };
}
const get = async (h, q) => {
  const p = { ...q }, headers = { host: 'example.test' };
  if (p.k) headers.authorization = 'Bearer ' + p.k;
  delete p.k;
  const r = await h.handler({ httpMethod: 'GET', queryStringParameters: p, headers });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const post = async (h, b) => {
  const p = { ...b }, headers = { host: 'example.test' };
  if (p.k) headers.authorization = 'Bearer ' + p.k;
  delete p.k;
  const r = await h.handler({ httpMethod: 'POST', body: JSON.stringify(p), headers });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const tick = () => new Promise((r) => setTimeout(r, 5));
test('close out wraps the show and asks vendors for a Google review', async () => {
  const { db, h } = harness();
  const { EVENTS } = require('../netlify/functions/_cue-events');
  const ev = EVENTS.demo, k = process.env.CUE_SECRET_V2, { READY, REVIEW_URL, CLOSED_LINK_DAYS } = h._test;
  const photo = ev.vendors.find((v) => v.id === 'photo'), token = h._test.tokenFor('demo', photo);
  const video = ev.vendors.find((v) => v.id === 'video'), vtoken = h._test.tokenFor('demo', video);
  let c = await get(h, { e: 'demo', k });
  assert.equal(c.body.closed, null);
  c = await post(h, { e: 'demo', k, action: 'closeout', rev: c.body.state.rev });
  assert.equal(c.status, 409, 'a rehearsal cannot close out the show'); assert.equal(db.statusPuts.length, 0);
  assert.equal((await post(h, { e: 'demo', t: token, action: 'review' })).status, 409, 'no review ask before close out');
  for (const item of READY) c = await post(h, { e: 'demo', k, action: 'ready', item, on: true });
  await tick();
  c = await post(h, { e: 'demo', k, action: 'mode', mode: 'live', rev: c.body.state.rev });
  await tick();
  await post(h, { e: 'demo', t: token, action: 'checkin' });
  const alert = await post(h, { e: 'demo', t: token, action: 'alert', text: 'Need an extension cord', level: 'urgent' });
  assert.equal((await post(h, { e: 'demo', t: token, action: 'closeout' })).status, 403, 'vendors cannot close out');
  c = await get(h, { e: 'demo', k });
  c = await post(h, { e: 'demo', k, action: 'closeout', rev: c.body.state.rev });
  assert.equal(c.status, 409, 'open alerts block close out'); assert.deepEqual(c.body.openAlerts, [alert.body.id]);
  assert.equal(c.body.closed, null); assert.equal(db.statusPuts.length, 0);
  await post(h, { e: 'demo', k, action: 'resolve', alertId: alert.body.id });
  c = await get(h, { e: 'demo', k });
  assert.equal((await post(h, { e: 'demo', k, action: 'closeout', rev: c.body.state.rev - 1 })).status, 409, 'a stale console cannot close out');
  c = await post(h, { e: 'demo', k, action: 'closeout', rev: c.body.state.rev });
  assert.equal(c.status, 200); assert.ok(c.body.closed.at); assert.equal(c.body.closed.wrapped, true);
  assert.equal(db.status, 'wrapped', 'the ClickUp task moves to WRAPPED'); assert.equal(c.body.closed.prevStatus, 'live');
  assert.ok(db.posts.at(-1).startsWith('🏁 Show closed out by Afia · 1 of 8 vendors checked in · 1 alert, all resolved. Task moved to WRAPPED.'));
  assert.equal(c.body.review.url, REVIEW_URL); assert.deepEqual(c.body.review.tapped, []);
  assert.equal(c.body.linksOffAt, c.body.closed.at + CLOSED_LINK_DAYS * 864e5);
  // Vendor page: thank-you, the review link, and the event team list. No timeline, coordinator phone, or messages.
  const v = await get(h, { e: 'demo', t: token });
  assert.equal(v.status, 200); assert.ok(v.body.closed); assert.equal(v.body.review.url, REVIEW_URL); assert.equal(v.body.review.tapped, false);
  assert.equal(v.body.moments, undefined); assert.equal(v.body.broadcasts, undefined); assert.equal(v.body.event.coordinator, undefined);
  assert.ok(!JSON.stringify(v.body).includes(ev.coordinator.phone), 'no phone numbers after close out');
  for (const action of ['checkin', 'alert', 'gotit']) assert.equal((await post(h, { e: 'demo', t: token, action, text: 'x', ref: 'x' })).status, 409, action + ' is over after close out');
  for (const body of [{ action: 'go', momentId: 'm01' }, { action: 'reset' }, { action: 'mode', mode: 'practice' }, { action: 'broadcast', text: 'hi' }, { action: 'ready', item: 'signal', on: false }, { action: 'closeout' }]) {
    const r = await post(h, { e: 'demo', k, ...body, rev: c.body.state.rev });
    assert.equal(r.status, 409, body.action + ' is frozen after close out'); assert.match(r.body.error, /closed out/);
  }
  // Review taps: once per vendor, quiet, visible to the coordinator.
  const posts = db.posts.length;
  let r = await post(h, { e: 'demo', t: token, action: 'review' });
  assert.equal(r.status, 200); assert.equal(r.body.url, REVIEW_URL);
  assert.equal(db.posts.length, posts + 1); assert.ok(db.posts.at(-1).startsWith('⭐ Lumen & Lace Photo (Photography) opened the Google review link'));
  assert.equal(db.notify.at(-1), false);
  await post(h, { e: 'demo', t: token, action: 'review' });
  assert.equal(db.posts.length, posts + 1, 'a second tap posts nothing');
  assert.equal((await get(h, { e: 'demo', t: token })).body.review.tapped, true);
  assert.equal((await get(h, { e: 'demo', t: vtoken })).body.review.tapped, false, 'taps are per vendor');
  assert.deepEqual((await get(h, { e: 'demo', k })).body.review.tapped, ['photo']);
  // Reopen undoes a mistake and restores the old status; the timeline comes back.
  c = await get(h, { e: 'demo', k });
  c = await post(h, { e: 'demo', k, action: 'reopen', rev: c.body.state.rev });
  assert.equal(c.status, 200); assert.equal(c.body.closed, null); assert.equal(db.status, 'live');
  assert.ok(db.posts.at(-1).startsWith('↩ Show reopened by Afia'));
  const back = await get(h, { e: 'demo', t: token });
  assert.ok(Array.isArray(back.body.moments)); assert.equal(back.body.closed, undefined);
  assert.equal((await post(h, { e: 'demo', k, action: 'reopen', rev: c.body.state.rev })).status, 409);
  // A failed status move never blocks close out; the comment says to move it by hand.
  db.failStatus = true;
  await tick();
  c = await post(h, { e: 'demo', k, action: 'closeout', rev: c.body.state.rev });
  assert.equal(c.status, 200); assert.equal(c.body.closed.wrapped, false); assert.match(db.posts.at(-1), /Move this task to WRAPPED by hand/);
  assert.deepEqual(c.body.review.tapped, [], 'review taps count from the latest close out');
  // Links turn themselves off after the window.
  const st = JSON.parse(db.field); st.closed.at = Date.now() - (CLOSED_LINK_DAYS + 1) * 864e5; db.field = JSON.stringify(st);
  await tick(); await new Promise((res) => setTimeout(res, 4100));
  assert.equal((await get(h, { e: 'demo', t: token })).status, 404, 'vendor links expire');
  assert.equal((await post(h, { e: 'demo', t: token, action: 'review' })).status, 404);
  assert.equal((await get(h, { e: 'demo', k })).status, 200, 'the console still opens');
});
