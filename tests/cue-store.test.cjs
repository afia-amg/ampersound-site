'use strict';
// Conference-scale reads: comment paging and the shared vendor snapshot.
const assert = require('node:assert/strict'), { test } = require('node:test');
const { makeLoader, fetchComments, PAGE } = require('../netlify/functions/_cue-store');

function clickup(n, { taskSince = 0 } = {}) {
  // n comments, newest first, 1 second apart, ending at t=1_000_000.
  const all = Array.from({ length: n }, (_, i) => ({ id: 'c' + i, date: String(1_000_000 - i * 1000), comment_text: 'AMG_CUE_V1:' + JSON.stringify({ id: 'e' + i, type: 'checkin', at: 1_000_000 - i * 1000 }) }));
  const calls = [];
  const api = async (path) => {
    calls.push(path);
    if (!path.includes('/comment')) return { id: 'task', status: { status: 'live' }, custom_fields: [], since: taskSince };
    const u = new URL('https://x' + path);
    const start = u.searchParams.get('start');
    const from = start ? all.findIndex((c) => c.id === u.searchParams.get('start_id')) + 1 : 0;
    return { comments: all.slice(from, from + PAGE) };
  };
  return { api, calls, all };
}
function memoryStore() {
  const data = new Map(), ops = [];
  return {
    data, ops,
    async get(k) { ops.push('get ' + k); return data.has(k) ? JSON.parse(data.get(k)) : null; },
    async set(k, v, o = {}) { ops.push('set ' + k); if (o.onlyIfNew && data.has(k)) return { modified: false }; data.set(k, JSON.stringify(v)); return { modified: true, etag: '"1"' }; },
    async setJSON(k, v) { ops.push('setJSON ' + k); data.set(k, JSON.stringify(v)); return { modified: true }; },
    async delete(k) { ops.push('delete ' + k); data.delete(k); },
  };
}

test('every comment since the session started is read, not just the newest 25', async () => {
  const { api, calls } = clickup(130);
  const got = await fetchComments(api, 'task', 0);
  assert.equal(got.length, 130);
  assert.equal(calls.length, 6, '130 comments = 5 full pages + 1 short page');
  assert.equal(new Set(got.map((c) => c.id)).size, 130, 'no duplicates');
});

test('paging stops once it reaches comments from before the current session', async () => {
  const { api, calls } = clickup(500);
  const since = 1_000_000 - 60 * 1000; // session started 60 comments ago
  const got = await fetchComments(api, 'task', since);
  assert.ok(got.length >= 60 && got.length <= 75, 'reads the session plus at most one older page, got ' + got.length);
  assert.equal(calls.length, 3);
});

test('paging is capped and survives comments without dates', async () => {
  const many = clickup(5000);
  const got = await fetchComments(many.api, 'task', 0);
  assert.equal(got.length, 25 * 40, 'hard cap of 40 pages');
  const api = async () => ({ comments: Array.from({ length: 25 }, (_, i) => ({ comment_text: 'x' + i })) });
  assert.equal((await fetchComments(api, 'task', 0)).length, 25, 'no dates means no cursor, so one page');
});

test('many vendor phones share one ClickUp refresh', async () => {
  const { api, calls } = clickup(10);
  let t = 50_000;
  const store = memoryStore();
  const phones = Array.from({ length: 20 }, () => makeLoader({ api, sinceOf: () => 0, now: () => t }));
  for (const p of phones) p.connect(null, store);
  for (const p of phones) await p.load('task', false);
  assert.equal(calls.filter((c) => !c.includes('/comment')).length, 1, '20 cold functions, one task read');
  assert.ok(store.data.has('snap/task'));
  t += 3500; // snapshot is now older than sharedTtl
  for (const p of phones) await p.load('task', false);
  assert.equal(calls.filter((c) => !c.includes('/comment')).length, 2, 'one refresh per window');
  assert.ok(![...store.data.keys()].some((k) => k.startsWith('lock/')), 'refresh locks are cleaned up');
});

test('a phone that loses the refresh race keeps the recent copy instead of piling on', async () => {
  const { api, calls } = clickup(3);
  let t = 90_000;
  const store = memoryStore();
  const a = makeLoader({ api, sinceOf: () => 0, now: () => t }); a.connect(null, store);
  await a.load('task', false);
  t += 3200;
  await store.set(`lock/task/${Math.floor(t / 3000)}`, '1', { onlyIfNew: true }); // someone else is refreshing
  const b = makeLoader({ api, sinceOf: () => 0, now: () => t }); b.connect(null, store);
  const before = calls.length;
  const got = await b.load('task', false);
  assert.equal(calls.length, before, 'no extra ClickUp call');
  assert.equal(got.comments.length, 3);
});

test('coordinator reads and writes always go to ClickUp and refresh the shared copy', async () => {
  const { api, calls } = clickup(2);
  const store = memoryStore();
  const l = makeLoader({ api, sinceOf: () => 0 }); l.connect(null, store);
  await l.load('task', false);
  const n = calls.length;
  await l.load('task', true);
  assert.ok(calls.length > n, 'fresh reads skip every cache');
  l.forget('task');
  await new Promise((r) => setTimeout(r, 1));
  assert.ok(!store.data.has('snap/task'), 'a write drops the shared copy');
});

test('a broken shared store falls back to ClickUp', async () => {
  const { api } = clickup(4);
  const broken = { get: async () => { throw Error('blobs down'); }, set: async () => { throw Error('x'); }, setJSON: async () => { throw Error('x'); }, delete: async () => { throw Error('x'); } };
  const l = makeLoader({ api, sinceOf: () => 0 }); l.connect(null, broken);
  const got = await l.load('task', false);
  assert.equal(got.comments.length, 4);
  const none = makeLoader({ api, sinceOf: () => 0 }); none.connect({});
  assert.equal((await none.load('task', false)).comments.length, 4, 'no Blobs package or environment: plain ClickUp reads');
});
