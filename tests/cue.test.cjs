'use strict';
// Cue Sheet vendor links: auth, privacy, and show-state contracts with ClickUp mocked.
const assert = require('node:assert/strict'), path = require('node:path'), { test } = require('node:test');
const FN = path.resolve(__dirname, '..', 'netlify/functions/cue.js');
const STATE_FIELD = '745508ca-6e71-4541-8d49-a10a9acab836';

function harness() {
  const db = { field: null, comments: [], writes: 0, posts: [] };
  global.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (method === 'GET' && /\/task\/[^/]+$/.test(u)) return ok({ id: 'task', custom_fields: [{ id: STATE_FIELD, value: db.field }] });
    if (method === 'GET' && u.endsWith('/comment')) return ok({ comments: db.comments.slice().reverse() });
    if (method === 'POST' && u.includes('/field/' + STATE_FIELD)) { db.field = JSON.parse(opts.body).value; db.writes++; return ok({}); }
    if (method === 'POST' && u.endsWith('/comment')) { const b = JSON.parse(opts.body); db.posts.push(b.comment_text); db.comments.push({ comment_text: b.comment_text }); return ok({ id: 'c' }); }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  process.env.CLICKUP_API_TOKEN = 'token';
  process.env.CUE_SECRET = 'test-secret-passphrase';
  delete require.cache[FN];
  return { db, h: require(FN) };
}
const get = (h, q) => h.handler({ httpMethod: 'GET', queryStringParameters: q, headers: { host: 'example.test' } }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const post = (h, b) => h.handler({ httpMethod: 'POST', body: JSON.stringify(b), headers: { host: 'example.test' } }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

test('cue sheet: links, privacy, GO/undo, check-ins', async () => {
  const { db, h } = harness();
  const { EVENTS } = require('../netlify/functions/_cue-events');
  const ev = EVENTS.demo, photo = ev.vendors.find((v) => v.id === 'photo');
  const token = h._test.tokenFor('demo', photo);

  // Not configured -> closed.
  const saved = process.env.CUE_SECRET; delete process.env.CUE_SECRET;
  assert.equal((await h.handler({ httpMethod: 'GET', queryStringParameters: { e: 'demo', t: token } })).statusCode, 503);
  process.env.CUE_SECRET = saved;

  // Bad links and passcodes are refused without leaking anything.
  assert.equal((await get(h, { e: 'demo', t: 'nope' })).status, 404);
  assert.equal((await get(h, { e: 'demo', k: 'wrong' })).status, 401);
  assert.equal((await get(h, { e: 'missing', t: token })).status, 404);
  assert.equal((await get(h, { e: '__proto__', t: token })).status, 404);

  // A vendor sees their own rows in detail, other rows as titles only, and no contacts or links.
  const v = await get(h, { e: 'demo', t: token });
  assert.equal(v.status, 200);
  assert.equal(v.body.vendor.name, 'Lumen & Lace Photo');
  const raw = JSON.stringify(v.body);
  assert.ok(!raw.includes('/cue/demo/'), 'vendor payload must not include anyone\'s link');
  assert.ok(!raw.includes('afia@ampersoundmediagroup.com'), 'vendor payload must not include vendor contacts');
  assert.equal(v.body.moments.find((m) => m.id === 'm03').location, undefined);
  assert.equal(v.body.moments.find((m) => m.id === 'm02').location, 'Garden terrace');

  // Vendors cannot run the show.
  assert.equal((await post(h, { e: 'demo', t: token, action: 'go', momentId: 'm01' })).status, 403);

  // Coordinator GO closes the previous moment; undo puts it back.
  const k = saved;
  let c = await post(h, { e: 'demo', k, action: 'go', momentId: 'm01' });
  assert.equal(c.status, 200);
  assert.ok(c.body.state.calls.m01 && c.body.state.anchor);
  c = await post(h, { e: 'demo', k, action: 'go', momentId: 'm02' });
  assert.ok(c.body.state.done.m01 && c.body.state.calls.m02);
  c = await post(h, { e: 'demo', k, action: 'undo' });
  assert.ok(!c.body.state.calls.m02 && !c.body.state.done.m01);
  assert.equal(c.body.vendors.find((x) => x.id === 'photo').link, 'https://example.test/cue/demo/' + token);

  // Check-in lands as a ClickUp comment and is folded into state for the coordinator.
  const ci = await post(h, { e: 'demo', t: token, action: 'checkin' });
  assert.equal(ci.status, 200);
  assert.ok(db.posts.at(-1).startsWith('✅ Lumen & Lace Photo'));
  const coord = await get(h, { e: 'demo', k });
  assert.ok(coord.body.vendors.find((x) => x.id === 'photo').checkedIn, JSON.stringify({posts: db.posts.slice(-1), field: db.field}));
  assert.ok(JSON.parse(db.field).checkins.photo);

  // Alerts need text and show up for the coordinator.
  assert.equal((await post(h, { e: 'demo', t: token, action: 'alert', text: '  ' })).status, 400);
  await post(h, { e: 'demo', t: token, action: 'alert', text: 'Stuck in traffic', level: 'urgent' });
  const after = await get(h, { e: 'demo', k });
  assert.equal(after.body.alerts[0].text, 'Stuck in traffic');
  assert.equal(after.body.alerts[0].level, 'urgent');

  // Bumping rev turns the old link off.
  photo.rev = 2;
  assert.equal((await get(h, { e: 'demo', t: token })).status, 404);
  photo.rev = 1;
});
