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
