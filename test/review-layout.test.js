/* The phone layout's two moving parts.

   On a narrow screen the verdict has no column of its own — it floats over
   the board and stands down after five seconds — so a rule that holds it open
   or drops it early is the difference between a usable review loop and the
   three arrangements that came before it. The decision lives in
   flashVerdict(), which is small and pure enough to pin exactly: it shows
   once per ply, and a re-render for any other reason (grading filling in
   behind the reader, the danger ring toggling) must not restart the clock.

   The rest is structural. The grid names five areas and sizes the board from
   the same --sheet-w the sheet's own column reads, so renaming one half and
   not the other would collapse the layout silently — a browser would show it,
   a unit test would not, and there is no browser here. So the halves are
   checked against each other.

   Extracted from the built page the same way board.test.js does it. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(DIST)) {
  console.log('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
const html = fs.readFileSync(DIST, 'utf8');

let passed = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};

/* ---------- flashVerdict ---------- */

const flashSrc = (html.match(/\n  let flashedPly[\s\S]*?\n  function flashVerdict\(force\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(flashSrc, 'flashVerdict not found in the built page');

// A slot that only records whether the class is on, and a clock that never
// actually waits: the point is which calls arm it, not how long five seconds is.
function harness(matches) {
  const slot = {
    on: false,
    classList: { add(c) { if (c === 'flash') slot.on = true; },
                 remove(c) { if (c === 'flash') slot.on = false; } }
  };
  let pending = null, nextId = 1, cleared = [];
  const sandbox = {
    state: { ply: 0 },
    $: () => slot,
    window: { matchMedia: () => ({ matches }) },
    setTimeout: (fn, ms) => { pending = { fn, ms, id: nextId }; return nextId++; },
    clearTimeout: id => { if (id != null) cleared.push(id); }
  };
  vm.createContext(sandbox);
  vm.runInContext(flashSrc + '\nthis.flashVerdict = flashVerdict;', sandbox);
  return {
    slot, sandbox, cleared,
    flash: force => sandbox.flashVerdict(force),
    fire: () => { if (pending) pending.fn(); },
    delay: () => pending && pending.ms,
    armed: () => pending && pending.id
  };
}

console.log('the floating verdict:');

ok('a wide screen never flashes — the verdict is already in its column', () => {
  const h = harness(false);
  h.flash(false);
  assert.strictEqual(h.slot.on, false);
  assert.strictEqual(h.armed(), null, 'no timer should be armed on desktop');
});

ok('stepping onto a ply raises the window', () => {
  const h = harness(true);
  h.flash(false);
  assert.strictEqual(h.slot.on, true);
});

ok('it stands down after five seconds', () => {
  const h = harness(true);
  h.flash(false);
  assert.strictEqual(h.delay(), 5000, 'the window should hold for five seconds');
  h.fire();
  assert.strictEqual(h.slot.on, false);
});

ok('re-rendering the same ply does not re-raise it or restart the clock', () => {
  const h = harness(true);
  h.flash(false);
  const armed = h.armed();
  h.fire();                       // it has stood down
  assert.strictEqual(h.slot.on, false);
  h.flash(false);                 // a grading repaint of the same ply
  assert.strictEqual(h.slot.on, false, 'a repaint must not bring the window back');
  assert.strictEqual(h.armed(), armed, 'and must not arm a second timer');
});

ok('a released verdict re-raises the window on the ply already showing', () => {
  const h = harness(true);
  h.flash(false);
  h.fire();
  h.flash(true);                  // answering the prompt releases the verdict
  assert.strictEqual(h.slot.on, true);
});

ok('moving to another ply raises it again', () => {
  const h = harness(true);
  h.flash(false);
  h.fire();
  h.sandbox.state.ply = 1;
  h.flash(false);
  assert.strictEqual(h.slot.on, true);
});

/* ---------- the narrow grid ---------- */

const narrowCss = (html.match(/@media \(max-width: 900px\) \{[\s\S]*?\n\}/) || [])[0];
assert.ok(narrowCss, 'the narrow layout block not found in the built page');

console.log('\nthe narrow grid:');

ok('every area the template names is claimed by an element', () => {
  const tmpl = narrowCss.match(/grid-template-areas:([^;]+);/)[1];
  const named = new Set(tmpl.match(/[a-z]+/g));
  // A claim may be inherited from the desk's own rules — .col-sheet keeps its
  // grid-area across both layouts — so the whole sheet is the search space.
  const claimed = new Set([...html.matchAll(/grid-area:\s*([a-z]+)/g)].map(m => m[1]));
  for (const area of named) {
    assert.ok(claimed.has(area), `area "${area}" is laid out but nothing is placed in it`);
  }
});

ok('the board and the sheet column size from the same --sheet-w', () => {
  assert.ok(/grid-template-columns:[^;]*var\(--sheet-w\)/.test(narrowCss),
            'the sheet column should read --sheet-w');
  assert.ok(/\.board-wrap\s*\{[^}]*var\(--sheet-w\)/.test(narrowCss),
            'the board should size from --sheet-w, or folding the sheet will not resize it');
});

ok('folding the sheet shuts --sheet-w to zero', () => {
  assert.ok(/\.sheet-shut\s*\{\s*--sheet-w:\s*0/.test(narrowCss),
            '.sheet-shut should zero --sheet-w');
});

ok('the single-file sheet drops the pair cells and shows the per-ply number', () => {
  assert.ok(/\.sheet-num,\s*\.sheet-gap\s*\{\s*display:\s*none/.test(narrowCss),
            'the shared number column and its spacers should leave the grid');
  assert.ok(/\.mv-no\s*\{\s*display:\s*inline/.test(narrowCss),
            'each ply should carry its own number instead');
});

/* ---------- the markup the above depends on ---------- */

console.log('\nthe controls:');

ok('the fold handle is in the page and points at the sheet', () => {
  const btn = (html.match(/<button class="sheet-toggle"[^>]*>/) || [])[0];
  assert.ok(btn, 'the sheet-toggle button is missing');
  assert.ok(/aria-controls="sheet-col"/.test(btn), 'it should name the element it folds');
  assert.ok(/id="sheet-col"/.test(html), 'and that element should exist');
});

ok('every ply button carries its move number', () => {
  assert.ok(/el\('span', 'mv-no'/.test(html),
            'renderSheet should append the mv-no span the single-file sheet reads');
});

console.log(`\n${passed} passed` + (process.exitCode ? ', some failed' : ', 0 failed'));
