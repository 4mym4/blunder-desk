/* Why the best move is best, and what it is trying to bring about.

   The verdict used to name the move and a number — "Best was Bg7, worth about
   2.3 pawns more" — which says a better move existed without saying what it
   does. Two pieces fill that in:

     bestLine   walks the search forward and returns the line it expects
     explainBest  replays that line and reports what changes materially

   Everything here stays inside what the engine can actually back: material
   and mate. No positional claims, because the evaluation makes none. */

const assert = require('assert');
const { Position } = require('../src/engine.js');
const { bestLine } = require('../src/tactics.js');
const { explainBest } = require('../src/analysis.js');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('  ok   ' + name); pass++; }
  catch (e) { console.log('  FAIL ' + name + '\n       ' + e.message); fail++; }
}

console.log('the line the search expects:');

check('a free queen is taken, and the line says so', () => {
  // Black queen on d5 is attacked by the e4 pawn and defended by nothing.
  const fen = 'rnb1kbnr/ppp1pppp/8/3q4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';
  const r = bestLine(new Position(fen), 3, 4);
  assert.ok(r.line.length >= 1, 'no line produced');
  assert.strictEqual(r.line[0], 'exd5', 'the first move should take the queen, got ' + r.line[0]);
});

check('a forced mate is found and flagged', () => {
  const fen = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';   // Ra8 is mate
  const r = bestLine(new Position(fen), 3, 4);
  assert.strictEqual(r.line[0], 'Ra8#', 'expected mate in one, got ' + r.line[0]);
  assert.strictEqual(r.mateIn, 1, 'mateIn should be 1, got ' + r.mateIn);
});

check('the line stops at the ply budget', () => {
  const r = bestLine(new Position(), 2, 3);
  assert.ok(r.line.length <= 3, 'line ran past its budget: ' + r.line.length);
  assert.ok(r.line.length > 0, 'no line from the opening position');
});

check('a finished position yields an empty line rather than throwing', () => {
  const mated = new Position('rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 1');
  const r = bestLine(mated, 2, 3);
  assert.deepStrictEqual(r.line, [], 'a mated side has no line to play');
});

check('the position is left exactly as it was found', () => {
  const fen = 'rnb1kbnr/ppp1pppp/8/3q4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';
  const pos = new Position(fen);
  bestLine(pos, 3, 4);
  assert.strictEqual(pos.fen(), fen, 'bestLine mutated the caller position');
});

console.log('\nwhat the line is worth:');

check('winning a queen reads as winning a queen', () => {
  const fen = 'rnb1kbnr/ppp1pppp/8/3q4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1';
  const e = explainBest(fen, ['exd5']);
  assert.ok(e.firstCapture, 'no capture reported');
  assert.strictEqual(e.firstCapture.piece, 'queen');
  assert.strictEqual(e.firstCapture.square, 'd5');
  assert.ok(e.netPawns >= 8, 'taking a queen should read as about nine pawns, got ' + e.netPawns);
  assert.ok(/queen/.test(e.why), 'the sentence should name the piece: ' + e.why);
});

check('mate is stated as mate, not as material', () => {
  const e = explainBest('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['Ra8#']);
  assert.strictEqual(e.mateIn, 1);
  assert.ok(/mate/i.test(e.why), 'the sentence should say mate: ' + e.why);
  assert.ok(!/pawn/.test(e.why), 'mate should not be described in pawns: ' + e.why);
});

check('a recapture that only restores the count says so', () => {
  // White has just taken on d5; Black recaptures and the count is level.
  const fen = 'rnbqkbnr/ppp1pppp/8/3P4/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const e = explainBest(fen, ['Qxd5']);
  assert.ok(e.firstCapture, 'the recapture should be reported');
  assert.ok(Math.abs(e.netPawns - 1) < 0.01, 'a pawn recapture nets one pawn, got ' + e.netPawns);
});

check('an empty line still returns a usable answer', () => {
  const e = explainBest('6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', []);
  assert.strictEqual(e.firstCapture, null);
  assert.strictEqual(e.mateIn, null);
  assert.ok(typeof e.why === 'string' && e.why.length > 0, 'why should always be a sentence');
});

check('a malformed line is ignored rather than throwing', () => {
  for (const line of [null, undefined, ['not-a-move'], ['e4', 'zzz']]) {
    const e = explainBest('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', line);
    assert.ok(typeof e.why === 'string', 'why missing for ' + JSON.stringify(line));
    assert.ok(Number.isFinite(e.netPawns), 'netPawns not finite for ' + JSON.stringify(line));
  }
});

check('the sentence never claims anything positional', () => {
  const fens = [
    ['rnb1kbnr/ppp1pppp/8/3q4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1', ['exd5']],
    ['6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', ['Ra8#']],
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', ['e4', 'e5']]
  ];
  // The evaluation is material plus mate. Anything implying structure,
  // initiative or king safety would be a claim it cannot back.
  const banned = /initiative|space|structure|develop|centre|center|safer|attack|pressure|weak/i;
  for (const [fen, line] of fens) {
    const why = explainBest(fen, line).why;
    assert.ok(!banned.test(why), 'positional claim in: ' + why);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
