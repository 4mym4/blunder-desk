/* The board must only touch squares that actually changed.

   paint() used to clear all 64 squares and rebuild all 32 piece elements on
   every call, including every arrow-key step. The piece that moved animated
   correctly; the other 31 were destroyed and recreated underneath it, which
   is the flicker. Nothing here is about speed — no frames were being
   dropped — it is about elements being replaced that had no reason to change.

   diffOccupancy is the decision that prevents it, so this pins it: a step
   reports the squares that moved and nothing else. Run against the real
   function out of the built page, the same way worker.test.js does. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { Position, SQUARES } = require('../src/engine.js');

const DIST = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(DIST)) {
  console.log('dist/index.html missing — run `npm run build` first');
  process.exit(1);
}
const html = fs.readFileSync(DIST, 'utf8');

const src = (html.match(/\n  function diffOccupancy\(prev, next\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(src, 'diffOccupancy not found in the built page');

const kindSrc = (html.match(/\n  function gradeKind\(pl\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(kindSrc, 'gradeKind not found in the built page');

const boxSrc = (html.match(/\n  function flierBox\(ar, br, wrap\) \{[\s\S]*?\n  \}\n/) || [])[0];
assert.ok(boxSrc, 'flierBox not found in the built page');

const animateSrc = (html.match(/\n  function animateTo\([\s\S]*?\n  \}\n/) || [])[0];
assert.ok(animateSrc, 'animateTo not found in the built page');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src + kindSrc + boxSrc + '\nthis.diffOccupancy = diffOccupancy; this.gradeKind = gradeKind; this.flierBox = flierBox;', sandbox);
// vm returns an Array built in the sandbox realm, whose prototype is not this
// realm's Array.prototype — deepStrictEqual compares prototypes and would
// reject an otherwise identical list. Re-home it, and sort for stability.
const diffOccupancy = (prev, next) => [...sandbox.diffOccupancy(prev, next)].sort();

/* The map paint() keeps: every square name to what is drawn on it. */
function occupancy(fen) {
  const pos = new Position(fen), m = {};
  for (const name of Object.keys(SQUARES)) {
    const p = pos.get(name);
    m[name] = p ? p.color + p.type : '';
  }
  return m;
}

/* Play SAN moves from the start and return the fen after each. */
function fens(sans) {
  const pos = new Position();
  const out = [pos.fen()];
  for (const san of sans) {
    assert.ok(pos.moveSan(san), `illegal or unparsed move in fixture: ${san}`);
    out.push(pos.fen());
  }
  return out;
}

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

console.log('board occupancy diff:');

check('an unchanged position rebuilds nothing', () => {
  const m = occupancy(new Position().fen());
  assert.deepStrictEqual(diffOccupancy(m, m), []);
  // and a separately built map of the same position is still nothing
  assert.deepStrictEqual(diffOccupancy(occupancy(new Position().fen()), m), []);
});

check('a quiet pawn move touches exactly its two squares', () => {
  const [a, b] = fens(['e4']);
  assert.deepStrictEqual(diffOccupancy(occupancy(a), occupancy(b)).sort(), ['e2', 'e4']);
});

check('a knight move touches exactly its two squares', () => {
  const [, , b] = fens(['e4', 'Nf6']);
  const a = fens(['e4'])[1];
  assert.deepStrictEqual(diffOccupancy(occupancy(a), occupancy(b)).sort(), ['f6', 'g8']);
});

check('a capture touches exactly its two squares', () => {
  const f = fens(['e4', 'd5', 'exd5']);
  assert.deepStrictEqual(diffOccupancy(occupancy(f[2]), occupancy(f[3])).sort(), ['d5', 'e4']);
});

check('castling touches four squares — king and rook', () => {
  const f = fens(['e4', 'e5', 'Nf3', 'Nc6', 'Bc4', 'Bc5', 'O-O']);
  assert.deepStrictEqual(diffOccupancy(occupancy(f[6]), occupancy(f[7])).sort(), ['e1', 'f1', 'g1', 'h1']);
});

check('en passant clears the captured pawn as well', () => {
  const f = fens(['e4', 'a6', 'e5', 'd5', 'exd6']);
  assert.deepStrictEqual(diffOccupancy(occupancy(f[4]), occupancy(f[5])).sort(), ['d5', 'd6', 'e5']);
});

check('promotion replaces the piece on the landing square', () => {
  const pos = new Position('8/P6k/8/8/8/8/7K/8 w - - 0 1');
  const before = occupancy(pos.fen());
  assert.ok(pos.moveSan('a8=Q'), 'a8=Q not generated');
  assert.deepStrictEqual(diffOccupancy(before, occupancy(pos.fen())).sort(), ['a7', 'a8']);
});

check('no step in a real game rebuilds more than four squares', () => {
  // The regression that matters: before the fix every step changed all 64.
  const sans = ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Bxc6', 'dxc6', 'O-O', 'Bg4'];
  const f = fens(sans);
  let worst = 0, worstAt = null;
  for (let i = 1; i < f.length; i++) {
    const n = diffOccupancy(occupancy(f[i - 1]), occupancy(f[i])).length;
    if (n > worst) { worst = n; worstAt = sans[i - 1]; }
  }
  assert.ok(worst <= 4, `a single ply reported ${worst} changed squares (at ${worstAt}); castling is the max at 4`);
});

/* The grade mark carries severity as shape as well as hue, because the three
   status hues collapse under deuteranopia (critical and good separate at
   1.6:1). Each grade must therefore land on the mark its severity deserves —
   a blunder drawn as the "good" dot would be wrong in both channels at once. */
const { gradeKind } = sandbox;
const ply = o => Object.assign({ isHero: true, tags: [], severity: null, grade: null }, o);

console.log('\ngrade marks:');

check('every named grade maps to its own mark', () => {
  assert.strictEqual(gradeKind(ply({ grade: 'blunder' })), 'blunder');
  assert.strictEqual(gradeKind(ply({ grade: 'mistake' })), 'mistake');
  assert.strictEqual(gradeKind(ply({ grade: 'inaccuracy' })), 'inaccuracy');
  assert.strictEqual(gradeKind(ply({ grade: 'missed' })), 'inaccuracy');
  assert.strictEqual(gradeKind(ply({ grade: 'best' })), 'good');
  assert.strictEqual(gradeKind(ply({ grade: 'strong' })), 'good');
});

check('quiet grades carry no mark', () => {
  for (const g of ['book', 'solid']) assert.strictEqual(gradeKind(ply({ grade: g })), '');
});

check('an ungraded hero ply falls back to its severity', () => {
  assert.strictEqual(gradeKind(ply({ severity: 'blunder' })), 'blunder');
  assert.strictEqual(gradeKind(ply({ severity: 'mistake' })), 'mistake');
  assert.strictEqual(gradeKind(ply({ severity: 'inaccuracy' })), 'inaccuracy');
  // 'minor' is a severity with no mark — it must not reach the DOM as a class
  assert.strictEqual(gradeKind(ply({ severity: 'minor' })), '');
});

check('a punished hang or won material reads as good', () => {
  assert.strictEqual(gradeKind(ply({ tags: ['punished'] })), 'good');
  assert.strictEqual(gradeKind(ply({ tags: ['good_capture'] })), 'good');
});

check("the opponent's moves are never marked", () => {
  assert.strictEqual(gradeKind(ply({ isHero: false, severity: 'blunder' })), '');
  assert.strictEqual(gradeKind(ply({ isHero: false, tags: ['punished'] })), '');
});

check('every mark a ply can produce has a glyph in the page', () => {
  const kinds = new Set();
  for (const g of ['blunder','mistake','inaccuracy','missed','best','strong','book','solid'])
    kinds.add(gradeKind(ply({ grade: g })));
  for (const sev of ['blunder','mistake','inaccuracy','minor']) kinds.add(gradeKind(ply({ severity: sev })));
  kinds.delete('');
  for (const k of kinds) assert.ok(html.includes(`id="gm-${k}"`), `no glyph drawn for mark "${k}"`);
});

/* The flying piece must start on the square it left. It did not: .pc sets
   `inset: 5.5%`, and animateTo cleared that with the `inset` shorthand on the
   line AFTER setting left and top — so the shorthand reset both to auto, the
   flier fell back to its static position in the grid (the board's top-left
   corner) and slid off from there by the move's delta. */
const { flierBox } = sandbox;
const S = 48;                                   // a 48px square, 384px board
const wrap = { left: 100, top: 200 };           // board offset on the page
const at = (file, rank) => ({ left: wrap.left + file * S, top: wrap.top + (7 - rank) * S, width: S });

console.log('\nflier geometry:');

check('the flier starts inside the square it leaves', () => {
  const b = flierBox(at(4, 1), at(4, 3), wrap);   // e2 -> e4
  assert.strictEqual(b.left, 4 * S + S * 0.07, 'left is not the origin file');
  assert.strictEqual(b.top, 6 * S + S * 0.07, 'top is not the origin rank');
  // and it sits within the origin square, not merely near it
  assert.ok(b.left >= 4 * S && b.left + b.size <= 5 * S, 'overflows the origin square horizontally');
  assert.ok(b.top >= 6 * S && b.top + b.size <= 7 * S, 'overflows the origin square vertically');
});

check('the travel is exactly the square delta', () => {
  const fwd = flierBox(at(4, 1), at(4, 3), wrap);
  assert.deepStrictEqual([fwd.dx, fwd.dy], [0, -2 * S], 'e2-e4 should travel two ranks up');
  const knight = flierBox(at(6, 0), at(5, 2), wrap);
  assert.deepStrictEqual([knight.dx, knight.dy], [-1 * S, -2 * S], 'g1-f3 should travel one file left, two ranks up');
  const back = flierBox(at(4, 3), at(4, 1), wrap);
  assert.deepStrictEqual([back.dx, back.dy], [0, 2 * S], 'the reverse move should travel the other way');
});

check('landing on the destination square', () => {
  const b = flierBox(at(2, 0), at(5, 3), wrap);   // c1 -> f4
  const endLeft = b.left + b.dx, endTop = b.top + b.dy;
  assert.ok(endLeft >= 5 * S && endLeft + b.size <= 6 * S, 'does not land on the destination file');
  assert.ok(endTop >= 4 * S && endTop + b.size <= 5 * S, 'does not land on the destination rank');
});

check('the board offset never leaks into the position', () => {
  // Same move, board moved elsewhere on the page: identical board coordinates.
  const w2 = { left: 999, top: -40 };
  const a = flierBox(at(4, 1), at(4, 3), wrap);
  const shifted = (f, r) => ({ left: w2.left + f * S, top: w2.top + (7 - r) * S, width: S });
  const b = flierBox(shifted(4, 1), shifted(4, 3), w2);
  assert.deepStrictEqual([a.left, a.top, a.dx, a.dy], [b.left, b.top, b.dx, b.dy]);
});

check('animateTo never writes the inset shorthand', () => {
  // The shorthand is the hazard: written after left/top it silently clears
  // them. Longhands only, so the ordering cannot regress into the bug again.
  assert.ok(!/\.style\.inset\s*=/.test(animateSrc),
    'animateTo sets style.inset — use the right/bottom longhands instead');
  assert.ok(/\.style\.right\s*=\s*'auto'/.test(animateSrc), 'right is not cleared');
  assert.ok(/\.style\.bottom\s*=\s*'auto'/.test(animateSrc), 'bottom is not cleared');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
