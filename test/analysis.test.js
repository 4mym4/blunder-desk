const { parsePgn, Position } = require('../src/engine.js');
const { analyzeGame, verifyIntention, pickIntentionPrompts, PIECE_NAME } = require('../src/analysis.js');

// A plausible beginner game: early queen, a hung knight, a missed free
// bishop, a counting error on a defended pawn, and a back-rank finish.
const SAMPLE = `[Event "Rated blitz game"]
[Site "lichess.org"]
[Date "2026.09.28"]
[White "you"]
[Black "opponent"]
[Result "0-1"]
[WhiteElo "243"]
[BlackElo "251"]
[TimeControl "600+0"]

1. e4 { [%clk 0:10:00] } e5 { [%clk 0:10:00] } 2. Bc4 { [%clk 0:09:52] } Nc6 { [%clk 0:09:48] }
3. Qh5 { [%clk 0:09:40] } g6 { [%clk 0:09:30] } 4. Qf3 { [%clk 0:09:31] } Nf6 { [%clk 0:09:20] }
5. Nc3 { [%clk 0:09:20] } Bg7 { [%clk 0:09:10] } 6. d3 { [%clk 0:09:10] } O-O { [%clk 0:09:00] }
7. Bg5 { [%clk 0:09:02] } h6 { [%clk 0:08:50] } 8. Bxf6 { [%clk 0:08:40] } Bxf6 { [%clk 0:08:42] }
9. Nd5 { [%clk 0:08:20] } Nd4 { [%clk 0:08:30] } 10. Qd1 { [%clk 0:08:18] } Nxc2+ { [%clk 0:08:20] }
11. Kd2 { [%clk 0:08:10] } Nxa1 { [%clk 0:08:12] } 12. Nxf6+ { [%clk 0:07:50] } Qxf6 { [%clk 0:08:00] }
13. Qg4 { [%clk 0:07:40] } d6 { [%clk 0:07:50] } 14. f3 { [%clk 0:07:30] } Be6 { [%clk 0:07:40] }
15. Bxe6 { [%clk 0:07:20] } Qxf3 { [%clk 0:07:30] } 16. Bxf7+ { [%clk 0:07:10] } Rxf7 { [%clk 0:07:20] }
17. Qxf3 { [%clk 0:07:00] } Rxf3 { [%clk 0:07:10] } 18. gxf3 { [%clk 0:06:50] } Rf8 { [%clk 0:07:00] }
19. Ne2 { [%clk 0:06:40] } Rxf3 { [%clk 0:06:50] } 20. Nf4 { [%clk 0:06:38] } exf4 { [%clk 0:06:45] } 0-1`;

const games = parsePgn(SAMPLE);
console.log('games parsed:', games.length);
console.log('moves parsed:', games[0].moves.length);
console.log('headers:', JSON.stringify(games[0].headers));
console.log('first few clocks:', games[0].moves.slice(0, 4).map(m => m.san + ' @' + m.clock).join(', '));

const result = analyzeGame(games[0], 'w');
if (result.error) { console.log('ERROR:', result.error); process.exit(1); }

console.log('\n=== flagged hero moves ===');
for (const p of result.plies) {
  if (!p.isHero || !p.tags.length) continue;
  console.log(
    `${p.moveNumber}. ${p.san.padEnd(8)} [${p.tags.join(',')}] loss=${p.loss} sev=${p.severity || '-'}`
  );
  if (p.headline) console.log(`     ${p.headline}`);
}

console.log('\n=== stats ===');
console.log(JSON.stringify(result.stats, null, 2));

console.log('\n=== intention prompts chosen ===');
const prompts = pickIntentionPrompts(result.plies, 5);
for (const p of prompts) console.log(`  move ${p.moveNumber} ${p.san}  (loss ${p.loss}, tags: ${p.tags.join(',') || 'none'})`);

console.log('\n=== intention verification scenarios ===');
function show(plyIdx, intention) {
  const ply = result.plies.find(p => p.ply === plyIdx);
  const v = verifyIntention(ply, intention);
  console.log(`  ${ply.moveNumber}. ${ply.san} + "${intention.kind}${intention.target ? ' ' + intention.target : ''}"`);
  console.log(`     -> [${v.verdict}] ${v.label}: ${v.detail}`);
}

// 3. Qh5 — claim: attacking f7 (it is defended / nothing wins)
const qh5 = result.plies.find(p => p.san === 'Qh5');
if (qh5) show(qh5.ply, { kind: 'attack', target: 'f7' });

// 10. Qd1 — claim: protecting c2 (did it hold?)
const qd1 = result.plies.find(p => p.san === 'Qd1');
if (qd1) show(qd1.ply, { kind: 'protect', target: 'c2' });

// 19. Nf4 — hung knight
const nf4 = result.plies.find(p => p.san === 'Nf4');
if (nf4) {
  show(nf4.ply, { kind: 'attack', target: 'g6' });
  show(nf4.ply, { kind: 'free' });
}

// a phantom-threat case: protecting something nobody attacks
const e4ply = result.plies.find(p => p.san === 'd3');
if (e4ply) show(e4ply.ply, { kind: 'protect', target: 'e4' });

console.log('\n=== danger overlay sample (loose hero pieces per move) ===');
for (const p of result.plies.filter(x => x.isHero && x.looseAfter.length).slice(0, 6)) {
  console.log(`  after ${p.moveNumber}. ${p.san}: ` +
    p.looseAfter.map(l => `${l.type}${l.square}(-${l.gain})`).join(' '));
}

console.log('\n=== protect-branch scenarios (previously masked by a bug) ===');
// White knight on e5 is attacked by a pawn on d6 and undefended.
// Three replies: move it to safety, defend it, or ignore it.
const { parsePgn: pp } = require('../src/engine.js');
function scenario(pgn, heroColor, idx, intention, note) {
  const g = pp(pgn)[0];
  const r = analyzeGame(g, heroColor);
  if (r.error) { console.log('  setup error:', r.error); return; }
  const ply = r.plies[idx];
  const v = verifyIntention(ply, intention);
  console.log(`  ${note}`);
  console.log(`    ${ply.san} + "${intention.kind} ${intention.target || ''}" -> [${v.verdict}] ${v.label}`);
  console.log(`    ${v.detail}`);
}

// 1. genuinely hanging knight, player moves it away -> sound
scenario(`[Event "s"]\n\n1. e4 d6 2. Nf3 e5 3. Nxe5 dxe5 4. d3 *`, 'w', 4,
  { kind: 'protect', target: 'e5' }, 'knight taken before it could be saved:');

// 2. phantom threat: defending a piece nobody attacks
scenario(`[Event "s"]\n\n1. e4 e5 2. Nf3 Nc6 3. d3 d6 *`, 'w', 4,
  { kind: 'protect', target: 'e4' }, 'defending e4 against nothing:');

// 3. attack claim on a defended piece -> counting error
scenario(`[Event "s"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Nxe5 *`, 'w', 6,
  { kind: 'attack', target: 'e5' }, 'capture on a defended pawn:');

/* ------------------------------------------------------------
   An "attack" claim describes a threat still to be carried out.
   Mate, a check and a completed capture have each already
   resolved, so the verdict must not talk about pressure on a
   square whose question is settled.
   ------------------------------------------------------------ */
const assert = require('assert');

function verdictOf(pgn, heroColor, idx, intention) {
  const r = analyzeGame(pp(pgn)[0], heroColor);
  assert.ok(!r.error, r.error);
  return verifyIntention(r.plies[idx], intention);
}

const cases = [
  // The target is gone because we took it — never "under pressure".
  [`1. e4 d5 2. exd5 *`, 'w', 2, 'd5', 'traded',
   'captured the target: graded as a trade, not a live threat'],
  // The king can never be captured, so SEE on it is meaningless.
  // Naming it means "I was giving check", and that is what is checked.
  [`1. e4 e5 2. Nf3 Nc6 3. Bb5 d6 4. Bxc6+ *`, 'w', 6, 'e8', 'check',
   'king named + move gives check: a check'],
  [`1. e4 e5 2. Bc4 Nc6 3. Qf3 d6 4. Qb3 *`, 'w', 6, 'e8', 'empty_threat',
   'king named + no check: not a check'],
  [`1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7+ *`, 'w', 6, 'f7', 'mate',
   'mate outranks every other verdict'],
];

let failures = 0;
for (const [moves, hero, idx, target, want, note] of cases) {
  const v = verdictOf(`[Event "s"]\n\n${moves}`, hero, idx, { kind: 'attack', target });
  const ok = v.verdict === want;
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${note}`);
  if (!ok) console.log(`       wanted [${want}], got [${v.verdict}] ${v.label}: ${v.detail}`);
  assert.ok(!/under pressure/.test(v.detail) || want === 'sound',
    `a resolved move must not be described as ongoing pressure: ${v.detail}`);
}

// A piece that captured on its own destination square is mid-trade, not
// hanging — otherwise every recapture reads as a hung piece.
const trade = verdictOf(`[Event "s"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 d6 4. Bxc6+ *`, 'w', 6,
  { kind: 'attack', target: 'e8' });
const midTrade = !/bishop on c6 is hanging/.test(trade.detail);
if (!midTrade) failures++;
console.log(`  ${midTrade ? 'ok  ' : 'FAIL'} recapturable piece mid-trade is not reported as hanging`);

/* ------------------------------------------------------------
   A move played in check answers the check. The shape descriptors
   are geometric and cannot see that on their own, so a forced
   block off the back rank used to be praised as development.
   ------------------------------------------------------------ */
const { gradeAll } = require('../src/analysis.js');

function lastPly(pgn, heroColor) {
  const r = analyzeGame(pp(`[Event "s"]\n\n${pgn}`)[0], heroColor);
  assert.ok(!r.error, r.error);
  gradeAll(r.plies, 2);
  return r.plies[r.plies.length - 1];
}

const evasions = [
  // 3... Bd7 blocks Bb5+. It leaves the back rank, but it is a reply,
  // not a developing move the player chose.
  [`1. e4 d5 2. Nc3 Nf6 3. Bb5+ Bd7 *`, 'w', 'block', /blocked the check/],
  // Taking the checker is the fact worth naming even when the king takes.
  [`1. e4 e5 2. Qh5 Nc6 3. Qxf7+ Kxf7 *`, 'w', 'capture', /taking the queen that gave it/],
  [`1. e4 e5 2. Nf3 f6 3. Nxe5 fxe5 4. Qh5+ Ke7 *`, 'w', 'king', /king out of check/],
];

for (const [pgn, hero, kind, wording] of evasions) {
  const p = lastPly(pgn, hero);
  const ok = p.checkEvasion === kind && wording.test(p.comment);
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} check evasion by ${kind}: ${p.san}`);
  if (!ok) console.log(`       got [${p.checkEvasion}] ${p.comment}`);
  // The geometric descriptors must never survive a forced move.
  assert.ok(!p.develops && !p.centerPawn && !p.earlyQueen,
    `a move played in check must not read as a plan: ${p.san} -> ${p.comment}`);
}

if (failures) { console.log(`\n${failures} commentary/verdict check(s) failed`); process.exit(1); }
console.log('\nall attack-verdict and check-evasion checks passed');

/* A defended piece must say what is defending it.

   Reported from a real game: 1.d4 Nc6 2.Nf3 e5 3.dxe5 d5 4.exd6 cxd6 5.Bf4,
   and the pawn on d6 read as "defended well enough" with no evidence. The
   player counted the queen on d8, worked out Bxd6 Qxd6 Qxd6, and concluded
   the desk was wrong. The desk was right and the sentence was useless: the
   bishop on f8 also covers d6 through the e7 square their own e-pawn left on
   move 2, and recapturing with it costs White a bishop for a pawn.

   So the verdict names its defenders now, because the usual way to misread
   this one is to find a single defender and stop looking. */
{
  const fenBefore = 'r1bqkbnr/pp3ppp/2np4/8/5B2/5N2/PPP1PPPP/RN1QKB1R b KQkq - 1 5';
  const p = new Position(fenBefore);
  p.moveSan('d5');
  const ply = { color: 'b', fenBefore, fenAfter: p.fen(), from: 'd6', to: 'd5',
                captured: null, looseAfter: [], tags: [] };
  const v = verifyIntention(ply, { kind: 'protect', target: 'd6' });

  assert.strictEqual(v.verdict, 'over_protection', 'd6 was adequately defended');
  assert.ok(/d8/.test(v.detail) && /f8/.test(v.detail),
            'both defenders must be named, not just asserted: ' + v.detail);
  assert.ok(!/lost them material/.test(v.detail),
            'see() clamps at zero, so an equal trade must not be called a loss');
  console.log('  ok   a defended piece names the pieces defending it');
}

/* Tunnel vision has to mean the move caused it.

   Reported from a real game: the knight on c2 was attacked by Nd4, the player
   moved it to b4, and the desk called it tunnel vision because a pawn on e4
   was hanging afterwards. But e4 was already hanging before the move, and the
   knight on c2 never defended it — c2 covers a1, a3, b4, d4, e1 and e3, not
   e4. The move could not have caused that weakness, and the move verdict
   agreed: it tagged the ply "still loose", not "became loose".

   So the intention check now subtracts what was already loose. Both halves
   are pinned here: the inherited weakness must not be blamed on the move,
   and a weakness the move really does create must still be caught. */
{
  // The knight on c2 is attacked by the rook on c1, and the pawn on e4 by the
  // rook on e2. Neither white rook can be taken in reply — an earlier version
  // of this fixture put one on e1, where the c2 knight forked it, so the
  // position quietly contained free material and stopped testing what it says.
  const base = '6k1/pp3ppp/8/8/4p3/8/PPn1R1PP/2R3K1 b - - 0 1';
  assert.strictEqual(new Position(base).hangingFor('w').length, 0,
                     'nothing of white\'s may be free here, or this tests the wrong branch');
  const after = new Position(base);
  after.moveSan('Nb4');
  const looseAfter = after.hangingFor('b').map(p => ({ square: p.name, type: p.type, gain: p.gain }));

  // e4 was hanging before the move and the knight never defended it
  assert.ok(new Position(base).hangingFor('b').some(p => p.name === 'e4'),
            'the pawn on e4 should already be loose before the move');
  const v = verifyIntention(
    { color: 'b', fenBefore: base, fenAfter: after.fen(), from: 'c2', to: 'b4',
      captured: null, looseAfter, tags: [] },
    { kind: 'protect', target: 'c2' });
  assert.strictEqual(v.verdict, 'sound',
    'saving the knight is sound — e4 was loose before it moved: ' + v.detail);
  console.log('  ok   a weakness that predates the move is not blamed on it');

  // same shape, but now the knight is the only thing defending e3, so moving
  // it genuinely does hang the bishop
  // No pawn on f2 here: it would attack e3 too, and fxe3 wins a bishop for a
  // pawn whatever the knight is doing, which makes e3 loose before the move.
  // The king sits on h1 rather than g1 because emptying f2 opens the e3-g1
  // diagonal, and a position with White already in check is not black to play.
  const causes = '6k1/pp3ppp/8/8/3N4/4b3/PPn3PP/4R2K b - - 0 1';
  assert.ok(!new Position(causes).hangingFor('b').some(p => p.name === 'e3'),
            'the bishop on e3 should be held before the knight leaves');
  const after2 = new Position(causes);
  after2.moveSan('Nb4');
  const loose2 = after2.hangingFor('b').map(p => ({ square: p.name, type: p.type, gain: p.gain }));
  const v2 = verifyIntention(
    { color: 'b', fenBefore: causes, fenAfter: after2.fen(), from: 'c2', to: 'b4',
      captured: null, looseAfter: loose2, tags: [] },
    { kind: 'protect', target: 'c2' });
  assert.strictEqual(v2.verdict, 'tunnel_vision',
    'abandoning the piece it was defending is still tunnel vision: ' + v2.detail);
  console.log('  ok   a weakness the move does create is still caught');
}

/* A threat one move out is still a threat.

   Reported from a real game: 8.Nc3, tagged "protect a1". Nothing attacked the
   rook on a1 at that moment, so the desk called it a phantom threat — but the
   knight on d4 was one move from Nxc2, which forks the rook, and with the
   knight still on b1 the rook had no square to run to. Clearing b1 was the
   whole point of the move. The search had already found Nxc2 as Black's best
   reply, so the desk contradicted its own engine to tell a player who read the
   position correctly that they had imagined it.

   "Not attacked yet" and "not in danger" are different claims, and only the
   second one earns Phantom threat. */
{
  // after 7...Nxd4: Nb1 boxes the rook in, and Nxc2 is coming
  const fen = 'r1b1k1nr/pppp1ppp/8/4N3/3nP3/8/PPP2KPP/RNB2B1R w kq - 0 8';

  const alg = require('../src/engine.js').algebraic;
  const trapped = new Position(fen);
  trapped.moveSan('Be2');                 // leave the knight on b1
  trapped.moveSan('Nxc2');
  assert.strictEqual(
    trapped.withSideToMove('w').generateMoves().filter(m => alg(m.from) === 'a1').length, 0,
    'with the knight still on b1 the forked rook must have nowhere to go');

  const after = new Position(fen);
  after.moveSan('Nc3');
  const looseAfter = after.hangingFor('w').map(p => ({ square: p.name, type: p.type, gain: p.gain }));
  const v = verifyIntention(
    { color: 'w', fenBefore: fen, fenAfter: after.fen(), from: 'b1', to: 'c3',
      captured: null, looseAfter, tags: [] },
    { kind: 'protect', target: 'a1' });
  assert.strictEqual(v.verdict, 'foreseen_threat',
    'clearing the rook\'s only flight square is not a phantom threat: ' + v.detail);
  assert.ok(/Nxc2/.test(v.detail), 'the verdict should name the threat it credits: ' + v.detail);
  console.log('  ok   a threat one move out is credited, not called imaginary');

  // ...and a piece nothing can reach still earns the phantom verdict
  const quiet = 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1';
  const q = new Position(quiet);
  q.moveSan('e5');
  const v2 = verifyIntention(
    { color: 'b', fenBefore: quiet, fenAfter: q.fen(), from: 'e7', to: 'e5',
      captured: null, looseAfter: [], tags: [] },
    { kind: 'protect', target: 'a8' });
  assert.strictEqual(v2.verdict, 'phantom_threat',
    'a rook nothing can reach is still a phantom threat: ' + v2.detail);
  console.log('  ok   a piece nothing can reach is still a phantom threat');
}

/* Tactics get named, for both players.

   The motif detector has always found forks, pins, skewers and discovered
   attacks on every move of both sides. Nothing ever showed them: commentFor
   names at most one, and only when it wins the single headline line, so a fork
   and a pin in the same move left the pin invisible and the opponent's tactics
   were never named at all. They are chips now, so a player can see the pattern
   and go and read about it.

   The gates are what is checked here, since they are the new logic: same rules
   as the prose, so chip and sentence can never disagree. */
{
  const { gradeAll, applyGrade, TAGS } = require('../src/analysis.js');
  const MOTIF = ['fork', 'pin', 'skewer', 'discovered'];

  // Légal's Mate line — Black's bishop pins the f3 knight to the queen.
  const g = analyzeGame(pp('1. e4 e5 2. Nf3 Nc6 3. Bc4 d6 4. Nc3 Bg4 5. h3 Bh5 ' +
                           '6. Nxe5 Bxd1 7. Bxf7+ Ke7 8. Nd5#')[0], 'w');
  gradeAll(g.plies, 3);
  const pinned = g.plies.filter(p => p.tags.includes('pin'));
  assert.ok(pinned.length, 'the bishop pin on the f3 knight should be named');
  assert.ok(pinned.some(p => !p.isHero),
            "the opponent's tactics must be named too, not just the player's");
  console.log('  ok   a tactic by either player is named');

  // every motif tag must have a label, or the chip renders blank
  for (const t of MOTIF) assert.ok(TAGS[t] && TAGS[t].label, t + ' needs a label');
  console.log('  ok   every motif tag has a chip label');

  // the gates: a fork whose piece simply hangs is not one worth studying, and
  // nothing is called a tactic on a move that turned out to cost material
  const { motifTags, MOTIF_TAGS } = require('../src/analysis.js');
  const ply = (fork, swing) => ({ swing, motifs: { fork, pins: [], skewers: [], discovered: null } });

  assert.ok(motifTags(ply({ safe: true }, 0)).includes('fork'), 'a safe fork should be named');
  assert.ok(!motifTags(ply({ safe: false }, 0)).includes('fork'),
            'a fork whose piece simply hangs is not one worth studying');
  assert.ok(!motifTags(ply({ safe: true }, 300)).includes('fork'),
            'a move that cost material names no tactic');
  assert.deepStrictEqual(motifTags({ swing: 0 }), [], 'a ply with no motifs names nothing');
  console.log('  ok   a hanging fork and a costly move name no tactic');

  // grading runs more than once over a ply, so the chip has to be given back
  // rather than stacked — applyGrade rebuilds that slice of the tag list
  const stale = { tags: ['fork', 'hung_piece'], swing: 300,
                  motifs: { fork: { safe: true }, pins: [], skewers: [], discovered: null } };
  stale.tags = stale.tags.filter(t => MOTIF_TAGS.indexOf(t) === -1).concat(motifTags(stale));
  assert.deepStrictEqual(stale.tags, ['hung_piece'],
    'a swing that grew past the gate must take the chip back and keep the rest');
  console.log('  ok   re-grading takes the chip back instead of stacking it');
}

/* The bigger fish is not always one of yours.

   Reported from a real game. After 7.Ng5 the knight hit f7 AND the bishop on
   e4, and the player answered with Bg6 — which really does cover f7 and really
   does save the bishop. Their reading of the threat was exact: f7 held only by
   the king, Nxf7 forking d8 and h8, and Kxf7 illegal because Bc4 covers the
   square. All of that is true.

   What they missed was the rook on h1, left free when the knight vacated f3,
   and the desk could not say so: the check only looked at the player's own
   loose pieces, so it named the bishop they had already saved while the move
   verdict beside it said "their rook on h1 was free". Two cards, one position,
   different advice.

   Defending correctly is still the wrong move when something worth more was
   there for the taking. */
{
  const { SQUARES: SQ, algebraic: alg2 } = require('../src/engine.js');
  const fenBefore = 'rn1qkbnr/ppp2ppp/3p4/4p1N1/2B1b1PP/8/PPPP1P2/RNBQK2R b KQkq - 0 7';
  const before = new Position(fenBefore);

  // the player's reading of the position, confirmed before trusting the verdict
  assert.deepStrictEqual(before.attackersTo(SQ.f7, 'b').map(alg2), ['e8'],
                         'f7 really was held by the king alone');
  const forked = new Position(fenBefore);
  forked.moveSan('a6'); forked.moveSan('Nxf7');
  assert.ok(!forked.withSideToMove('b').generateMoves()
            .some(m => m.piece === 'k' && alg2(m.to) === 'f7'),
            'and the king really could not take on f7');

  const after = new Position(fenBefore);
  after.moveSan('Bg6');
  const looseAfter = after.hangingFor('b').map(p => ({ square: p.name, type: p.type, gain: p.gain }));
  const v = verifyIntention(
    { color: 'b', fenBefore, fenAfter: after.fen(), from: 'e4', to: 'g6',
      captured: null, looseAfter, tags: [] },
    { kind: 'protect', target: 'f7' });

  assert.strictEqual(v.verdict, 'wrong_priority');
  assert.ok(/rook on h1/.test(v.detail),
            'the free rook is the bigger fish, not the bishop: ' + v.detail);
  console.log('  ok   free enemy material outranks a loose piece of your own');

  // ...and when nothing of theirs is free, it still names your own loose piece
  const quiet = '4k3/5p2/8/8/7b/8/5PPP/4K2R b K - 0 1';
  const q = new Position(quiet);
  assert.strictEqual(q.hangingFor('w').length, 0, 'nothing of theirs is loose here');
  const qa = new Position(quiet); qa.moveSan('Kf8');
  const v2 = verifyIntention(
    { color: 'b', fenBefore: quiet, fenAfter: qa.fen(), from: 'e8', to: 'f8',
      captured: null, looseAfter: [], tags: [] },
    { kind: 'protect', target: 'f7' });
  assert.ok(!/free and worth more/.test(v2.detail),
            'with nothing free to take, the verdict must not claim there was: ' + v2.detail);
  console.log('  ok   with nothing of theirs free, the old reading still stands');
}
