const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'testimonials.html'), 'utf8');
const group = html.match(/<fieldset[^>]*class="form-group rating-group"[^>]*>([\s\S]*?)<\/fieldset>/);

test('ratings have a named native group and five ascending, individually named radio options', () => {
  assert.ok(group);
  assert.match(html, /aria-describedby="ratingHelp"/);
  assert.match(group[1], /<legend>Rating<\/legend>/);
  const radios = [...group[1].matchAll(/<input type="radio" id="s(\d)" name="rating" value="(\d)" aria-label="([^"]+)"/g)];
  assert.deepEqual(radios.map(x => x[1]), ['1','2','3','4','5']);
  for (const r of radios) {
    assert.equal(r[1], r[2]);
    assert.equal(r[3], `${r[1]} ${r[1] === '1' ? 'star' : 'stars'}`);
    assert.ok(group[1].includes(`label for="s${r[1]}"`));
  }
  assert.doesNotMatch(group[1], /checked|required|tabindex="-1"|disabled/);
});

test('native radios remain focusable with visible focus on the corresponding star', () => {
  const css = html.match(/\.star-rating input\[type='radio'\]\{([^}]+)\}/)[1];
  assert.doesNotMatch(css, /display\s*:\s*none|visibility\s*:\s*hidden/);
  assert.match(css, /position:absolute/);
  assert.match(html, /\.star-rating input:focus-visible\+label\{outline:3px solid/);
  assert.match(html, /min-width:44px;min-height:44px/);
  assert.match(html, /Keyboard: use arrow keys/);
});

test('selected and hover star fills preserve ascending native value and existing form submission', () => {
  assert.match(html, /\.star-rating input:checked\+label/);
  assert.match(html, /\.star-rating label:has\(~ input:checked\)/);
  assert.match(html, /new FormData\(this\)/);
  assert.match(html, /fetch\('\/\.netlify\/functions\/testimonial-submit'/);
  assert.doesNotMatch(html, /\.star-rating\{[^}]*row-reverse/);
});
