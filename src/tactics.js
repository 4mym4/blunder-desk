/* ============================================================
   Tactics — two things static material counting cannot do.

   1. A real search. Material-only alpha-beta with a quiescence
      pass, so a move that looks terrible for one ply but wins
      the material back two plies later is scored correctly.
      This is what catches sacrifices, and moves that hang a
      piece in order to set up a fork.

   2. Motif detection. Naming WHAT a move created — fork, pin,
      skewer, discovered attack — so the app can explain a
      threat that wins nothing immediately.

   The evaluation is material plus mate. It is deliberately not
   positional: it never claims to judge space, structure or
   king safety, and the app never pretends otherwise.
   ============================================================ */

const T_ENG = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./engine.js') : null;
const TSQUARES = T_ENG ? T_ENG.SQUARES : SQUARES;
const talgebraic = T_ENG ? T_ENG.algebraic : algebraic;
const TVALUE = T_ENG ? T_ENG.VALUE : VALUE;
const TBITS = T_ENG ? T_ENG.BITS : BITS;
const tswap = T_ENG ? T_ENG.swap : swap;

const MATE = 100000;
const SEARCH_DEPTH = 4;

/* ---------- evaluation ---------- */

// Material from the side-to-move's point of view (negamax convention).
function evalPos(pos) {
  const m = pos.materialCount();
  return m[pos.turn] - m[tswap(pos.turn)];
}

// Most-valuable-victim / least-valuable-attacker, for move ordering.
function mvvLva(pos, m) {
  if (!m.captured) return 0;
  return TVALUE[m.captured] * 10 - TVALUE[m.piece];
}

function orderMoves(pos, moves) {
  return moves
    .map(m => ({ m, s: mvvLva(pos, m) + (m.promotion ? TVALUE[m.promotion] : 0) }))
    .sort((a, b) => b.s - a.s)
    .map(x => x.m);
}

/* ---------- quiescence ---------- */
// Only captures and promotions, so the search never stops in the
// middle of an exchange and mistakes a half-finished trade for a loss.
function quiesce(pos, alpha, beta, ply, budget) {
  if (budget.nodes++ > budget.max) return evalPos(pos);

  const inCheck = pos.inCheck();
  if (!inCheck) {
    const stand = evalPos(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
  }

  let moves = pos.generateMoves();
  if (!moves.length) return inCheck ? -MATE + ply : 0;
  if (!inCheck) moves = moves.filter(m => m.captured || (m.flags & TBITS.PROMOTION));
  if (!moves.length) return alpha;

  for (const m of orderMoves(pos, moves)) {
    pos.makeMove(m);
    const score = -quiesce(pos, -beta, -alpha, ply + 1, budget);
    pos.undoMove();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(pos, depth, alpha, beta, ply, budget) {
  if (budget.nodes++ > budget.max) return evalPos(pos);
  if (depth <= 0) return quiesce(pos, alpha, beta, ply, budget);

  const moves = pos.generateMoves();
  if (!moves.length) return pos.inCheck() ? -MATE + ply : 0;

  for (const m of orderMoves(pos, moves)) {
    pos.makeMove(m);
    const score = -negamax(pos, depth - 1, -beta, -alpha, ply + 1, budget);
    pos.undoMove();
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

/* Best move and score for the side to move, in centipawns from
   that side's point of view. */
/* Searches every root move once and returns the best plus a score for
   each, so the caller can grade the move actually played without a
   second search of the same position. Root moves get a full window:
   alpha-beta at the root would only return a bound for the others. */
function searchBest(pos, depth = SEARCH_DEPTH, maxNodes = 200000) {
  const budget = { nodes: 0, max: maxNodes };
  const moves = pos.generateMoves();
  if (!moves.length) {
    return { score: pos.inCheck() ? -MATE : 0, move: null, san: null, scores: {}, nodes: 0 };
  }

  let alpha = -Infinity, best = null;
  const scores = {};
  for (const m of orderMoves(pos, moves)) {
    const san = pos.moveToSan(m, moves);
    pos.makeMove(m);
    const score = -negamax(pos, depth - 1, -Infinity, Infinity, 1, budget);
    pos.undoMove();
    scores[san] = score;
    if (score > alpha) { alpha = score; best = { m, san }; }
  }
  return { score: alpha, move: best ? best.m : null, san: best ? best.san : null, scores, nodes: budget.nodes };
}

/* Score of a specific move, from the mover's point of view. */
function scoreMove(pos, move, depth = SEARCH_DEPTH, maxNodes = 120000) {
  const budget = { nodes: 0, max: maxNodes };
  pos.makeMove(move);
  const score = -negamax(pos, depth - 1, -Infinity, Infinity, 1, budget);
  pos.undoMove();
  return score;
}

/* The line the search expects, not just its first move.

   negamax does not carry a principal variation, and threading one through the
   hot loop would cost every node a little to serve one move's explanation. So
   the line is walked instead: search, play the best move, search again. It is
   the same evaluation at every step, so the line cannot contradict the move it
   starts from. The caller's position is left exactly as it was found. */
function bestLine(pos, depth = SEARCH_DEPTH, maxPlies = 4) {
  const line = [];
  const played = [];
  let mateIn = null;
  for (let i = 0; i < maxPlies; i++) {
    const res = searchBest(pos, depth);
    if (!res.move || !res.san) break;
    if (mateIn == null && isMateScore(res.score)) mateIn = mateInPlies(res.score);
    line.push(res.san);
    pos.makeMove(res.move);
    played.push(true);
    if (/#/.test(res.san)) break;              // nothing follows mate
  }
  for (let i = played.length - 1; i >= 0; i--) pos.undoMove();
  return { line, mateIn };
}
// mateIn() counts from the score's point of view; the line only needs the
// distance, and only for the side that is delivering it.
function mateInPlies(score) { return score > 0 ? Math.ceil((MATE - score) / 2) : null; }

function isMateScore(s) { return Math.abs(s) > MATE - 1000; }
function mateIn(s) { return s > 0 ? Math.ceil((MATE - s) / 2) : -Math.ceil((MATE + s) / 2); }

/* ============================================================
   Motifs — what a move actually threatens.
   ============================================================ */

// Enemy pieces the piece on `from` attacks, which it would be
// worth taking: the king (check), anything undefended, or
// anything worth more than the attacker.
function targetsOf(pos, from, me) {
  const them = tswap(me);
  const attacker = pos.board[from];
  if (!attacker) return [];
  const out = [];
  for (const p of pos.piecesOf(them)) {
    if (!pos.attacksFrom(from, p.square, attacker)) continue;
    if (p.type === 'k') { out.push({ ...p, reason: 'check' }); continue; }
    const defended = pos.attackersTo(p.square, them).length > 0;
    const worthMore = TVALUE[p.type] > TVALUE[attacker.type];
    if (!defended || worthMore) out.push({ ...p, reason: !defended ? 'loose' : 'bigger' });
  }
  return out;
}

// Sliding rays from a square, as lists of squares outward.
const RAY_DIRS = {
  b: [-17, -15, 17, 15],
  r: [-16, 1, 16, -1],
  q: [-17, -16, -15, 1, 17, 16, 15, -1]
};

// A pin or skewer: two enemy pieces in a line from one of my sliders.
function lineMotifs(pos, from, me) {
  const them = tswap(me);
  const piece = pos.board[from];
  if (!piece || !RAY_DIRS[piece.type]) return [];
  const out = [];
  for (const dir of RAY_DIRS[piece.type]) {
    let sq = from + dir, first = null;
    while (!(sq & 0x88)) {
      const occ = pos.board[sq];
      if (occ) {
        if (occ.color === me) break;
        if (!first) { first = { ...occ, square: sq, name: talgebraic(sq) }; }
        else {
          const second = { ...occ, square: sq, name: talgebraic(sq) };
          // A pawn stuck in front of something is not a tactic worth
          // naming — pawns rarely want to move anyway. Only report a pin
          // or skewer when the piece being restrained is a real piece.
          // The piece being restrained must be a real piece, and the piece
          // behind it must be worth winning. Lining a knight up against a
          // pawn is not a tactic, it is a coincidence.
          const frontIsPiece = first.type !== 'p' && first.type !== 'k';
          const backWorthIt = second.type === 'k' || TVALUE[second.type] >= 500;
          if (frontIsPiece && backWorthIt) {
            if (second.type === 'k' || TVALUE[second.type] > TVALUE[first.type]) {
              out.push({ kind: 'pin', front: first, back: second, absolute: second.type === 'k' });
            } else if (TVALUE[first.type] > TVALUE[second.type]) {
              out.push({ kind: 'skewer', front: first, back: second, absolute: false });
            }
          }
          break;
        }
      }
      sq += dir;
    }
  }
  return out;
}

/* Everything this move created. `before`/`after` are Positions,
   `move` the engine move object, `me` the mover's colour. */
function findMotifs(before, after, move, me) {
  const them = tswap(me);
  const out = { fork: null, pins: [], skewers: [], discovered: null, check: false, threats: [] };

  out.check = after.attacked(me, after.kings[them]);

  // --- fork: the moved piece hitting two worthwhile targets at once
  const targets = targetsOf(after, move.to, me);
  const moverSafe = after.see(move.to, them) <= 0;
  if (targets.length >= 2) {
    out.fork = { square: talgebraic(move.to), piece: move.piece, targets, safe: moverSafe };
  }
  out.threats = targets;

  // --- pins and skewers, from the moved piece and from anything
  //     whose line the move opened
  for (const lm of lineMotifs(after, move.to, me)) {
    (lm.kind === 'skewer' ? out.skewers : out.pins).push({ ...lm, by: talgebraic(move.to) });
  }

  // --- discovered attack: another of my pieces now hits something
  //     valuable that it did not hit before, because `from` emptied
  for (const p of after.piecesOf(me)) {
    if (p.square === move.to) continue;
    const beforePiece = before.board[p.square];
    if (!beforePiece || beforePiece.color !== me || beforePiece.type !== p.type) continue;
    const nowT = targetsOf(after, p.square, me).map(t => t.name);
    const wasT = targetsOf(before, p.square, me).map(t => t.name);
    const fresh = nowT.filter(n => !wasT.includes(n));
    if (fresh.length) {
      const freshBig = fresh.filter(n => {
        const occ = after.board[TSQUARES[n]];
        return occ && (occ.type === 'k' || TVALUE[occ.type] >= 300);
      });
      if (freshBig.length && !out.discovered) {
        out.discovered = { from: p.name, piece: p.type, targets: freshBig };
      }
    }
    for (const lm of lineMotifs(after, p.square, me)) {
      const existed = lineMotifs(before, p.square, me)
        .some(x => x.front.name === lm.front.name && x.back.name === lm.back.name);
      if (!existed) (lm.kind === 'skewer' ? out.skewers : out.pins).push({ ...lm, by: p.name });
    }
  }

  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    searchBest, bestLine, scoreMove, findMotifs, targetsOf, lineMotifs,
    isMateScore, mateIn, MATE, SEARCH_DEPTH, evalPos
  };
}
