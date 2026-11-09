'use strict';
// Booked events on the live Cue Sheet, one entry per booking, keyed by the client's portal slug.
// taskId is the Day-Of Cue Sheets task; agreementTaskId is the agreement whose portal answers feed
// the show: songs are read live, and the client's portal timeline becomes the draft run of show
// automatically (see _cue-sync.js). Moments start empty on purpose. The coordinator adds the crew
// list and publishes the approved plan in the console, which locks it from further portal changes.
const AMG = { id: 'amg', name: 'Ampersound Media Group', role: 'DJ + MC', contact: 'afia@ampersoundmediagroup.com', share: true, rev: 1 };
const COORDINATOR = { name: 'Afia', phone: '+15127994646', phoneLabel: '(512) 799-4646' };
const booking = (x) => ({ kind: 'wedding', tz: 'America/Denver', coordinator: { ...COORDINATOR }, lanes: ['Run of show'], vendors: [{ ...AMG }], moments: [], ...x });

const BOOKINGS = {
  'jesse-zariah': booking({
    name: 'Jesse & Zariah', date: '2027-04-28', dateLabel: 'Wed, Apr 28, 2027',
    venue: 'Grand Falls (formerly Millennial Falls)', taskId: '86bcwqrqh', agreementTaskId: '86bb71btb',
  }),
  'angela-joe': booking({
    name: 'Angela & Joe', date: '2027-05-28', dateLabel: 'Fri, May 28, 2027',
    venue: 'Red Butte Garden, SLC', taskId: '86bcwqrqm', agreementTaskId: '86bctjffd',
  }),
};

module.exports = { BOOKINGS, booking };
