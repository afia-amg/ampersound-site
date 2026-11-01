'use strict';
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs'), vm = require('node:vm'), { test } = require('node:test');
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
test('cue sheet: V2-only auth, privacy, GO/undo, check-ins and alerts', async () => {
  const { db, h } = harness();
  const { EVENTS } = require('../netlify/functions/_cue-events');
  const ev = EVENTS.demo, photo = ev.vendors.find((v) => v.id === 'photo');
  const token = h._test.tokenFor('demo', photo);
  const saved = process.env.CUE_SECRET_V2;
  delete process.env.CUE_SECRET_V2;
  assert.equal((await h.handler({ httpMethod: 'GET', queryStringParameters: { e: 'demo', t: token } })).statusCode, 503, 'legacy secret alone must fail closed');
  process.env.CUE_SECRET_V2 = saved;
  assert.equal((await get(h, { e: 'demo', k: process.env.CUE_SECRET })).status, 401, 'legacy coordinator passcode is refused');
  const legacyToken = require('node:crypto').createHmac('sha256', process.env.CUE_SECRET).update(`demo:${photo.id}:${photo.rev || 1}`).digest('base64url').slice(0, 16);
  assert.equal((await get(h, { e: 'demo', t: legacyToken })).status, 404, 'legacy vendor tokens are refused');
  assert.equal((await get(h, { e: 'demo', t: 'nope' })).status, 404);
  assert.equal((await get(h, { e: 'demo', k: 'wrong' })).status, 401);
  assert.equal((await get(h, { e: 'missing', t: token })).status, 404);
  assert.equal((await get(h, { e: '__proto__', t: token })).status, 404);
  const before = db.writes;
  for (const headers of [{}, { Authorization: 'Bearer ' + saved }]) {
    const r = await h.handler({ httpMethod: 'GET', queryStringParameters: { e: 'demo', k: saved }, headers });
    assert.equal(r.statusCode, 400, 'URL credentials must never authenticate');
    assert.ok(!r.body.includes(saved), 'errors must not echo secrets');
  }
  assert.equal((await h.handler({ httpMethod: 'POST', body: JSON.stringify({ e: 'demo', k: saved, action: 'go', momentId: 'm01' }), headers: {} })).statusCode, 400);
  assert.equal(db.writes, before, 'rejected credentials cannot change state');
  assert.equal((await h.handler({ httpMethod: 'GET', queryStringParameters: { e: 'demo' }, headers: { Authorization: 'Bearer ' + saved } })).statusCode, 200, 'header lookup is case-insensitive');
  const v = await get(h, { e: 'demo', t: token });
  assert.equal(v.status, 200); assert.equal(v.body.vendor.name, 'Lumen & Lace Photo');
  const raw = JSON.stringify(v.body);
  assert.ok(!raw.includes('/cue/demo/')); assert.ok(!raw.includes('afia@ampersoundmediagroup.com')); assert.ok(!raw.includes(saved));
  assert.equal(v.body.moments.find((m) => m.id === 'm03').location, undefined);
  assert.equal(v.body.moments.find((m) => m.id === 'm02').location, 'Garden terrace');
  assert.equal((await post(h, { e: 'demo', t: token, action: 'go', momentId: 'm01' })).status, 403);
  const k = saved;
  let c = await post(h, { e: 'demo', k, action: 'go', momentId: 'm01' });
  assert.equal(c.status, 200); assert.ok(c.body.state.calls.m01 && c.body.state.anchor);
  c = await post(h, { e: 'demo', k, action: 'go', momentId: 'm02' });
  assert.ok(c.body.state.done.m01 && c.body.state.calls.m02);
  c = await post(h, { e: 'demo', k, action: 'undo' });
  assert.ok(!c.body.state.calls.m02 && !c.body.state.done.m01);
  assert.equal(c.body.vendors.find((x) => x.id === 'photo').link, 'https://example.test/cue/demo/' + token);
  const ci = await post(h, { e: 'demo', t: token, action: 'checkin' });
  assert.equal(ci.status, 200); assert.ok(db.posts.at(-1).startsWith('✅ Lumen & Lace Photo'));
  const coord = await get(h, { e: 'demo', k });
  assert.ok(coord.body.vendors.find((x) => x.id === 'photo').checkedIn); assert.ok(JSON.parse(db.field).checkins.photo);
  assert.equal((await post(h, { e: 'demo', t: token, action: 'alert', text: '  ' })).status, 400);
  await post(h, { e: 'demo', t: token, action: 'alert', text: 'Stuck in traffic', level: 'urgent' });
  const after = await get(h, { e: 'demo', k });
  assert.equal(after.body.alerts[0].text, 'Stuck in traffic'); assert.equal(after.body.alerts[0].level, 'urgent');
  const originalRev = photo.rev;
  photo.rev = (originalRev || 1) + 1;
  try {
    assert.equal((await get(h, { e: 'demo', t: token })).status, 404);
    const replacement = h._test.tokenFor('demo', photo);
    assert.notEqual(replacement, token);
    assert.equal((await get(h, { e: 'demo', t: replacement })).status, 200);
  } finally { photo.rev = originalRev; }
});
test('browser transport keeps coordinator secrets out of GET URLs and POST bodies', async () => {
  const requests = [];
  const context = { window: {}, URLSearchParams, fetch: async (url, opts) => { requests.push({ url, opts }); return { ok: true, json: async () => ({ ok: true }) }; } };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../cue/_assets/cue-core.js'), 'utf8'), context);
  const key = 'test-only-not-a-real-passcode';
  const params = { e: 'demo', k: key };
  const body = { e: 'demo', k: key, action: 'go', momentId: 'm01' };
  await context.window.CUE.call(params);
  await context.window.CUE.call(null, body);
  assert.equal(params.k, key); assert.equal(body.k, key, 'callers are not mutated');
  for (const r of requests) {
    assert.ok(!r.url.includes(key)); assert.ok(!new URL(r.url, 'https://example.test').searchParams.has('k'));
    assert.equal(r.opts.headers.Authorization, 'Bearer ' + key);
    assert.equal(r.opts.redirect, 'error'); assert.equal(r.opts.cache, 'no-store');
    if (r.opts.body) { assert.ok(!r.opts.body.includes(key)); assert.ok(!Object.hasOwn(JSON.parse(r.opts.body), 'k')); }
  }
  await context.window.CUE.call({ e: 'demo', t: 'vendor-test-token' });
  assert.equal(requests[2].opts.headers.Authorization, undefined, 'vendor requests have no coordinator secret');
});
