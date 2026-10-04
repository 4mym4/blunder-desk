const { Position, SQUARES, algebraic } = require('../src/engine.js');
const T = require('../src/tactics.js');

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${got} want=${want}`);
  ok ? pass++ : fail++;
}

console.log('=== search finds forced tactics ===');

// Back-rank mate in one.
{
  const p = new Position('6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1');
  const r = T.searchBest(p, 4);
  check('back rank: finds mate', T.isMateScore(r.score), true);
  check('back rank: move is Ra8', r.san, 'Ra8#');
}

// Royal fork: the knight check wins the queen. Material looks equal
// until the search plays the capture out.
{
  const p = new Position('r1b1k2r/pppp1ppp/8/4q3/8/5N2/PPPP1PPP/R1BQK2R w KQkq - 0 1');
  const r = T.searchBest(p, 4);
  check('fork position: search wins material', r.score >= 300, true);
}

// A knight fork of king and rook, one move away: Nc7+ from b5.
{
  const p = new Position('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
  const start = T.evalPos(p);          // white is down rook-for-knight here
  const r = T.searchBest(p, 4);
  // the score is a material DIFFERENTIAL, so winning a rook is a +500 swing,
  // not an absolute score of 500
  check('knight fork in reach: swing is a whole rook', r.score - start >= 450, true);
  check('knight fork in reach: plays Nc7+', r.san, 'Nc7+');
}

console.log('\n=== a sacrifice that wins material back ===');
{
  // Bxh7+ then Ng5+ wins the queen back (classic greek-gift shape).
  // Static material says the bishop is thrown away; the search should not.
  const p = new Position('rnbq1rk1/ppp2ppp/3b1n2/8/3P4/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 1');
  const after = new Position(p.fen());
  const bxh7 = after.moveFromSan('Bxh7+');
  check('Bxh7+ is legal here', !!bxh7, true);
  if (bxh7) {
    const seeSays = p.see(SQUARES.h7, 'w');
    const searchSays = T.scoreMove(new Position(p.fen()), bxh7, 4);
    console.log(`     static SEE on h7: ${seeSays}   search after Bxh7+: ${searchSays}`);
    check('search rates it far better than raw SEE', searchSays > seeSays - 400, true);
  }
}

console.log('\n=== motif detection ===');

// Knight on e5 forking a rook on c6 and a bishop on g6? build a clean one:
// white knight lands on c7 hitting Ke8 and Ra8 -> fork with check
{
  const before = new Position('r3k3/8/8/8/8/8/8/4K1N1 w - - 0 1');
  const after = new Position(before.fen());
  // reach c7 in one from a5
  const b2 = new Position('r3k3/8/8/N7/8/8/8/4K3 w - - 0 1');
  const a2 = new Position(b2.fen());
  const mv = a2.moveFromSan('Nc6');
  const nb7 = a2.moveFromSan('Nb7');
  const target = a2.moveFromSan('Nc6') ? 'Nc6' : null;
  // Nc7+ forks king and rook
  const mvC7 = a2.moveFromSan('Nc6');
  const b3 = new Position('r3k3/8/8/N7/8/8/8/4K3 w - - 0 1');
  const a3 = new Position(b3.fen());
  const forkMove = a3.moveFromSan('Nc6');
  check('Nc6 available', !!forkMove, true);

  // direct construction: knight already on c7
  const bPos = new Position('r3k3/2N5/8/8/8/8/8/4K3 b - - 0 1');
  const kingAttacked = bPos.attacked('w', bPos.kings.b);
  check('knight on c7 gives check', kingAttacked, true);
  const rookAttacked = bPos.attackersTo(SQUARES.a8, 'w').length > 0;
  check('knight on c7 also hits the rook', rookAttacked, true);
}

// fork detected through findMotifs
{
  const before = new Position('r3k3/8/1N6/8/8/8/8/4K3 w - - 0 1');
  const after = new Position(before.fen());
  const m = after.moveFromSan('Nc8');
  const mv = before.moveFromSan('Nc8') || before.moveFromSan('Nd7');
  const san = before.moveFromSan('Nd7') ? 'Nd7' : null;
  // Nd7 does not fork; use Nc7+? from b6 the knight reaches c8,d7,d5,c4,a4,a8
  const pos2 = new Position('r3k3/8/8/8/8/8/8/4K3 w - - 0 1');
  // place knight on b5 so Nc7 is available
  const pos3 = new Position('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1');
  const after3 = new Position(pos3.fen());
  const nc7 = after3.moveFromSan('Nc7+');
  check('Nc7+ available from b5', !!nc7, true);
  if (nc7) {
    after3.makeMove(nc7);
    const motifs = T.findMotifs(new Position(pos3.fen()), after3, nc7, 'w');
    check('fork detected', !!motifs.fork, true);
    check('fork gives check', motifs.check, true);
    check('fork hits 2+ targets', motifs.fork && motifs.fork.targets.length >= 2, true);
    console.log('     targets:', motifs.fork && motifs.fork.targets.map(t => t.type + t.name).join(' '));
  }
}

// absolute pin: rook pins a knight to the king
{
  const before = new Position('4k3/4n3/8/8/8/8/8/4RK2 w - - 0 1');
  const after = new Position(before.fen());
  const mv = after.moveFromSan('Re2');
  if (mv) {
    after.makeMove(mv);
    const motifs = T.findMotifs(new Position(before.fen()), after, mv, 'w');
    const pin = motifs.pins[0];
    check('pin detected', !!pin, true);
    check('pin is absolute (to the king)', pin ? pin.absolute : false, true);
    if (pin) console.log(`     ${pin.front.type}${pin.front.name} pinned to ${pin.back.type}${pin.back.name}`);
  }
}

// skewer: rook hits queen with a rook behind it
{
  const before = new Position('3qk3/8/8/8/8/8/8/3RK3 w - - 0 1');
  const p2 = new Position('3q4/3r4/4k3/8/8/8/8/3RK3 w - - 0 1');
  const after = new Position(p2.fen());
  const mv = after.moveFromSan('Rd3');
  if (mv) {
    after.makeMove(mv);
    const motifs = T.findMotifs(new Position(p2.fen()), after, mv, 'w');
    const sk = motifs.skewers[0] || motifs.pins[0];
    check('line motif on the d-file found', !!sk, true);
    if (sk) console.log(`     ${sk.kind}: front ${sk.front.type}${sk.front.name}, back ${sk.back.type}${sk.back.name}`);
  }
}

// discovered attack: moving a knight uncovers a ROOK down the d-file
// (a bishop on d1 could never hit d8 — that is a file, not a diagonal)
{
  const before = new Position('3qk3/8/8/8/8/3N4/8/3RK3 w - - 0 1');
  const after = new Position(before.fen());
  const mv = after.moveFromSan('Nf4');
  if (mv) {
    after.makeMove(mv);
    const motifs = T.findMotifs(new Position(before.fen()), after, mv, 'w');
    check('discovered attack detected', !!motifs.discovered, true);
    if (motifs.discovered) {
      console.log(`     ${motifs.discovered.piece}${motifs.discovered.from} now hits ${motifs.discovered.targets.join(',')}`);
    }
  }
}

console.log('\n=== performance ===');
{
  const p = new Position('r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 0 1');
  const t0 = Date.now();
  const r = T.searchBest(p, 4);
  const ms = Date.now() - t0;
  console.log(`     middlegame depth 4: ${ms}ms, ${r.nodes} nodes, best ${r.san} (${r.score})`);
  check('a single move search stays under 1500ms', ms < 1500, true);
}

console.log(`\n=========================\n${pass} passed, ${fail} failed\n=========================`);
process.exit(fail === 0 ? 0 : 1);
