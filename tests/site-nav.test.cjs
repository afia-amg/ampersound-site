const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Every public (non-portal) page must offer the same top navigation as the homepage.
// "Reviews" points at testimonials.html; "Client Login" is the portals dropdown.
const LABELS = ['Home', 'About Us', 'Highlights', 'Speaking', 'Reviews', 'Tell Us About Your Event', 'Client Login', 'Book a Call'];
const HREFS = ['/speaking.html', '/testimonials.html', '/intake.html', '/book.html', '/client-portal/', '/partner-portal/', '/cue/'];

for (const file of ['index.html', 'speaking.html', 'testimonials.html', 'book.html', 'intake.html']) {
  test(`${file}: main navigation lists every public page`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const nav = html.match(/<nav class="nav"[\s\S]*?<\/nav>/);
    assert.ok(nav, `${file} needs a main nav`);
    const labels = [...nav[0].matchAll(/>([^<>]+?)\s*</g)].map(m => m[1].trim()).filter(Boolean);
    for (const label of LABELS) assert.ok(labels.includes(label), `${file} nav is missing ${label}`);
    assert.ok(!labels.includes('Testimonials'), `${file} nav should say Reviews`);
    assert.ok(!labels.includes('Portals'), `${file} nav should say Client Login`);
    for (const href of HREFS) assert.ok(nav[0].includes(`href="${href}"`), `${file} nav is missing ${href}`);
    const about = file === 'index.html' ? '#about' : '/#about';
    const highlights = file === 'index.html' ? '#highlights' : '/#highlights';
    assert.ok(nav[0].includes(`href="${about}"`), `${file} About Us must reach the homepage section`);
    assert.ok(nav[0].includes(`href="${highlights}"`), `${file} Highlights must reach the homepage section`);
  });
}

test('homepage skips the splash and scrolls to the section when opened from another page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /if\(location\.hash\)enterSite\(\);/);
  assert.match(html, /scrollIntoView\(\)/);
});

test('homepage splash opens on its own so visitors never get stuck behind it', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /setTimeout\(enterSite,\d+\)/);
});

test('booking page shows the scheduler button above the explainer cards', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'book.html'), 'utf8');
  const first = html.indexOf('scheduler.zoom.us');
  assert.ok(first > -1 && first < html.indexOf('booking-steps"'), 'first booking button must come before the steps');
});
