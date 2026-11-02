const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// CSS contract checks complement the slow-pointer browser regression test.
for (const [file, breakpoint] of [['index.html', 1000], ['speaking.html', 800], ['testimonials.html', 800], ['book.html', 800]]) {
  test(`${file}: desktop hover bridge covers the submenu gap without changing mobile taps`, () => {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const gap = Number(html.match(/\.nav-dropdown-menu\{[^}]*top:calc\(100% \+ (\d+)px\)/)[1]);
    const bridge = html.match(/@media\(min-width:(\d+)px\)\{\.nav-dropdown-menu::before\{([^}]+)\}\}/);
    assert.ok(bridge, 'submenu needs a desktop-only hit area across the gap');
    assert.equal(Number(bridge[1]), breakpoint + 1, 'bridge must not apply in mobile layout');
    const declarations = Object.fromEntries(bridge[2].split(';').filter(Boolean).map(x => x.split(':')));
    assert.equal(declarations.content, "''");
    assert.equal(declarations.position, 'absolute');
    assert.equal(declarations.left, '0');
    assert.equal(declarations.right, '0');
    const top = parseFloat(declarations.top), height = parseFloat(declarations.height);
    assert.ok(top <= -(gap + 1), 'bridge must cover gap plus menu border');
    assert.ok(top + height >= 0, 'bridge must reach submenu');
    assert.match(html, /\.nav-dropdown:hover \.nav-dropdown-menu\{opacity:1;pointer-events:auto;/);
    assert.match(html, /\.nav-dropdown\.mobile-open \.nav-dropdown-menu\{display:block\}/);
    assert.match(html, /classList\.toggle\('mobile-open'\)/);
    for (const href of ['/client-portal/', '/partner-portal/', '/cue/']) assert.ok(html.includes(`href="${href}"`));
  });
}
