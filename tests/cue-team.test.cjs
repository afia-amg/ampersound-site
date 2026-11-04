'use strict';
// Vendor messaging, the event team list, and DJ songs. All ClickUp traffic is mocked.
const assert = require('node:assert/strict'), path = require('node:path'), { test } = require('node:test');
const FN = path.resolve(__dirname, '..', 'netlify/functions/cue.js');
const STATE_FIELD = '745508ca-6e71-4541-8d49-a10a9acab836';
const K = 'test-secret-passphrase-v2';
function harness() {
  const db = { field: null, comments: [], posts: [], notify: [], extra: [], failTask: null };
  global.fetch = async (url, opts = {}) => {
    const u = String(url), method = opts.method || 'GET';
    const ok = (body) => ({ ok: true, status: 200, json: async () => body });
    if (method === 'GET' && db.failTask && u.endsWith('/task/' + db.failTask)) return { ok: false, status: 500, json: async () => ({}) };
    if (method === 'GET' && /\/task\/[^/]+$/.test(u)) return ok({ id: 'task', custom_fields: [{ id: STATE_FIELD, value: db.field }, ...db.extra] });
    if (method === 'GET' && u.endsWith('/comment')) return ok({ comments: db.comments.slice().reverse() });
    if (method === 'POST' && u.includes('/field/' + STATE_FIELD)) { db.field = JSON.parse(opts.body).value; return ok({}); }
    if (method === 'POST' && u.endsWith('/comment')) { const b = JSON.parse(opts.body); db.posts.push(b.comment_text); db.notify.push(b.notify_all); db.comments.push({ comment_text: b.comment_text }); return ok({ id: 'c' }); }
    if (method === 'PUT') return ok({});
    return { ok: false, status: 500, json: async () => ({}) };
  };
  process.env.CLICKUP_API_TOKEN = 'token'; process.env.CUE_SECRET_V2 = K;
  delete require.cache[FN];
  const h = require(FN);
  const { EVENTS } = require('../netlify/functions/_cue-events');
  const tok = (id) => h._test.tokenFor('demo', EVENTS.demo.vendors.find((v) => v.id === id));
  return { db, h, ev: EVENTS.demo, tok };
}
const call = async (h, method, q) => {
  const p = { ...q }, headers = { host: 'example.test' };
  if (p.k) headers.authorization = 'Bearer ' + p.k;
  delete p.k;
  const r = method === 'GET' ? await h.handler({ httpMethod: 'GET', queryStringParameters: p, headers }) : await h.handler({ httpMethod: 'POST', body: JSON.stringify(p), headers });
  return { status: r.statusCode, body: JSON.parse(r.body) };
};
const get = (h, q) => call(h, 'GET', q), post = (h, q) => call(h, 'POST', q);

test('every vendor sees the event team, with details only from vendors who opted in', async () => {
  const { h, tok } = harness();
  const v = (await get(h, { e: 'demo', t: tok('video') })).body;
  const byId = Object.fromEntries(v.team.map((x) => [x.id, x]));
  assert.ok(!byId.video, 'you are not listed to yourself');
  assert.equal(v.team.length, 7);
  assert.deepEqual(byId.photo.card, { person: 'Maya', phone: '+18015550142', phoneLabel: '(801) 555-0142', email: 'hello@lumenlace.example', instagram: 'lumenandlace', website: '' });
  assert.equal(byId.amg.card.email, 'afia@ampersoundmediagroup.com', 'older configs keep using the contact field');
  assert.equal(byId.officiant.card, null, 'no opt-in, no details');
  assert.equal(byId.officiant.name, 'Rev. Dana Ellis', 'but the name and role still show');
  assert.ok(!JSON.stringify(v).includes('555-0199'), 'a hidden phone never reaches the page');
  assert.ok(!JSON.stringify(v).includes('/cue/demo/'), 'other vendors\u2019 private links never leak');
  const { cardOf } = h._test;
  assert.equal(cardOf({ share: true, instagram: '@bad handle!', website: 'javascript:alert(1)', email: 'nope' }), null, 'junk details are dropped, not shown');
  assert.equal(cardOf({ phone: '(801) 555-0100' }), null, 'sharing is opt-in: unset means hidden');
  assert.equal(cardOf({ share: false, phone: '(801) 555-0100' }), null);
  assert.equal(cardOf({ share: 'yes', phone: '(801) 555-0100' }), null, 'only an explicit true counts');
});

test('vendors choose who gets a message', async () => {
  const { db, h, tok } = harness();
  const photo = tok('photo'), video = tok('video'), cater = tok('catering');
  assert.equal((await post(h, { e: 'demo', t: photo, action: 'message', to: 'video', text: '  ' })).status, 400);
  assert.equal((await post(h, { e: 'demo', t: photo, action: 'message', to: 'nobody', text: 'Hi' })).status, 400);
  assert.equal((await post(h, { e: 'demo', t: photo, action: 'message', to: 'photo', text: 'Hi' })).status, 400, 'not to yourself');
  const dm = await post(h, { e: 'demo', t: photo, action: 'message', to: 'video', text: 'Meet at the terrace for portraits?', level: 'urgent' });
  assert.equal(dm.status, 200); assert.equal(dm.body.to, 'video');
  assert.equal(db.posts.at(-1).split('\n')[0], '💬 Lumen & Lace Photo to Fieldnote Films: Meet at the terrace for portraits?');
  assert.equal(db.notify.at(-1), false, 'vendor chatter never pings the whole ClickUp task');
  let v = (await get(h, { e: 'demo', t: video })).body;
  assert.equal(v.broadcasts.length, 1); assert.equal(v.broadcasts[0].from, 'photo'); assert.equal(v.broadcasts[0].direct, true);
  assert.equal(v.broadcasts[0].level, 'note', 'only the point of contact can get an urgent alert');
  assert.equal((await get(h, { e: 'demo', t: cater })).body.broadcasts.length, 0, 'a direct message reaches only its vendor');
  const me = (await get(h, { e: 'demo', t: photo })).body;
  assert.equal(me.broadcasts.length, 0, 'you do not get your own message back');
  assert.equal(me.sent.length, 1); assert.equal(me.sent[0].to, 'video'); assert.equal(me.sent[0].gotIt, 0);
  assert.equal((await post(h, { e: 'demo', t: photo, action: 'gotit', ref: dm.body.id })).status, 404, 'the sender cannot mark it read');
  assert.equal((await post(h, { e: 'demo', t: cater, action: 'gotit', ref: dm.body.id })).status, 404);
  assert.equal((await post(h, { e: 'demo', t: video, action: 'gotit', ref: dm.body.id })).status, 200);
  assert.equal((await get(h, { e: 'demo', t: photo })).body.sent[0].gotIt, 1, 'the sender sees it was read');
  const all = await post(h, { e: 'demo', t: cater, action: 'message', to: 'all', text: 'Dinner plates out at 6:50' });
  assert.equal(all.status, 200); assert.equal(all.body.to, 'all');
  assert.equal((await get(h, { e: 'demo', t: photo })).body.broadcasts[0].text, 'Dinner plates out at 6:50');
  assert.equal((await get(h, { e: 'demo', t: cater })).body.broadcasts.length, 0);
  const c = (await get(h, { e: 'demo', k: K })).body;
  assert.equal(c.broadcasts.length, 2, 'the coordinator sees every vendor message');
  assert.deepEqual(c.broadcasts.map((b) => b.from), ['catering', 'photo']);
  // To the point of contact is the existing alert, with urgency and a ClickUp notification.
  const a = await post(h, { e: 'demo', t: video, action: 'message', to: 'coordinator', text: 'Drone battery died', level: 'urgent' });
  assert.equal(a.status, 200); assert.equal(db.notify.at(-1), true);
  const c2 = (await get(h, { e: 'demo', k: K })).body;
  assert.equal(c2.alerts[0].text, 'Drone battery died'); assert.equal(c2.alerts[0].level, 'urgent');
  assert.equal((await post(h, { e: 'demo', t: photo, action: 'broadcast', text: 'x' })).status, 403, 'vendors still cannot use the coordinator broadcast');
});

test('one vendor cannot flood the team', async () => {
  const { h, tok } = harness();
  const { MSG_LIMIT } = h._test, photo = tok('photo');
  for (let i = 0; i < MSG_LIMIT; i++) assert.equal((await post(h, { e: 'demo', t: photo, action: 'message', to: 'all', text: 'm' + i })).status, 200);
  assert.equal((await post(h, { e: 'demo', t: photo, action: 'message', to: 'all', text: 'one more' })).status, 429);
  assert.equal((await post(h, { e: 'demo', t: tok('video'), action: 'message', to: 'all', text: 'still fine' })).status, 200, 'the limit is per vendor');
});

test('the DJ sees each moment\u2019s song and the playlist; other vendors do not', async () => {
  const { h, tok } = harness();
  const dj = (await get(h, { e: 'demo', t: tok('amg') })).body;
  assert.equal(dj.music, true);
  const fd = dj.moments.find((m) => m.id === 'm08');
  assert.deepEqual(fd.music, [{ key: 'firstDance', label: 'First Dance', song: 'Adorn · Miguel' }]);
  assert.deepEqual(dj.moments.find((m) => m.id === 'm05').music.map((x) => x.key), ['bridalParty', 'aisle', 'recessional']);
  const exit = dj.moments.find((m) => m.id === 'm13');
  assert.equal(exit.music[0].song, 'September · Earth, Wind & Fire', 'a song cue shows even when the DJ is not on that moment');
  assert.equal(exit.location, 'Front drive');
  assert.equal(dj.playlist.url, 'https://open.spotify.com/search/wedding%20reception');
  assert.ok(dj.playlist.mustPlay.length && dj.playlist.dontPlay.length);
  const photo = (await get(h, { e: 'demo', t: tok('photo') })).body;
  assert.equal(photo.music, false); assert.equal(photo.playlist, null);
  assert.ok(!JSON.stringify(photo).includes('Adorn'), 'songs stay with the DJ and the coordinator');
  const c = (await get(h, { e: 'demo', k: K })).body;
  assert.equal(c.moments.find((m) => m.id === 'm08').music[0].song, 'Adorn · Miguel');
  assert.ok(c.playlist.url);
  assert.equal(h._test.isMusic({ role: 'Photo booth' }), false); assert.equal(h._test.isMusic({ role: 'DJ' }), true); assert.equal(h._test.isMusic({ role: 'Band', music: true }), true);
});

test('real events read songs live from the client agreement, and survive it being down', async () => {
  const { db, h, ev, tok } = harness();
  const sample = ev.sampleSongs;
  delete ev.sampleSongs; ev.agreementTaskId = 'agr123';
  try {
    db.extra = [{ id: h._test.AGREEMENT_DATA, value: JSON.stringify({ songs: { moments: { firstDance: 'Lovely Day · Bill Withers', aisle: '' }, playlist: 'javascript:alert(1)', mustPlay: ['Crazy in Love'] }, labels: { songs: { moments: { firstDance: 'First Dance' } } } }) }];
    h._test.songCache.clear();
    const dj = (await get(h, { e: 'demo', t: tok('amg') })).body;
    assert.equal(dj.moments.find((m) => m.id === 'm08').music[0].song, 'Lovely Day · Bill Withers');
    assert.equal(dj.moments.find((m) => m.id === 'm05').music, undefined, 'blank songs are skipped');
    assert.equal(dj.playlist.url, '', 'only https playlist links are shown');
    assert.deepEqual(dj.playlist.mustPlay, ['Crazy in Love']);
    h._test.songCache.clear(); db.failTask = 'agr123';
    const down = await get(h, { e: 'demo', t: tok('amg') });
    assert.equal(down.status, 200, 'the show never breaks because songs are unavailable');
    assert.equal(down.body.playlist, null);
  } finally { ev.sampleSongs = sample; delete ev.agreementTaskId; h._test.songCache.clear(); }
});

test('after close out the team list stays so vendors can keep in touch; messaging stops', async () => {
  const { db, h, tok } = harness();
  db.field = JSON.stringify({ v: 1, mode: 'live', ready: {}, calls: {}, done: {}, rev: 3, session: 2, since: 0, closed: { at: Date.now(), by: 'Afia', prevStatus: 'live' } });
  const v = (await get(h, { e: 'demo', t: tok('photo') })).body;
  assert.ok(v.closed); assert.equal(v.moments, undefined, 'no timeline after close out');
  assert.equal(v.team.find((x) => x.id === 'video').card.phone, '+18015550157');
  assert.equal((await post(h, { e: 'demo', t: tok('photo'), action: 'message', to: 'video', text: 'Thanks!' })).status, 409);
});
