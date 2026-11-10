'use strict';
// Pitch Room: a prospect enters the email we sent their pitch to and is routed to their deck.
// It mirrors the client portal email lookup. This is routing, not security: pitch pages hold no
// pricing, contracts, payment links, or client data. The repo is public, so prospect emails are
// stored only as SHA-256 hashes, and submitted emails are never logged or saved.
// Add a prospect: hash their lowercase email (node -e "console.log(require('crypto').createHash('sha256').update('name@org.com').digest('hex'))")
// and add it to that pitch's `emails`. Remove the hash to turn their access off.
const crypto = require('crypto');

const PITCHES = {
  'kilby-block-party': {
    title: 'Kilby Block Party 2027',
    org: 'S&S Presents',
    url: '/pitch-room/kilby-block-party/',
    emails: [
      '499dff718aeda7de70930c623a6bc3f37386dc3f9cdbef82cbc50de8b55e2bd6', // S&S Presents contact
      '990d133c1377bd3ca8d82607c387a5541f79d02f17b5e3744f200c4c0782bf0e', // Afia, for previews
    ],
  },
};

const H = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
const reply = (status, body) => ({ statusCode: status, headers: H, body: JSON.stringify(body) });
const hash = (email) => crypto.createHash('sha256').update(email).digest('hex');
const NOT_FOUND = "Hmm, we don't have a pitch under that email yet. Try the address we reached you at, or say hi to Afia at afia@ampersoundmediagroup.com.";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function find(email) {
  const h = hash(email);
  return Object.values(PITCHES).filter((p) => p.emails.includes(h)).map(({ title, org, url }) => ({ title, org, url }));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return reply(405, { message: 'Method not allowed' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (_) { return reply(400, { message: 'Invalid request' }); }
  const email = String((body && body.email) || '').trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return reply(400, { message: 'That email doesn\u2019t look quite right. Give it another try.' });
  const pitches = find(email);
  if (!pitches.length) return reply(404, { message: NOT_FOUND });
  return reply(200, { pitches });
};
exports._test = { find, hash, PITCHES, NOT_FOUND };
