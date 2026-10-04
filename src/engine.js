/* ============================================================
   Chess engine core — 0x88 board, legal move generation,
   SAN parse/write, FEN, attackers, static exchange evaluation.
   No dependencies. Shared by the Node test harness and the app.
   ============================================================ */

// piece codes: lowercase letter + colour flag
const W = 'w', B = 'b';

const PAWN = 'p', KNIGHT = 'n', BISHOP = 'b', ROOK = 'r', QUEEN = 'q', KING = 'k';

const VALUE = { p: 100, n: 300, b: 325, r: 500, q: 900, k: 20000 };

// 0x88 offsets
const OFFSETS = {
  n: [-18, -33, -31, -14, 18, 33, 31, 14],
  b: [-17, -15, 17, 15],
  r: [-16, 1, 16, -1],
  q: [-17, -16, -15, 1, 17, 16, 15, -1],
  k: [-17, -16, -15, 1, 17, 16, 15, -1]
};

const SQUARES = {};
(function () {
  const files = 'abcdefgh';
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      SQUARES[files[f] + (8 - r)] = r * 16 + f;
    }
  }
})();

function algebraic(sq) {
  const f = sq & 15, r = sq >> 4;
  return 'abcdefgh'[f] + (8 - r);
}
function rank(sq) { return sq >> 4; }
function file(sq) { return sq & 15; }
function swap(c) { return c === W ? B : W; }

const BITS = {
  NORMAL: 1, CAPTURE: 2, BIG_PAWN: 4, EP_CAPTURE: 8,
  PROMOTION: 16, KSIDE_CASTLE: 32, QSIDE_CASTLE: 64
};

const ROOKS = {
  w: [{ square: SQUARES.a1, flag: BITS.QSIDE_CASTLE }, { square: SQUARES.h1, flag: BITS.KSIDE_CASTLE }],
  b: [{ square: SQUARES.a8, flag: BITS.QSIDE_CASTLE }, { square: SQUARES.h8, flag: BITS.KSIDE_CASTLE }]
};

class Position {
  constructor(fen) {
    this.board = new Array(128).fill(null);
    this.turn = W;
    this.castling = { w: 0, b: 0 };
    this.epSquare = -1;
    this.halfMoves = 0;
    this.moveNumber = 1;
    this.kings = { w: -1, b: -1 };
    this.history = [];
    this.load(fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  }

  load(fen) {
    const parts = fen.split(/\s+/);
    const rows = parts[0].split('/');
    this.board = new Array(128).fill(null);
    this.kings = { w: -1, b: -1 };
    let sq = 0;
    for (let r = 0; r < 8; r++) {
      let f = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { f += parseInt(ch, 10); continue; }
        const colour = ch === ch.toUpperCase() ? W : B;
        const type = ch.toLowerCase();
        sq = r * 16 + f;
        this.board[sq] = { type, color: colour };
        if (type === KING) this.kings[colour] = sq;
        f++;
      }
    }
    this.turn = parts[1] === 'b' ? B : W;
    this.castling = { w: 0, b: 0 };
    const c = parts[2] || '-';
    if (c.includes('K')) this.castling.w |= BITS.KSIDE_CASTLE;
    if (c.includes('Q')) this.castling.w |= BITS.QSIDE_CASTLE;
    if (c.includes('k')) this.castling.b |= BITS.KSIDE_CASTLE;
    if (c.includes('q')) this.castling.b |= BITS.QSIDE_CASTLE;
    this.epSquare = (!parts[3] || parts[3] === '-') ? -1 : SQUARES[parts[3]];
    this.halfMoves = parseInt(parts[4] || '0', 10);
    this.moveNumber = parseInt(parts[5] || '1', 10);
    this.history = [];
    return this;
  }

  fen() {
    let empty = 0, out = '';
    for (let i = SQUARES.a8; i <= SQUARES.h1; i++) {
      if (!this.board[i]) empty++;
      else {
        if (empty > 0) { out += empty; empty = 0; }
        const p = this.board[i];
        out += p.color === W ? p.type.toUpperCase() : p.type;
      }
      if ((i + 1) & 0x88) {
        if (empty > 0) out += empty;
        if (i !== SQUARES.h1) out += '/';
        empty = 0;
        i += 8;
      }
    }
    let cf = '';
    if (this.castling.w & BITS.KSIDE_CASTLE) cf += 'K';
    if (this.castling.w & BITS.QSIDE_CASTLE) cf += 'Q';
    if (this.castling.b & BITS.KSIDE_CASTLE) cf += 'k';
    if (this.castling.b & BITS.QSIDE_CASTLE) cf += 'q';
    cf = cf || '-';
    const ep = this.epSquare === -1 ? '-' : algebraic(this.epSquare);
    return [out, this.turn, cf, ep, this.halfMoves, this.moveNumber].join(' ');
  }

  get(sqName) { const s = SQUARES[sqName]; return s === undefined ? null : this.board[s]; }

  /* ---------- attack detection ---------- */

  // Does the piece of `color` standing on `from` attack `square`?
  // `RAYS[idx]` is the vector from `square` towards `from`, so stepping
  // from `from` back towards `square` means subtracting it.
  attacksFrom(from, square, piece) {
    const diff = from - square;
    if (diff === 0) return false;
    const idx = diff + 119;
    if (!(ATTACKS[idx] & PIECE_MASK[piece.type])) return false;

    if (piece.type === PAWN) {
      // a white pawn attacks towards rank 8 (lower index), a black pawn towards rank 1
      return piece.color === W ? diff > 0 : diff < 0;
    }
    if (piece.type === KNIGHT || piece.type === KING) return true;

    const offset = RAYS[idx];
    if (!offset) return false;
    let j = from - offset;
    while (j !== square) {
      if (j & 0x88) return false;      // ran off the board: not a real ray
      if (this.board[j]) return false; // blocked
      j -= offset;
    }
    return true;
  }

  // is `square` attacked by any piece of `color`? (short-circuits)
  attacked(color, square) {
    for (let i = SQUARES.a8; i <= SQUARES.h1; i++) {
      if (i & 0x88) { i += 7; continue; }
      const piece = this.board[i];
      if (!piece || piece.color !== color) continue;
      if (this.attacksFrom(i, square, piece)) return true;
    }
    return false;
  }

  // list of squares holding pieces of `color` that attack `square`
  attackersTo(square, color) {
    const out = [];
    for (let i = SQUARES.a8; i <= SQUARES.h1; i++) {
      if (i & 0x88) { i += 7; continue; }
      const piece = this.board[i];
      if (!piece || piece.color !== color) continue;
      if (this.attacksFrom(i, square, piece)) out.push(i);
    }
    return out;
  }

  inCheck() { return this.kings[this.turn] !== -1 && this.attacked(swap(this.turn), this.kings[this.turn]); }
  kingAttacked(color) { return color === this.turn ? this.inCheck() : this.attacked(this.turn, this.kings[color]); }

  /* ---------- move generation ---------- */
  generateMoves(opts = {}) {
    const legal = opts.legal !== false;
    const us = this.turn, them = swap(us);
    const moves = [];
    const addMove = (from, to, flags, promotion) => {
      const piece = this.board[from];
      if (piece.type === PAWN && (rank(to) === 0 || rank(to) === 7)) {
        for (const pr of ['q', 'r', 'b', 'n']) {
          moves.push(this.buildMove(from, to, flags | BITS.PROMOTION, pr));
        }
      } else {
        moves.push(this.buildMove(from, to, flags, promotion));
      }
    };

    let firstSq = SQUARES.a8, lastSq = SQUARES.h1;
    const singleSquare = opts.square !== undefined ? SQUARES[opts.square] : undefined;
    if (singleSquare !== undefined) { firstSq = lastSq = singleSquare; }

    for (let i = firstSq; i <= lastSq; i++) {
      if (i & 0x88) { i += 7; continue; }
      const piece = this.board[i];
      if (!piece || piece.color !== us) continue;

      if (piece.type === PAWN) {
        const dir = us === W ? -16 : 16;
        const one = i + dir;
        if (!(one & 0x88) && !this.board[one]) {
          addMove(i, one, BITS.NORMAL);
          const startRank = us === W ? 6 : 1;
          const two = i + dir * 2;
          if (rank(i) === startRank && !this.board[two]) addMove(i, two, BITS.BIG_PAWN);
        }
        for (const d of [dir - 1, dir + 1]) {
          const to = i + d;
          if (to & 0x88) continue;
          const target = this.board[to];
          if (target && target.color === them) addMove(i, to, BITS.CAPTURE);
          else if (to === this.epSquare) addMove(i, to, BITS.EP_CAPTURE);
        }
      } else {
        for (const offset of OFFSETS[piece.type]) {
          let to = i;
          for (;;) {
            to += offset;
            if (to & 0x88) break;
            const target = this.board[to];
            if (!target) addMove(i, to, BITS.NORMAL);
            else {
              if (target.color === us) break;
              addMove(i, to, BITS.CAPTURE);
              break;
            }
            if (piece.type === KNIGHT || piece.type === KING) break;
          }
        }
      }
    }

    // castling
    if (singleSquare === undefined || singleSquare === this.kings[us]) {
      if (this.kings[us] !== -1) {
        const kingSq = this.kings[us];
        if (this.castling[us] & BITS.KSIDE_CASTLE) {
          const to = kingSq + 2;
          if (!this.board[kingSq + 1] && !this.board[to] &&
              !this.attacked(them, kingSq) && !this.attacked(them, kingSq + 1) && !this.attacked(them, to)) {
            moves.push(this.buildMove(kingSq, to, BITS.KSIDE_CASTLE));
          }
        }
        if (this.castling[us] & BITS.QSIDE_CASTLE) {
          const to = kingSq - 2;
          if (!this.board[kingSq - 1] && !this.board[kingSq - 2] && !this.board[kingSq - 3] &&
              !this.attacked(them, kingSq) && !this.attacked(them, kingSq - 1) && !this.attacked(them, to)) {
            moves.push(this.buildMove(kingSq, to, BITS.QSIDE_CASTLE));
          }
        }
      }
    }

    if (!legal) return moves;

    // A move can only be illegal if it leaves our own king attacked, which
    // needs one of: we are already in check, the king itself is moving, the
    // moving piece is pinned, or en passant (which removes a second piece
    // from the rank). Everything else is legal without a make/undo test.
    const kingSq = this.kings[us];
    const inCheckNow = kingSq !== -1 && this.attacked(them, kingSq);
    const pinned = kingSq === -1 ? null : this.pinnedSquares(us, kingSq);

    const legalMoves = [];
    for (const m of moves) {
      const mustVerify = inCheckNow || m.piece === KING ||
        (m.flags & BITS.EP_CAPTURE) || (pinned !== null && pinned.has(m.from));
      if (!mustVerify) { legalMoves.push(m); continue; }
      this.makeMove(m);
      if (!this.kingAttacked(us)) legalMoves.push(m);
      this.undoMove();
    }
    return legalMoves;
  }

  // Squares holding a piece of `color` that stands between its own king
  // and an enemy slider — the only non-king pieces whose moves can expose
  // the king.
  pinnedSquares(color, kingSq) {
    const them = swap(color);
    const set = new Set();
    for (const dir of OFFSETS.q) {
      let sq = kingSq + dir, own = -1;
      while (!(sq & 0x88)) {
        const occ = this.board[sq];
        if (occ) {
          if (occ.color === color) {
            if (own !== -1) break;   // two of ours in the way: nothing pinned
            own = sq;
          } else {
            if (own !== -1) {
              const diagonal = dir === -17 || dir === -15 || dir === 15 || dir === 17;
              const slides = occ.type === QUEEN ||
                (diagonal ? occ.type === BISHOP : occ.type === ROOK);
              if (slides) set.add(own);
            }
            break;
          }
        }
        sq += dir;
      }
    }
    return set;
  }

  buildMove(from, to, flags, promotion) {
    const move = {
      color: this.turn, from, to, flags,
      piece: this.board[from].type
    };
    if (promotion) { move.flags |= BITS.PROMOTION; move.promotion = promotion; }
    if (this.board[to]) move.captured = this.board[to].type;
    else if (flags & BITS.EP_CAPTURE) move.captured = PAWN;
    return move;
  }

  makeMove(move) {
    const us = this.turn, them = swap(us);
    this.history.push({
      move,
      kings: { ...this.kings },
      turn: this.turn,
      castling: { ...this.castling },
      epSquare: this.epSquare,
      halfMoves: this.halfMoves,
      moveNumber: this.moveNumber
    });

    this.board[move.to] = this.board[move.from];
    this.board[move.from] = null;

    if (move.flags & BITS.EP_CAPTURE) {
      this.board[move.to + (us === W ? 16 : -16)] = null;
    }
    if (move.flags & BITS.PROMOTION) {
      this.board[move.to] = { type: move.promotion, color: us };
    }
    if (this.board[move.to].type === KING) {
      this.kings[us] = move.to;
      if (move.flags & BITS.KSIDE_CASTLE) {
        this.board[move.to - 1] = this.board[move.to + 1];
        this.board[move.to + 1] = null;
      } else if (move.flags & BITS.QSIDE_CASTLE) {
        this.board[move.to + 1] = this.board[move.to - 2];
        this.board[move.to - 2] = null;
      }
      this.castling[us] = 0;
    }

    if (this.castling[us]) {
      for (const r of ROOKS[us]) {
        if (move.from === r.square && (this.castling[us] & r.flag)) { this.castling[us] ^= r.flag; break; }
      }
    }
    if (this.castling[them]) {
      for (const r of ROOKS[them]) {
        if (move.to === r.square && (this.castling[them] & r.flag)) { this.castling[them] ^= r.flag; break; }
      }
    }

    if (move.flags & BITS.BIG_PAWN) {
      this.epSquare = move.to + (us === W ? 16 : -16);
    } else this.epSquare = -1;

    if (move.piece === PAWN || (move.flags & (BITS.CAPTURE | BITS.EP_CAPTURE))) this.halfMoves = 0;
    else this.halfMoves++;
    if (us === B) this.moveNumber++;
    this.turn = them;
  }

  undoMove() {
    const old = this.history.pop();
    if (!old) return null;
    const move = old.move;
    this.kings = old.kings;
    this.turn = old.turn;
    this.castling = old.castling;
    this.epSquare = old.epSquare;
    this.halfMoves = old.halfMoves;
    this.moveNumber = old.moveNumber;

    const us = this.turn, them = swap(us);
    this.board[move.from] = this.board[move.to];
    this.board[move.from].type = move.piece;
    this.board[move.to] = null;

    if (move.flags & BITS.EP_CAPTURE) {
      this.board[move.to + (us === W ? 16 : -16)] = { type: PAWN, color: them };
    } else if (move.captured) {
      this.board[move.to] = { type: move.captured, color: them };
    }

    if (move.flags & BITS.KSIDE_CASTLE) {
      this.board[move.to + 1] = this.board[move.to - 1];
      this.board[move.to - 1] = null;
    } else if (move.flags & BITS.QSIDE_CASTLE) {
      this.board[move.to - 2] = this.board[move.to + 1];
      this.board[move.to + 1] = null;
    }
    return move;
  }

  /* ---------- SAN ---------- */
  moveToSan(move, moves) {
    if (move.flags & BITS.KSIDE_CASTLE) return this.decorate('O-O', move);
    if (move.flags & BITS.QSIDE_CASTLE) return this.decorate('O-O-O', move);
    let out = '';
    if (move.piece !== PAWN) {
      out += move.piece.toUpperCase();
      out += this.disambiguator(move, moves);
    }
    if (move.flags & (BITS.CAPTURE | BITS.EP_CAPTURE)) {
      if (move.piece === PAWN) out += algebraic(move.from)[0];
      out += 'x';
    }
    out += algebraic(move.to);
    if (move.flags & BITS.PROMOTION) out += '=' + move.promotion.toUpperCase();
    return this.decorate(out, move);
  }

  decorate(san, move) {
    this.makeMove(move);
    if (this.inCheck()) san += this.generateMoves().length === 0 ? '#' : '+';
    this.undoMove();
    return san;
  }

  disambiguator(move, moves) {
    moves = moves || this.generateMoves();
    let same = 0, sameRank = 0, sameFile = 0;
    for (const m of moves) {
      if (m.piece === move.piece && m.from !== move.from && m.to === move.to) {
        same++;
        if (rank(m.from) === rank(move.from)) sameRank++;
        if (file(m.from) === file(move.from)) sameFile++;
      }
    }
    if (!same) return '';
    if (sameFile && sameRank) return algebraic(move.from);
    if (sameFile) return algebraic(move.from)[1];
    return algebraic(move.from)[0];
  }

  // Parse a SAN string into a move object from the current position.
  moveFromSan(san) {
    const clean = String(san).replace(/[+#?!]+$/, '').replace(/[?!]/g, '').trim();
    const moves = this.generateMoves();
    for (const m of moves) {
      if (this.moveToSan(m, moves).replace(/[+#]/g, '') === clean) return m;
    }
    // tolerate sloppy forms (e.g. "Nf3" written as "Ngf3", long algebraic, 0-0)
    const alt = clean.replace(/0/g, 'O');
    for (const m of moves) {
      if (this.moveToSan(m, moves).replace(/[+#]/g, '') === alt) return m;
    }
    const m2 = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQ]))?$/.exec(alt);
    if (m2) {
      const [, pc, ff, fr, to, promo] = m2;
      for (const m of moves) {
        if (algebraic(m.to) !== to) continue;
        if (m.piece !== (pc ? pc.toLowerCase() : PAWN)) continue;
        if (ff && algebraic(m.from)[0] !== ff) continue;
        if (fr && algebraic(m.from)[1] !== fr) continue;
        if (promo && m.promotion !== promo.toLowerCase()) continue;
        return m;
      }
    }
    return null;
  }

  // apply a SAN move; returns {san, move} or null
  moveSan(san) {
    const m = this.moveFromSan(san);
    if (!m) return null;
    const sanOut = this.moveToSan(m);
    this.makeMove(m);
    return { san: sanOut, move: m };
  }

  /* ---------- material / exchange evaluation ---------- */

  // A copy of this position with `color` to move. Used to ask static
  // questions ("could they take that?") when it is not their turn.
  withSideToMove(color) {
    if (this.turn === color) return this;
    const parts = this.fen().split(' ');
    parts[1] = color;
    parts[3] = '-';          // an en-passant right cannot survive a null move
    return new Position(parts.join(' '));
  }

  // Static exchange evaluation: value won by `color` initiating a capture on `square`.
  // Positive = winning material for the side that captures first.
  // Works whether or not it is currently `color`'s turn.
  see(square, color) {
    const target = this.board[square];
    if (!target || target.color === color) return 0;
    if (this.turn !== color) return this.withSideToMove(color).seeRec(square, color, VALUE[target.type]);
    return this.seeRec(square, color, VALUE[target.type]);
  }

  seeRec(square, color, onSquareValue) {
    // A king can capture, but can never be captured: an exchange
    // sequence stops as soon as a king is the piece standing there.
    const occupant = this.board[square];
    if (occupant && occupant.type === KING) return 0;
    const attackers = this.attackersTo(square, color);
    if (!attackers.length) return 0;
    // choose the least valuable attacker that can legally capture
    attackers.sort((a, b) => VALUE[this.board[a].type] - VALUE[this.board[b].type]);
    for (const from of attackers) {
      const movingType = this.board[from].type;
      const moves = this.generateMoves({ square: algebraic(from) });
      const m = moves.find(x => x.to === square);
      if (!m) continue; // pinned or otherwise illegal
      this.makeMove(m);
      const captured = m.flags & BITS.PROMOTION ? VALUE[m.promotion] : VALUE[movingType];
      const gain = onSquareValue - this.seeRec(square, swap(color), captured);
      this.undoMove();
      return Math.max(0, gain);
    }
    return 0;
  }

  materialCount() {
    const out = { w: 0, b: 0 };
    for (let i = SQUARES.a8; i <= SQUARES.h1; i++) {
      if (i & 0x88) { i += 7; continue; }
      const p = this.board[i];
      if (p && p.type !== KING) out[p.color] += VALUE[p.type];
    }
    return out;
  }

  // all squares holding pieces of `color`
  piecesOf(color) {
    const out = [];
    for (let i = SQUARES.a8; i <= SQUARES.h1; i++) {
      if (i & 0x88) { i += 7; continue; }
      const p = this.board[i];
      if (p && p.color === color) out.push({ square: i, name: algebraic(i), type: p.type });
    }
    return out;
  }

  // pieces of `color` that the opponent can profitably capture right now
  hangingFor(color) {
    const out = [];
    for (const p of this.piecesOf(color)) {
      if (p.type === KING) continue;
      const gain = this.see(p.square, swap(color));
      if (gain > 0) out.push({ ...p, gain });
    }
    return out;
  }

  isCheckmate() { return this.inCheck() && this.generateMoves().length === 0; }

  // Does `color` have a mate in one available right now (it is their turn)?
  mateInOne() {
    const moves = this.generateMoves();
    for (const m of moves) {
      this.makeMove(m);
      const mate = this.isCheckmate();
      this.undoMove();
      if (mate) return m;
    }
    return null;
  }
}

/* ---------- attack lookup tables (0x88) ---------- */
const PIECE_MASK = { p: 1, n: 2, b: 4, r: 8, q: 16, k: 32 };
const ATTACKS = new Array(240).fill(0);
const RAYS = new Array(240).fill(0);
(function buildTables() {
  // For every pair of squares on the 0x88 board, record which piece types
  // could attack along that vector, plus the ray direction.
  const dirs = [
    { offs: OFFSETS.r, mask: PIECE_MASK.r | PIECE_MASK.q, slide: true },
    { offs: OFFSETS.b, mask: PIECE_MASK.b | PIECE_MASK.q, slide: true }
  ];
  for (const d of dirs) {
    for (const off of d.offs) {
      for (let dist = 1; dist < 8; dist++) {
        const diff = off * dist;
        const idx = diff + 119;
        if (idx < 0 || idx > 239) continue;
        ATTACKS[idx] |= d.mask;
        RAYS[idx] = off;
        if (dist === 1) ATTACKS[idx] |= PIECE_MASK.k;
      }
    }
  }
  for (const off of OFFSETS.n) {
    const idx = off + 119;
    ATTACKS[idx] |= PIECE_MASK.n;
  }
  // pawn attack vectors (both colours; direction filtered at use site)
  for (const off of [15, 17, -15, -17]) ATTACKS[off + 119] |= PIECE_MASK.p;
})();

/* ---------- PGN parsing ---------- */

function parsePgn(text) {
  const games = [];
  // handle files where games are separated by blank lines between header and body
  const raw = [];
  let buffer = [];
  for (const line of String(text).split(/\r?\n/)) {
    if (/^\[Event\b/.test(line) && buffer.some(l => !/^\[/.test(l) && l.trim())) {
      raw.push(buffer.join('\n')); buffer = [];
    }
    buffer.push(line);
  }
  if (buffer.length) raw.push(buffer.join('\n'));

  for (const block of raw) {
    if (!block.trim()) continue;
    const headers = {};
    const headerRe = /\[(\w+)\s+"([^"]*)"\]/g;
    let hm;
    while ((hm = headerRe.exec(block))) headers[hm[1]] = hm[2];
    let body = block.replace(/\[(\w+)\s+"([^"]*)"\]/g, ' ');

    // pull clock annotations before stripping comments
    // tokenise: walk through the body, tracking move tokens and their comments
    body = body.replace(/;[^\n]*/g, ' ');
    // remove variations (nested parens)
    let depth = 0, stripped = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      else if (ch === ')') { if (depth > 0) depth--; }
      else if (depth === 0) stripped += ch;
    }
    body = stripped;

    const tokens = [];
    const tokenRe = /(\{[^}]*\})|(\$\d+)|(\d+\.(?:\.\.)?)|(1-0|0-1|1\/2-1\/2|\*)|([OoA-Za-z][\w\-+#=]*)/g;
    let tm;
    while ((tm = tokenRe.exec(body))) {
      if (tm[1]) {
        const c = /\[%clk\s+([\d:.]+)\]/.exec(tm[1]);
        if (c && tokens.length) tokens[tokens.length - 1].clock = c[1];
        continue;
      }
      if (tm[2] || tm[3]) continue;
      if (tm[4]) continue;
      const san = tm[5];
      if (/^(1-0|0-1|\*)$/.test(san)) continue;
      tokens.push({ san });
    }
    // keep the raw block so a game can be stored and re-read later
    if (tokens.length) games.push({ headers, moves: tokens, raw: block.trim() });
  }
  return games;
}

function clockToSeconds(str) {
  if (!str) return null;
  const parts = str.split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0];
}

/* ---------- exports (Node only; the browser build defines these globally) ---------- */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Position, SQUARES, algebraic, VALUE, BITS, parsePgn, clockToSeconds, swap };
}
