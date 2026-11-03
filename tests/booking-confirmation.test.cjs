const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'booking-confirmed', 'index.html'), 'utf8');

test('generic booking return fails closed instead of claiming payment or signing success', () => {
  assert.match(html, /<title>Check Your Booking Status/);
  assert.match(html, /<h1>Check your booking status<\/h1>/);
  assert.match(html, /This page cannot verify whether your agreement is signed or your payment has been received\./);
  assert.doesNotMatch(html, /You're Booked!|Payment Confirmed|Agreement Signed|Deposit Received|Payment received\. Your event date is officially secured\./i);
  assert.doesNotMatch(html, /payment-badge|timeline-dot done|confirm-icon/);
});

test('URL claims cannot populate booking data or unlock a success state', () => {
  // No client executable code: ?paid=true, ?signed=true, ?session_id=... and
  // legacy display parameters all produce the same neutral static response.
  assert.doesNotMatch(html, /<script\b|on(?:load|error|click)\s*=/i);
  assert.doesNotMatch(html, /URLSearchParams|decodeURIComponent|window\.location|eventPaid|eventBalance/);
  assert.match(html, /name="referrer" content="no-referrer"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test('return page directs clients safely to portal and avoids duplicate-payment pressure', () => {
  assert.match(html, /href="\/client-portal\/"/);
  assert.match(html, /href="\/"/);
  assert.match(html, /href="mailto:contact@ampersoundmediagroup\.com"/);
  assert.match(html, /contact us before making another payment/);
  assert.match(html, /required booking payment is verified under your agreement's terms/);
  assert.doesNotMatch(html, /72 hours|48 hours|buy\.stripe\.com|fetch\(/i);
});
