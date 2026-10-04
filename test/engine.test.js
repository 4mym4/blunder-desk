const { Position, parsePgn, algebraic } = require('../src/engine.js');

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.generateMoves();
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    pos.makeMove(m);
    n += perft(pos, depth - 1);
    pos.undoMove();
  }
  return n;
}

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = got === want;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  got=${got} want=${want}`);
  ok ? pass++ : fail++;
}

console.log('=== PERFT: initial position ===');
const start = new Position();
check('perft 1', perft(start, 1), 20);
check('perft 2', perft(start, 2), 400);
check('perft 3', perft(start, 3), 8902);
check('perft 4', perft(start, 4), 197281);

console.log('\n=== PERFT: Kiwipete (castling, pins, ep) ===');
const kiwi = new Position('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
check('kiwipete perft 1', perft(kiwi, 1), 48);
check('kiwipete perft 2', perft(kiwi, 2), 2039);
check('kiwipete perft 3', perft(kiwi, 3), 97862);

console.log('\n=== PERFT: position 3 (en passant / promotion heavy) ===');
const p3 = new Position('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
check('pos3 perft 1', perft(p3, 1), 14);
check('pos3 perft 2', perft(p3, 2), 191);
check('pos3 perft 3', perft(p3, 3), 2812);
check('pos3 perft 4', perft(p3, 4), 43238);

console.log('\n=== PERFT: position 4 (promotions) ===');
const p4 = new Position('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
check('pos4 perft 1', perft(p4, 1), 6);
check('pos4 perft 2', perft(p4, 2), 264);
check('pos4 perft 3', perft(p4, 3), 9467);

console.log('\n=== PERFT: position 5 ===');
const p5 = new Position('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8');
check('pos5 perft 1', perft(p5, 1), 44);
check('pos5 perft 2', perft(p5, 2), 1486);
check('pos5 perft 3', perft(p5, 3), 62379);

console.log('\n=== FEN round-trip ===');
const fens = [
  'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
  'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
  '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'
];
for (const f of fens) check('fen ' + f.slice(0, 20), new Position(f).fen(), f);

console.log('\n=== SAN round-trip through a real game ===');
const pgn = `[Event "Test"]
[White "A"]
[Black "B"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6
8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 1/2-1/2`;
const parsed = parsePgn(pgn);
check('parsed games', parsed.length, 1);
check('parsed moves', parsed[0].moves.length, 20);
const pos = new Position();
let sanOk = true;
for (const t of parsed[0].moves) {
  const r = pos.moveSan(t.san);
  if (!r) { sanOk = false; console.log('  could not play', t.san); break; }
}
check('all SAN moves legal', sanOk, true);
check('final fen', pos.fen(), 'r1bq1rk1/2pnbppp/p2p1n2/1p2p3/3PP3/1BP2N1P/PP3PP1/RNBQR1K1 w - - 1 11');

console.log('\n=== en passant + promotion SAN ===');
const ep = new Position('8/8/8/8/5pP1/8/8/K6k b - g3 0 1');
check('ep capture available', !!ep.moveFromSan('fxg3'), true);
const promo = new Position('8/P7/8/8/8/8/8/K6k w - - 0 1');
const pr = promo.moveSan('a8=Q');
check('promotion san (a8-h1 diagonal gives check)', pr && pr.san, 'a8=Q+');

console.log('\n=== attackers / SEE ===');
// White queen on d1, black pawn on d5 defended by pawn c6 and e6
const seePos = new Position('4k3/8/2p1p3/3p4/8/8/8/3QK3 w - - 0 1');
check('d5 attacked by white', seePos.attackersTo(require('../src/engine.js').SQUARES.d5, 'w').length, 1);
check('Qxd5 loses material (see<=0)', seePos.see(require('../src/engine.js').SQUARES.d5, 'w') <= 0, true);

// free pawn, undefended
const freePos = new Position('4k3/8/8/3p4/8/8/8/3QK3 w - - 0 1');
check('Qxd5 is free (see>0)', freePos.see(require('../src/engine.js').SQUARES.d5, 'w') > 0, true);

// defended pawn, rook takes: bad
const tradePos = new Position('4k3/2p5/3p4/8/8/8/8/3RK3 w - - 0 1');
check('Rxd6 loses material', tradePos.see(require('../src/engine.js').SQUARES.d6, 'w') <= 0, true);

console.log('\n=== hanging detection ===');
// black knight on e5 undefended, attacked by white pawn d4
const hang = new Position('4k3/8/8/4n3/3P4/8/8/4K3 w - - 0 1');
const h = hang.hangingFor('b');
check('black knight hanging', h.length === 1 && h[0].name === 'e5', true);

console.log('\n=== mate in one ===');
const m1 = new Position('6k1/5ppp/8/8/8/8/8/R3K2R w KQ - 0 1');
check('back rank mate found', (() => { const m = m1.mateInOne(); return m ? algebraic(m.to) : null; })(), 'a8');

console.log(`\n=========================\n${pass} passed, ${fail} failed\n=========================`);
process.exit(fail === 0 ? 0 : 1);
