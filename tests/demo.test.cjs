'use strict';
// Client demo (/demo): sample event only. It must never talk to ClickUp, Stripe, or any server.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const html = read('demo/index.html'), js = read('demo/demo.js');
const demo = require(path.join(ROOT, 'demo/demo.js'));

test('demo never sends, stores, or submits anything', () => {
  for (const bad of [/fetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /localStorage/, /sessionStorage/, /\.netlify\/functions/, /api\.clickup/, /stripe\.com/i]) {
    assert.ok(!bad.test(js), `demo.js must not use ${bad}`);
  }
  assert.ok(!/<form/i.test(html), 'demo page has no forms to submit');
  assert.ok(!/href="tel:/i.test(html + js), 'demo never dials a real phone number');
  assert.match(html, /Nothing you do here is saved or sent/);
});

test('every element the script looks up exists on the page', () => {
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const used = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of used) assert.ok(ids.has(id), `missing #${id}`);
  for (const t of ['book', 'plan', 'show', 'wrap']) {
    assert.ok(ids.has('tab-' + t) && ids.has('ch-' + t), `tab + panel for ${t}`);
  }
});

test('countdown follows the 14 / 10 / 7 day standard', () => {
  assert.deepEqual(demo.MILESTONES.filter((m) => m.days < 9999).map((m) => m.days), [14, 10, 7, 1, 0]);
  assert.deepEqual(demo.milestones(120).map((m) => m.state), ['done', 'next', 'later', 'later', 'later', 'later']);
  assert.deepEqual(demo.milestones(10).map((m) => m.state), ['done', 'done', 'done', 'next', 'later', 'later']);
  assert.ok(demo.milestones(0).every((m) => m.state === 'done'));
});

test('a vendor phone shows only that vendor\'s moments', () => {
  const s = demo.fresh();
  const v = demo.vendorView(s, 'officiant');
  assert.deepEqual(v.mine.map((m) => m.title), ['Ceremony']);
  assert.equal(v.hero.title, 'Ceremony');
  assert.equal(v.onNow, false);
  while (demo.MOMENTS[s.cur]?.title !== 'Ceremony') demo.go(s);
  assert.equal(demo.vendorView(s, 'officiant').onNow, true);
  demo.go(s);
  const after = demo.vendorView(s, 'officiant');
  assert.equal(after.hero, null);
  assert.equal(after.mine[0].state, 'done');
});

test('GO and undo stay inside the run of show', () => {
  const s = demo.fresh();
  assert.equal(demo.undo(s), false);
  for (let i = 0; i < demo.MOMENTS.length; i++) assert.equal(demo.go(s), true);
  assert.equal(demo.go(s), false);
  assert.equal(demo.undo(s), true);
  s.closed = true;
  assert.equal(demo.go(s), false);
});

test('close out is blocked until every alert is resolved', () => {
  const s = demo.fresh();
  assert.equal(demo.closeOutCheck(s).ok, true);
  s.alerts.push({ id: 'a1', vendor: 'photo', text: 'x', seen: false, resolved: false });
  const c = demo.closeOutCheck(s);
  assert.equal(c.ok, false);
  assert.match(c.reason, /Resolve the open alert/);
  s.alerts[0].resolved = true;
  assert.equal(demo.closeOutCheck(s).ok, true);
});

test('song lists reject blanks and duplicates and escape on render', () => {
  const s = demo.fresh();
  assert.equal(demo.addSong(s, 'must', '   '), 'Type a song first.');
  assert.equal(demo.addSong(s, 'dont', 'september · earth, wind & fire'), 'That one is already on a list.');
  assert.equal(demo.addSong(s, 'dont', 'Cha Cha Slide'), '');
  assert.ok(s.dont.includes('Cha Cha Slide'));
  assert.equal(demo.esc('<img onerror=x>'), '&lt;img onerror=x&gt;');
});

test('demo copy follows house style', () => {
  assert.ok(!/[\u2013\u2014]/.test(html + js), 'no en or em dashes');
  assert.match(html, /scheduler\.zoom\.us\/afia-chin-roberts\/discovery-meeting-with-ampersound-media-group/);
});
