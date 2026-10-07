/* Opening names.

   A wrong name teaches a wrong thing, so the table is checked rather than
   trusted: every key must be a legal sequence of moves from the start. A typo
   in a SAN token would otherwise sit there naming a line that cannot be
   reached, and nothing else in the app would ever notice.

   The lookup itself has one rule worth pinning — longest match wins — because
   that is what lets a variation name itself without the parent shadowing it. */

const assert = require('assert');
const { Position } = require('../src/engine.js');
const { openingOf, OPENINGS } = require('../src/commentary.js');

let passed = 0;
const ok = (name, fn) => {
  try { fn(); console.log('  ok   ' + name); passed++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('the opening table:');

ok('every line in the table is actually playable', () => {
  for (const key of Object.keys(OPENINGS)) {
    const pos = new Position();
    key.split(' ').forEach((san, i) => {
      assert.ok(pos.moveSan(san),
        `"${key}" is not a legal game — ${san} (move ${i + 1}) cannot be played`);
    });
  }
});

ok('no two keys name the same position differently', () => {
  const byFen = new Map();
  for (const key of Object.keys(OPENINGS)) {
    const pos = new Position();
    for (const san of key.split(' ')) pos.moveSan(san);
    const fen = pos.fen().split(' ').slice(0, 4).join(' ');
    const seen = byFen.get(fen);
    assert.ok(!seen || OPENINGS[seen] === OPENINGS[key],
      `"${key}" and "${seen}" reach the same position but are named ` +
      `"${OPENINGS[key]}" and "${OPENINGS[seen]}"`);
    byFen.set(fen, key);
  }
});

console.log('\nthe lookup:');

ok('names the opening that was actually played', () => {
  // the reported game — 1.e4 b6 is Owen's Defence, not the Sicilian
  assert.strictEqual(openingOf(['e4', 'b6', 'd4', 'Bb7', 'Nc3', 'Na6', 'Qh5']),
                     "Owen's Defence");
  assert.strictEqual(openingOf(['e4', 'c5']), 'Sicilian Defence');
});

ok('the longest match wins, so a variation outranks its parent', () => {
  assert.strictEqual(openingOf(['e4', 'e5', 'Nf3', 'Nc6']), 'Open Game');
  assert.strictEqual(openingOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5']), 'Ruy López');
  assert.strictEqual(openingOf(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']),
                     'Ruy López, Morphy Defence');
});

ok('an unknown line is left unnamed rather than guessed at', () => {
  assert.strictEqual(openingOf(['h4', 'a5']), null);
  assert.strictEqual(openingOf([]), null);
});

ok('a game that stops mid-name still gets the name it reached', () => {
  // two plies into the Ruy is still the Open Game, not the Ruy
  assert.strictEqual(openingOf(['e4', 'e5', 'Nf3']), 'Open Game');
});

console.log(`\n${passed} passed` + (process.exitCode ? ', some failed' : ', 0 failed'));
