/* ============================================================
   Commentary — a grade and one line of plain English for every
   move, both players.

   Every sentence is generated from something the analysis can
   actually prove: a capture that was counted out, a fork the
   motif detector found, a search swing in centipawns. Nothing
   here guesses at style or intent, and nothing claims a
   positional judgement the evaluation cannot make.

   The grade comes from the search; the words come from the
   static facts, because the search knows how much and the
   static pass knows why.
   ============================================================ */

const C_ENG = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./engine.js') : null;
const CSQUARES = C_ENG ? C_ENG.SQUARES : SQUARES;

const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

/* ---------- opening names ----------
   The `book` grade only ever meant "early, and nothing was dropped" — it knew
   no openings at all, so a player could not tell which one they were in or what
   to go and read about. These are the lines an improving player actually meets,
   keyed by the SAN that reaches them; longest match wins, so a variation names
   itself without repeating its parent.

   ponytail: a hand-kept list, not an ECO database. A full one is most of a
   megabyte and this page ships as a single offline file, so the deal is broad
   coverage of common play and silence everywhere else — a wrong name teaches a
   wrong thing, so anything not listed stays unnamed. Add lines as they turn up. */
const OPENINGS = {
  // 1.e4 e5
  'e4 e5': 'Open Game',
  'e4 e5 Nf3 Nc6 Bb5': 'Ruy López',
  'e4 e5 Nf3 Nc6 Bb5 a6': 'Ruy López, Morphy Defence',
  'e4 e5 Nf3 Nc6 Bc4': 'Italian Game',
  'e4 e5 Nf3 Nc6 Bc4 Bc5': 'Italian Game, Giuoco Piano',
  'e4 e5 Nf3 Nc6 Bc4 Nf6': 'Two Knights Defence',
  'e4 e5 Nf3 Nc6 d4': 'Scotch Game',
  'e4 e5 Nf3 Nc6 Nc3': 'Four Knights Game',
  'e4 e5 Nf3 Nf6': "Petrov's Defence",
  'e4 e5 Nf3 d6': 'Philidor Defence',
  'e4 e5 Nc3': 'Vienna Game',
  'e4 e5 f4': "King's Gambit",
  'e4 e5 Bc4': "Bishop's Opening",
  'e4 e5 d4': 'Centre Game',
  // 1.e4, everything else
  'e4 c5': 'Sicilian Defence',
  'e4 c5 Nf3 Nc6': 'Sicilian Defence, Old Sicilian',
  'e4 c5 Nf3 e6': 'Sicilian Defence, French Variation',
  'e4 c5 Nf3 d6': 'Sicilian Defence, Open',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6': 'Sicilian Defence, Najdorf Variation',
  'e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 Nc6': 'Sicilian Defence, Classical Variation',
  'e4 c5 c3': 'Sicilian Defence, Alapin Variation',
  'e4 c5 Nc3': 'Sicilian Defence, Closed',
  'e4 c5 d4': 'Sicilian Defence, Smith-Morra Gambit',
  'e4 e6': 'French Defence',
  'e4 e6 d4 d5 Nc3 Bb4': 'French Defence, Winawer Variation',
  'e4 e6 d4 d5 e5': 'French Defence, Advance Variation',
  'e4 e6 d4 d5 exd5': 'French Defence, Exchange Variation',
  'e4 c6': 'Caro-Kann Defence',
  'e4 c6 d4 d5 e5': 'Caro-Kann Defence, Advance Variation',
  'e4 c6 d4 d5 exd5': 'Caro-Kann Defence, Exchange Variation',
  'e4 d5': 'Scandinavian Defence',
  'e4 d6': 'Pirc Defence',
  'e4 g6': 'Modern Defence',
  'e4 Nf6': "Alekhine's Defence",
  'e4 Nc6': 'Nimzowitsch Defence',
  'e4 b6': "Owen's Defence",
  'e4 d5 exd5 Qxd5': 'Scandinavian Defence, Main Line',
  // 1.d4
  'd4 d5': 'Closed Game',
  'd4 d5 c4': "Queen's Gambit",
  'd4 d5 c4 dxc4': "Queen's Gambit Accepted",
  'd4 d5 c4 e6': "Queen's Gambit Declined",
  'd4 d5 c4 c6': 'Slav Defence',
  'd4 d5 Bf4': 'London System',
  'd4 d5 Nf3 Nf6 Bf4': 'London System',
  'd4 Nf6': 'Indian Defence',
  'd4 Nf6 Bf4': 'London System',
  'd4 Nf6 c4 e6 Nc3 Bb4': 'Nimzo-Indian Defence',
  'd4 Nf6 c4 e6 Nf3 b6': "Queen's Indian Defence",
  'd4 Nf6 c4 g6 Nc3 Bg7': "King's Indian Defence",
  'd4 Nf6 c4 g6 Nc3 d5': 'Grünfeld Defence',
  'd4 Nf6 c4 c5': 'Benoni Defence',
  'd4 Nf6 c4 e5': 'Budapest Gambit',
  'd4 f5': 'Dutch Defence',
  'd4 b6': 'English Defence',
  'd4 e6': 'Horwitz Defence',
  'd4 g6': 'Modern Defence',
  // flank openings
  'c4': 'English Opening',
  'Nf3': 'Réti Opening',
  'f4': "Bird's Opening",
  'b3': "Larsen's Opening",
  'g3': "King's Fianchetto Opening",
  'b4': 'Polish Opening',
  'Nc3': 'Dunst Opening'
};

// The deepest key there is, so the lookup never probes past the table.
const OPENING_MAX = Math.max.apply(null, Object.keys(OPENINGS).map(k => k.split(' ').length));

// The most specific opening name reached by a list of SAN moves, or null.
function openingOf(sans) {
  for (let n = Math.min(sans.length, OPENING_MAX); n > 0; n--) {
    const hit = OPENINGS[sans.slice(0, n).join(' ')];
    if (hit) return hit;
  }
  return null;
}

/* Grades, worst to best. `swing` is how much worse the move played was
   than the best the search found, in centipawns. */
const GRADES = {
  book:       { label: 'Book',       tone: 'info'     },
  best:       { label: 'Best',       tone: 'good'     },
  strong:     { label: 'Strong',     tone: 'good'     },
  solid:      { label: 'Solid',      tone: 'good'     },
  missed:     { label: 'Missed it',  tone: 'warning'  },
  inaccuracy: { label: 'Inaccuracy', tone: 'warning'  },
  mistake:    { label: 'Mistake',    tone: 'warning'  },
  blunder:    { label: 'Blunder',    tone: 'critical' }
};

function gradeFor(ply, opts = {}) {
  const swing = ply.swing;                 // centipawns worse than best
  const isBest = ply.searchBest && ply.searchBest === ply.san;

  // Mate ends the game, so it outranks every heuristic below — including
  // the opening rule, which would otherwise grade a move-3 checkmate "Book".
  if (ply.mateDelivered) return 'best';

  // Opening moves that cost nothing: say so rather than pretending
  // a material engine has an opinion about them.
  if (ply.ply < 10 && (swing == null || swing < 50) && !ply.captured) return 'book';

  if (swing == null) return ply.loss >= 300 ? 'blunder' : ply.loss >= 200 ? 'mistake'
    : ply.loss >= 100 ? 'inaccuracy' : 'solid';

  if (swing >= 300) return 'blunder';
  if (swing >= 150) return 'mistake';
  if (swing >= 70) return ply.missedTactic ? 'missed' : 'inaccuracy';
  if (isBest) return 'best';
  if (swing <= 20) return 'strong';
  return 'solid';
}

/* ------------------------------------------------------------
   The sentence. Each branch is driven by a fact the analysis
   established, and the most important fact wins.
   ------------------------------------------------------------ */
function commentFor(ply, ctx = {}) {
  const you = ply.isHero;
  const S = you ? 'You' : 'They';
  const s = you ? 'you' : 'they';
  const your = you ? 'your' : 'their';
  const Your = you ? 'Your' : 'Their';
  const m = ply.motifs || {};
  const pick = arr => arr[(ply.ply * 7 + ply.moveNumber) % arr.length];

  // --- mate, in either direction
  if (ply.mateDelivered) return `${S} finished it. Checkmate.`;
  if (ply.allowsMateIn1) {
    return you
      ? `This lets them mate next move. Before moving, check what their queen and rooks reach.`
      : `That allows mate in one — ${s} missed that your pieces already cover the mating square.`;
  }
  if (ply.missedMateIn1) {
    return you
      ? `There was mate in one here, and ${ply.bestSan ? ply.bestSan + ' was it' : 'it slipped past'}.`
      : `${S} had mate in one and played something else.`;
  }

  // --- Severity comes first. A move the search says costs real material
  //     must be explained as such: a comment praising a fork or a
  //     recapture on a move graded Blunder reads as a bug, because it is
  //     one. Only once the move is shown to be sound do the nice things
  //     about it get to lead.
  const costly = ply.swing != null && ply.swing >= 150;
  if (costly && !ply.tags.includes('hung_piece') && !ply.tags.includes('left_behind') &&
      !ply.tags.includes('missed_material') && !ply.tags.includes('bad_trade')) {
    const cost = (ply.swing / 100).toFixed(1);
    if (ply.refutation) {
      return ply.captured
        ? `${S} had to deal with that, but after this ${ply.refutation} is strong — about ${cost} pawns.`
        : `${ply.refutation} is the problem with this move — it costs about ${cost} pawns.`;
    }
    if (ply.bestSan && ply.bestSan !== ply.san) {
      return `${ply.bestSan} was clearly better here; this gives up around ${cost} pawns.`;
    }
    return `This costs about ${cost} pawns against the best reply.`;
  }

  // When the search rates the move sound, a loose piece is worth
  // mentioning but must not be phrased as if the move were bad.
  const sound = ply.swing != null && ply.swing < 70;
  if (sound && (ply.tags.includes('left_behind') || ply.tags.includes('hung_piece'))) {
    const l = ply.looseAfter[0];
    return l
      ? `Still the best try here, but keep an eye on the ${NAME[l.type]} on ${l.square} — nothing is defending it.`
      : `A sound move.`;
  }

  // --- the big material facts
  if (ply.tags.includes('unresolved_hang') && costly) {
    const l = ply.looseAfter[0];
    return `${Your} ${NAME[l.type]} on ${l.square} is still hanging, and this move does nothing about it.`;
  }
  if (ply.tags.includes('hung_piece')) {
    const l = ply.looseAfter[0];
    return pick([
      `${Your} ${NAME[l.type]} on ${l.square} can be taken for nothing there.`,
      `That square is covered — the ${NAME[l.type]} on ${l.square} is simply loose.`,
      `${S} put the ${NAME[l.type]} on ${l.square} where it can be taken for free.`
    ]);
  }
  if (ply.tags.includes('left_behind')) {
    const l = ply.looseAfter[0];
    return `${Your} ${NAME[l.type]} on ${l.square} was fine until this move, and now it is hanging.`;
  }
  if (ply.tags.includes('missed_material')) {
    const f = ply.freeBefore[0];
    return you
      ? `${f ? `Their ${NAME[f.type]} on ${f.square} was free` : 'There was free material here'} and ${s} left it there.`
      : `${S} left free material on the board — ${f ? `the ${NAME[f.type]} on ${f.square}` : 'something was hanging'}.`;
  }
  if (ply.tags.includes('bad_trade')) {
    return `Taking on ${ply.to} looks like a capture, but the recapture leaves ${s} down material.`;
  }

  // --- tactics created (only once the move is known not to be costly)
  if (m.fork && m.fork.safe && !costly) {
    const t = m.fork.targets.map(x => NAME[x.type]).slice(0, 3);
    return `Fork — the ${NAME[ply.piece]} on ${ply.to} hits ${t.join(' and ')} at once.`;
  }
  if (m.pins && m.pins.length && !costly) {
    const p = m.pins[0];
    return p.absolute
      ? `That pins the ${NAME[p.front.type]} on ${p.front.name} against the king — it cannot legally move.`
      : `That pins the ${NAME[p.front.type]} on ${p.front.name} to the ${NAME[p.back.type]} behind it.`;
  }
  if (m.skewers && m.skewers.length && !costly) {
    const k = m.skewers[0];
    return `A skewer: the ${NAME[k.front.type]} on ${k.front.name} has to move and the ${NAME[k.back.type]} behind it falls.`;
  }
  if (m.discovered && !costly) {
    return `Moving the ${NAME[ply.piece]} uncovers the ${NAME[m.discovered.piece]} on ${m.discovered.from}, which now hits ${m.discovered.targets.join(' and ')}.`;
  }

  // --- answering a check. Ranks under the material facts above, because
  //     a forced move that also hangs something still has to say so.
  if (ply.checkEvasion === 'king') {
    return ply.forced
      ? `Forced — the king had exactly one square to go to.`
      : `${S} had to move the king out of check.`;
  }
  if (ply.checkEvasion === 'capture') {
    const won = ply.tags.includes('punished') || ply.tags.includes('good_capture');
    return `${S} answered the check by taking the ${NAME[ply.captured]} that gave it` +
           (won ? `, and came out ahead.` : `.`);
  }
  if (ply.checkEvasion === 'block') {
    return ply.forced
      ? `The only legal move — the ${NAME[ply.piece]} on ${ply.to} was the one way to meet the check.`
      : `${S} blocked the check with the ${NAME[ply.piece]} on ${ply.to} — a reply to the check, not a free move.`;
  }

  // --- captures
  if (ply.captured) {
    if (ply.tags.includes('punished') && !costly) return `${S} took the free ${NAME[ply.captured]}. That is the habit worth keeping.`;
    if (ply.tags.includes('good_capture') && !costly) return `${S} came out ahead on that exchange.`;
    if (ply.recapture) return `A straight recapture, and the count stays level.`;
    return `An even trade — nothing won, nothing lost.`;
  }

  // --- a threat that wins nothing yet
  if (m.threats && m.threats.length === 1 && m.threats[0].reason === 'loose') {
    const t = m.threats[0];
    return `That attacks the ${NAME[t.type]} on ${t.name}, which has nothing defending it.`;
  }
  if (m.check) return `Check. ${S} force${you ? '' : 's'} a reply before anything else can happen.`;

  // --- quiet moves: describe what the move does, with no false authority
  if (ply.castled) return `Castled. King off the open centre, rook joining in.`;
  if (ply.earlyQueen) return `The queen comes out early. She gets chased by pieces that were developing anyway, so ${s} lose time while they gain it.`;
  if (ply.develops) return `${S} brought a new piece out — that is the right currency early on.`;
  if (ply.centerPawn) return `A central pawn push, taking space in the middle.`;
  if (ply.retreatToSafety) return `${S} moved the ${NAME[ply.piece]} off a square where it could be taken.`;
  if (ply.pawnNearKing) return `A pawn move in front of the king. It loosens the shelter, so it needs a reason.`;
  if (ply.missedTactic && you) {
    return `Playable, but there was more here — ${ply.bestSan ? ply.bestSan : 'a tactic'} was worth about ${(ply.swing / 100).toFixed(1)} pawns more.`;
  }
  if (ply.swing != null && ply.swing <= 20) return `Nothing hanging and nothing missed. A sound move.`;
  return `A quiet move. Nothing changes hands.`;
}

/* Extra facts the commentary needs that the material pass does not
   already compute. Cheap, all static. */
function describeMove(before, after, move, ply) {
  // `ply.ply` is the half-move index, used for "early" judgements
  const me = move.color;
  const backRank = me === 'w' ? '1' : '8';
  const out = {};

  out.castled = !!(move.flags & (C_ENG ? C_ENG.BITS.KSIDE_CASTLE : BITS.KSIDE_CASTLE)) ||
                !!(move.flags & (C_ENG ? C_ENG.BITS.QSIDE_CASTLE : BITS.QSIDE_CASTLE));

  // development: a piece leaving its own back rank for the first time
  out.develops = !out.castled && move.piece !== 'p' && move.piece !== 'k' &&
                 ply.from[1] === backRank && ply.to[1] !== backRank;

  out.earlyQueen = move.piece === 'q' && ply.from[1] === backRank &&
                   ply.to[1] !== backRank && (ply.ply != null && ply.ply < 12);

  out.centerPawn = move.piece === 'p' && ['d', 'e'].includes(ply.to[0]) &&
                   ['4', '5'].includes(ply.to[1]);

  // a pawn moving directly in front of its own king
  const kingSq = after.kings[me];
  if (move.piece === 'p' && kingSq !== -1) {
    const kf = 'abcdefgh'[kingSq & 15];
    const idx = 'abcdefgh'.indexOf(kf);
    const near = ['abcdefgh'[idx - 1], kf, 'abcdefgh'[idx + 1]].filter(Boolean);
    const castledFile = ['g', 'h', 'b', 'c'].includes('abcdefgh'[kingSq & 15]);
    out.pawnNearKing = castledFile && near.includes(ply.to[0]) && !out.centerPawn;
  }

  // moving a piece off a square where it was capturable
  const wasLoose = before.see(CSQUARES[ply.from], me === 'w' ? 'b' : 'w') > 0;
  const nowSafe = after.see(CSQUARES[ply.to], me === 'w' ? 'b' : 'w') <= 0;
  out.retreatToSafety = !move.captured && move.piece !== 'p' && wasLoose && nowSafe;

  // A move played in check answers the check; it is not a plan the player
  // chose. Every descriptor above is geometric and cannot see that, so a
  // forced block off the back rank reads as "brought a new piece out" —
  // praise for a move there was no choice about. Legal moves are the only
  // ones generated, so one of them means genuinely forced.
  if (before.inCheck()) {
    const checkers = before.attackersTo(before.kings[me], me === 'w' ? 'b' : 'w');
    // Taking the checker is the fact worth naming even when the king is
    // what takes it, so the capture test comes before the king test.
    out.checkEvasion = (move.captured && checkers.includes(move.to)) ? 'capture'
      : move.piece === 'k' ? 'king'
      : 'block';
    out.forced = before.generateMoves().length === 1;
    out.develops = false;
    out.earlyQueen = false;
    out.centerPawn = false;
    out.pawnNearKing = false;
    out.retreatToSafety = false;
  }

  return out;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { gradeFor, commentFor, describeMove, openingOf, OPENINGS, GRADES, NAME };
}
