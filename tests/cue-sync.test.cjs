'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../netlify/functions/_cue-sync');

const EVENTS = {
  'angela-joe': {
    name: 'Angela & Joe', date: '2027-05-28', taskId: 'cue1', agreementTaskId: 'agr1', lanes: ['Run of show'],
    vendors: [{ id: 'amg', name: 'Ampersound Media Group', role: 'DJ + MC', rev: 1 }], moments: [],
  },
};
const TIMELINE = { moments: [
  { time: '11:00 PM', event: 'Sparkler exit' },
  { time: '5:00 PM', event: 'Ceremony begins' },
  { time: '12:15 AM', event: 'Load out' },
  { time: 'TBD', event: 'Bouquet toss' },
  { time: '', event: '' },
  { time: '7:30 pm', event: 'First dance' },
], notes: '' };

function fakeApi(plan, comments = []) {
  const calls = [];
  const task = () => ({ id: 'cue1', custom_fields: plan ? [{ id: S.PLAN_FIELD, value: JSON.stringify(plan) }] : [] });
  const api = async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null });
    if (/\/comment$/.test(path) && !opts.method) return { comments };
    if (/\/field\//.test(path)) { plan = JSON.parse(JSON.parse(opts.body).value); return {}; }
    if (/\/comment$/.test(path)) { comments.push({ comment_text: JSON.parse(opts.body).comment_text }); return {}; }
    return task();
  };
  return { api, calls, get plan() { return plan; }, comments };
}
const NOW = Date.parse('2026-11-09T17:00:00Z');

test('portal timeline becomes an ordered draft plan, after-midnight rows last, bad rows skipped', () => {
  const { plan, skipped } = S.planFromTimeline(TIMELINE, EVENTS['angela-joe'], null);
  assert.deepStrictEqual(plan.moments.map((m) => m.title), ['Ceremony begins', 'First dance', 'Sparkler exit', 'Load out']);
  assert.strictEqual(plan.moments[0].time, 17 * 60);
  assert.strictEqual(plan.moments[0].dur, 150);
  assert.strictEqual(plan.moments[2].dur, 75);
  assert.strictEqual(plan.moments[3].dur, 30);
  assert.deepStrictEqual(plan.moments[0].songs, ['bridalParty', 'aisle', 'recessional']);
  assert.deepStrictEqual(plan.moments[1].songs, ['firstDance']);
  assert.deepStrictEqual(plan.moments[2].songs, ['exit']);
  assert.ok(plan.moments.every((m) => m.vendors.includes('amg')));
  assert.strictEqual(skipped.length, 1);
  assert.match(skipped[0], /Bouquet toss/);
});

test('first save writes a portal-owned plan; same timeline again writes nothing', async () => {
  const f = fakeApi(null);
  const r = await S.syncTimeline({ agreementTaskId: 'agr1', timeline: TIMELINE, api: f.api, now: NOW, events: EVENTS });
  assert.strictEqual(r.synced, true);
  assert.strictEqual(f.plan.source, 'portal');
  assert.strictEqual(f.plan.version, 1);
  assert.strictEqual(f.comments.length, 1, 'skipped rows are listed once');
  const writes = f.calls.filter((c) => /\/field\//.test(c.path)).length;
  const again = await S.syncTimeline({ agreementTaskId: 'agr1', timeline: TIMELINE, api: f.api, now: NOW, events: EVENTS });
  assert.strictEqual(again.reason, 'unchanged');
  assert.strictEqual(f.calls.filter((c) => /\/field\//.test(c.path)).length, writes);
});

test('a coordinator-published plan is never overwritten; the change is noted once', async () => {
  const published = { v: 1, lanes: ['Run of show'], moments: [{ id: 'x', time: 1000, dur: 10, title: 'Locked moment' }], vendors: [], version: 3, by: 'Afia' };
  const f = fakeApi(published);
  const r1 = await S.syncTimeline({ agreementTaskId: 'agr1', timeline: TIMELINE, api: f.api, now: NOW, events: EVENTS });
  const r2 = await S.syncTimeline({ agreementTaskId: 'agr1', timeline: TIMELINE, api: f.api, now: NOW, events: EVENTS });
  assert.strictEqual(r1.reason, 'coordinator-plan');
  assert.strictEqual(r2.reason, 'coordinator-plan');
  assert.strictEqual(f.plan.version, 3);
  assert.strictEqual(f.plan.moments[0].title, 'Locked moment');
  assert.strictEqual(f.comments.length, 1);
});

test('inside 14 days the timeline is locked, even for a portal draft', async () => {
  const f = fakeApi(null);
  const r = await S.syncTimeline({ agreementTaskId: 'agr1', timeline: TIMELINE, api: f.api, now: Date.parse('2027-05-20T17:00:00Z'), events: EVENTS });
  assert.strictEqual(r.reason, 'locked');
  assert.strictEqual(f.plan, null);
  assert.strictEqual(f.comments.length, 1);
});

test('a later portal edit replaces only the portal draft and keeps its crew', async () => {
  const f = fakeApi(null);
  await S.syncTimeline({ agreementTaskId: 'agr1', timeline: TIMELINE, api: f.api, now: NOW, events: EVENTS });
  const edited = { moments: [{ time: '4:30 PM', event: 'Guest arrival' }, { time: '5:00 PM', event: 'Ceremony' }] };
  const r = await S.syncTimeline({ agreementTaskId: 'agr1', timeline: edited, api: f.api, now: NOW, events: EVENTS });
  assert.strictEqual(r.synced, true);
  assert.strictEqual(f.plan.version, 2);
  assert.strictEqual(f.plan.history.length, 2);
  assert.deepStrictEqual(f.plan.vendors.map((v) => v.id), ['amg']);
});

test('agreements without a Cue Sheet event are ignored', async () => {
  const f = fakeApi(null);
  const r = await S.syncTimeline({ agreementTaskId: 'other', timeline: TIMELINE, api: f.api, now: NOW, events: EVENTS });
  assert.strictEqual(r.reason, 'no-cue-event');
  assert.strictEqual(f.calls.length, 0);
});

test('times: am/pm and 24h parse; bare hours and junk do not', () => {
  assert.strictEqual(S.parseTime('5:00 PM'), 1020);
  assert.strictEqual(S.parseTime('12:00 am'), 0);
  assert.strictEqual(S.parseTime('17:30'), 1050);
  assert.strictEqual(S.parseTime('7'), null);
  assert.strictEqual(S.parseTime('TBD'), null);
});
