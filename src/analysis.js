/* ============================================================
   Analysis layer — a blunder taxonomy built from material logic
   rather than an engine evaluation. Every verdict here is a fact
   about the position (who attacks what, what a capture wins),
   so it is explainable in one sentence to a beginner.
   ============================================================ */

const TAC = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./tactics.js') : { findMotifs, searchBest, isMateScore, mateIn };
const COM = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./commentary.js') : { describeMove, gradeFor, commentFor };
const ENG = (typeof require !== 'undefined' && typeof module !== 'undefined')
  ? require('./engine.js') : null;
const Position = ENG ? ENG.Position : window.Position;
const SQUARES = ENG ? ENG.SQUARES : window.SQUARES;
const algebraic = ENG ? ENG.algebraic : window.algebraic;
const VALUE = ENG ? ENG.VALUE : window.VALUE;
const BITS = ENG ? ENG.BITS : window.BITS;
const clockToSeconds = ENG ? ENG.clockToSeconds : window.clockToSeconds;
const swapColor = ENG ? ENG.swap : window.swap;

const PIECE_NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

// How much material loss counts as what, in centipawns.
const THRESH = { INACCURACY: 100, MISTAKE: 200, BLUNDER: 300 };

const TAGS = {
  hung_piece:      { label: 'Hung a piece',       tone: 'critical' },
  left_behind:     { label: 'Left one behind',    tone: 'critical' },
  unresolved_hang: { label: 'Still loose',        tone: 'warning'  },
  missed_material: { label: 'Missed free material', tone: 'warning' },
  bad_trade:       { label: 'Bad trade',          tone: 'warning'  },
  allowed_mate:    { label: 'Allowed mate in 1',  tone: 'critical' },
  missed_mate:     { label: 'Missed mate in 1',   tone: 'warning'  },
  panic_move:      { label: 'Played fast',        tone: 'info'     },
  good_capture:    { label: 'Won material',       tone: 'good'     },
  punished:        { label: 'Punished a hang',    tone: 'good'     }
};

/* What the best move is actually for, in the only terms this engine can
   back: material and mate. The evaluation makes no positional claim, so
   neither does this sentence — it replays the line and reports what changed
   hands, which is a fact about the position rather than an opinion. */
function explainBest(fenBefore, line) {
  const out = { firstCapture: null, mateIn: null, netPawns: 0, why: '', played: [] };
  let pos;
  try { pos = new Position(fenBefore); } catch (e) { out.why = 'No line to show here.'; return out; }
  const mover = pos.turn;
  const before = pos.materialCount();

  const moves = Array.isArray(line) ? line : [];
  for (const san of moves) {
    const mv = pos.moveFromSan(san);
    if (!mv) break;                               // a line we cannot replay stops here
    if (mv.captured && !out.firstCapture) {
      out.firstCapture = {
        piece: PIECE_NAME[mv.captured] || 'piece',
        square: algebraic(mv.to),
        byYou: pos.turn === mover
      };
    }
    pos.makeMove(mv);
    out.played.push(san);
    if (pos.isCheckmate()) { out.mateIn = Math.ceil(out.played.length / 2); break; }
  }

  const after = pos.materialCount();
  const them = mover === 'w' ? 'b' : 'w';
  out.netPawns = +(((after[mover] - after[them]) - (before[mover] - before[them])) / 100).toFixed(2);

  if (out.mateIn != null) {
    out.why = out.mateIn === 1 ? 'It is mate on the spot.' : `It forces mate in ${out.mateIn}.`;
  } else if (out.firstCapture && out.firstCapture.byYou) {
    const c = out.firstCapture;
    out.why = out.netPawns >= 0.5
      ? `It takes the ${c.piece} on ${c.square}, and the ${c.piece} is not coming back — about ${fmtPawns(out.netPawns)} by the end of the line.`
      : `It takes the ${c.piece} on ${c.square}, though the recapture evens the count again.`;
  } else if (out.netPawns >= 0.5) {
    out.why = `It comes out about ${fmtPawns(out.netPawns)} ahead by the end of the line.`;
  } else if (out.netPawns <= -0.5) {
    out.why = `It still loses about ${fmtPawns(-out.netPawns)} — it is the least costly move here, not a good one.`;
  } else if (out.played.length) {
    out.why = 'It keeps the material count level, which is the most that was available here.';
  } else {
    out.why = 'No line to show here.';
  }
  return out;
}

function fmtPawns(n) {
  const v = Math.abs(n);
  return v === 1 ? '1 pawn' : `${(+v.toFixed(1))} pawns`;
}

function severityFor(cp) {
  if (cp >= THRESH.BLUNDER) return 'blunder';
  if (cp >= THRESH.MISTAKE) return 'mistake';
  if (cp >= THRESH.INACCURACY) return 'inaccuracy';
  return 'minor';
}

/* ------------------------------------------------------------
   Analyse one game. Returns a per-ply annotation list plus
   aggregate counters for the hero (the player we are coaching).
   ------------------------------------------------------------ */
function analyzeGame(game, heroColor) {
  const pos = new Position();
  const plies = [];
  let prevClock = { w: null, b: null };

  for (let i = 0; i < game.moves.length; i++) {
    const token = game.moves[i];
    const mover = pos.turn;
    const isHero = mover === heroColor;
    const fenBefore = pos.fen();

    // --- what was available before the move was played ---
    const before = {
      // opponent pieces this player could have taken for free
      freeMaterial: pos.hangingFor(swapColor(mover)).sort((a, b) => b.gain - a.gain),
      // this player's own pieces already loose before moving
      ownLoose: pos.hangingFor(mover).sort((a, b) => b.gain - a.gain),
      mate: pos.mateInOne(),
      inCheck: pos.inCheck()
    };

    const played = pos.moveSan(token.san);
    if (!played) {
      return { error: `Could not play move ${i + 1}: ${token.san}`, plies, headers: game.headers };
    }
    const move = played.move;

    // --- what the move left behind ---
    const ownLooseAfter = pos.hangingFor(mover).sort((a, b) => b.gain - a.gain);
    const oppMate = pos.mateInOne();            // opponent to move now
    const worstAfter = ownLooseAfter[0] ? ownLooseAfter[0].gain : 0;
    const looseBeforeNames = new Set(before.ownLoose.map(p => p.name));

    const tags = [];
    let loss = 0;
    let headline = null;

    if (isHero) {
      const pre = new Position(fenBefore);
      const destName = algebraic(move.to);
      // What the move actually won, netting out the recapture sequence.
      const exchange = move.captured ? pre.see(move.to, mover) : 0;
      // Every distinct way this move could have cost material, scored
      // in centipawns. The largest one becomes the headline.
      const candidates = [];

      // 1a. a capture that loses material once they recapture
      if (move.captured && exchange <= -THRESH.INACCURACY) {
        candidates.push({
          kind: 'bad_trade', cp: -exchange,
          headline: `Taking on ${destName} wins ${PIECE_NAME[move.captured]} but loses more once they recapture.`
        });
      }

      // 1b. pieces of ours left capturable after the move.
      // A piece that captured on its destination square is already
      // covered by the exchange above — a clean trade is not a hang.
      for (const l of ownLooseAfter) {
        if (l.square === move.to && move.captured) continue;
        if (l.gain < THRESH.INACCURACY) continue;
        if (l.name === destName) {
          candidates.push({
            kind: 'hung_piece', cp: l.gain,
            headline: `You moved your ${PIECE_NAME[l.type]} to ${l.name} where it can be taken for free.`
          });
        } else if (!looseBeforeNames.has(l.name)) {
          candidates.push({
            kind: 'left_behind', cp: l.gain,
            headline: `Your ${PIECE_NAME[l.type]} on ${l.name} became loose after this move.`
          });
        } else {
          candidates.push({
            kind: 'unresolved_hang', cp: l.gain,
            headline: `Your ${PIECE_NAME[l.type]} on ${l.name} was already loose and still is.`
          });
        }
      }

      // 2. free material we walked past
      const best = before.freeMaterial[0];
      if (best && !before.inCheck) {
        const tookIt = move.captured && destName === best.name;
        const netMissed = best.gain - Math.max(0, exchange);
        if (!tookIt && netMissed >= THRESH.INACCURACY) {
          candidates.push({
            kind: 'missed_material', cp: netMissed,
            headline: `Their ${PIECE_NAME[best.type]} on ${best.name} was free and you left it there.`
          });
        } else if (tookIt) {
          tags.push('punished');
        }
      }
      if (move.captured && exchange >= THRESH.MISTAKE && !tags.includes('punished')) {
        tags.push('good_capture');
      }

      // 3. mate, in both directions
      if (before.mate && !pos.isCheckmate()) {
        candidates.push({ kind: 'missed_mate', cp: 1000, headline: `There was mate in one here.` });
      }
      if (oppMate) {
        candidates.push({ kind: 'allowed_mate', cp: 1000, headline: `This allows mate in one.` });
      }

      // settle on the worst thing that happened
      candidates.sort((a, b) => b.cp - a.cp);
      for (const c of candidates) if (!tags.includes(c.kind)) tags.push(c.kind);
      if (candidates.length) { loss = candidates[0].cp; headline = candidates[0].headline; }

      // 4. time spent
      const secs = clockToSeconds(token.clock);
      let spent = null;
      if (secs !== null && prevClock[mover] !== null) spent = prevClock[mover] - secs;
      if (spent !== null && spent >= 0 && spent < 4 && loss >= THRESH.MISTAKE) tags.push('panic_move');
      token.spent = spent;
    }

    const secsNow = clockToSeconds(token.clock);
    if (secsNow !== null) prevClock[mover] = secsNow;

    // Tactical facts: what this move created, for both players.
    const posBefore = new Position(fenBefore);
    const motifs = TAC.findMotifs(posBefore, pos, move, mover);
    const shape = COM.describeMove(posBefore, pos, move, {
      from: algebraic(move.from), to: algebraic(move.to), ply: i
    });

    plies.push({
      ply: i,
      moveNumber: Math.floor(i / 2) + 1,
      color: mover,
      san: played.san,
      from: algebraic(move.from),
      to: algebraic(move.to),
      piece: move.piece,
      captured: move.captured || null,
      motifs,
      ...shape,
      recapture: !!(move.captured && i > 0 && plies[i - 1] &&
                    plies[i - 1].to === algebraic(move.to)),
      mateDelivered: pos.isCheckmate(),
      allowsMateIn1: !!oppMate,
      missedMateIn1: !!(before.mate && !pos.isCheckmate()),
      // filled in later by the search pass
      swing: null, searchBest: null, bestSan: null, missedTactic: false,
      grade: null, comment: null,
      fenBefore,
      fenAfter: pos.fen(),
      isHero,
      tags,
      loss,
      severity: loss > 0 ? severityFor(loss) : null,
      headline,
      // for the danger overlay: hero pieces that can be taken in this position
      looseAfter: ownLooseAfter.map(p => ({ square: p.name, type: p.type, gain: p.gain })),
      freeBefore: before.freeMaterial.map(p => ({ square: p.name, type: p.type, gain: p.gain })),
      spent: token.spent ?? null,
      clock: token.clock || null
    });
  }

  return { headers: game.headers, plies, heroColor, stats: aggregate(plies, heroColor) };
}

/* ------------------------------------------------------------
   Aggregate counters — the numbers that actually move at
   beginner level, rather than an accuracy percentage.
   ------------------------------------------------------------ */
function aggregate(plies, heroColor) {
  const hero = plies.filter(p => p.isHero);
  const n = hero.length || 1;
  let hangs = 0, hangCp = 0, missed = 0, missedCp = 0, punished = 0, offered = 0;
  let badTrades = 0, allowedMates = 0, missedMates = 0, fast = 0, fastBlunders = 0;

  for (const p of hero) {
    if (p.tags.includes('hung_piece') || p.tags.includes('left_behind')) { hangs++; hangCp += p.loss; }
    if (p.tags.includes('missed_material')) { missed++; missedCp += p.loss; }
    if (p.tags.includes('punished')) punished++;
    if (p.freeBefore.length) offered++;
    if (p.tags.includes('bad_trade')) badTrades++;
    if (p.tags.includes('allowed_mate')) allowedMates++;
    if (p.tags.includes('missed_mate')) missedMates++;
    if (p.spent !== null && p.spent >= 0 && p.spent < 4) {
      fast++;
      if (p.loss >= THRESH.MISTAKE) fastBlunders++;
    }
  }

  return {
    heroMoves: hero.length,
    hangs,
    hangRate: +(hangs / n * 100).toFixed(1),
    hangCp,
    missed,
    missedCp,
    punished,
    offered,
    punishRate: offered ? +(punished / offered * 100).toFixed(0) : null,
    badTrades, allowedMates, missedMates,
    fast, fastBlunders,
    // the move number where things first went materially wrong
    collapseMove: (hero.find(p => p.loss >= THRESH.BLUNDER) || {}).moveNumber || null
  };
}

/* ------------------------------------------------------------
   The search pass. Runs over the plies one at a time so the
   caller can yield between them and keep the page responsive.
   One search per position scores every root move, which gives
   both the best move and the grade for the move played.
   ------------------------------------------------------------ */
// Swing at which naming the punishing reply is worth a second search.
const REFUTE_AT = 150;

/* Everything a finished search implies for a ply, with no searching of its
   own. Split out so the browser can run the search in a worker and still
   share this bookkeeping with the Node path below. */
function applyGrade(ply, best, score, playedScore, refutation) {
  ply.searchBest = best;
  ply.bestSan = best;
  if (playedScore != null && score != null) {
    ply.swing = Math.max(0, score - playedScore);
    // a tactic was missed when the best move wins material the
    // move played does not, rather than merely scoring higher
    ply.missedTactic = ply.swing >= 70 && best !== ply.san;
    ply.bestIsMate = TAC.isMateScore(score);
  }

  // The search outranks the static pass. If taking the "free" piece is
  // worth almost nothing more than what was played, it was not actually
  // free — it was defended, or taking it ran into a tactic. Drop the
  // claim rather than report a contradiction, and let the stats be
  // recomputed from the corrected tags.
  if (ply.swing != null && ply.swing < 70 && ply.tags.includes('missed_material')) {
    ply.tags = ply.tags.filter(t => t !== 'missed_material');
    ply.staticOverridden = true;
    if (!ply.tags.length) { ply.loss = 0; ply.severity = null; ply.headline = null; }
  }

  // For a move that actually costs something, name the reply that
  // punishes it — "Rxf3 is the problem" beats "this was inaccurate".
  if (refutation) ply.refutation = refutation;

  ply.grade = COM.gradeFor(ply);
  ply.comment = COM.commentFor(ply);
  return ply;
}

function gradePly(ply, depth = 3) {
  const res = TAC.searchBest(new Position(ply.fenBefore), depth);
  const played = res.scores[ply.san];
  const swing = (played != null && res.score != null) ? Math.max(0, res.score - played) : null;
  let refutation = null;
  if (swing != null && swing >= REFUTE_AT) {
    refutation = TAC.searchBest(new Position(ply.fenAfter), Math.max(2, depth - 1)).san || null;
  }
  return applyGrade(ply, res.san, res.score, played, refutation);
}

function gradeAll(plies, depth = 3, onProgress) {
  for (let i = 0; i < plies.length; i++) {
    gradePly(plies[i], depth);
    if (onProgress) onProgress(i + 1, plies.length);
  }
  return plies;
}

/* Re-derive a comment after the tags were corrected by the search. */
function recomment(ply) { ply.comment = COM.commentFor(ply); ply.grade = COM.gradeFor(ply); return ply; }

/* ------------------------------------------------------------
   Intention verification.
   The player says what they were trying to do; we check the
   claim against the position and name the reasoning error.
   ------------------------------------------------------------ */
function verifyIntention(ply, intention) {
  const before = new Position(ply.fenBefore);
  const after = new Position(ply.fenAfter);
  const me = ply.color;
  const them = swapColor(me);
  const target = intention.target;            // square name, e.g. "e5"
  const out = { verdict: null, label: '', detail: '', tone: 'info' };

  // The piece that captured on its own destination square is halfway
  // through a trade, not hanging — the recapture is the other half of an
  // exchange, and `bad_trade` is what judges whether it was worth it.
  // analyzeGame drops it from the blunder candidates for the same reason;
  // reading looseAfter raw here would call every recapture a hung piece.
  // looseAfter is sorted by gain, so the first survivor is the worst one.
  // ...and a piece that was already loose before the move was not left hanging
  // BY the move. analyzeGame draws this line for the move verdict — it tags the
  // ply "still loose" rather than "became loose" — but the intention check read
  // looseAfter raw and blamed the player's reasoning for a weakness they
  // inherited. Saving an attacked knight is not tunnel vision because a pawn
  // the knight never defended is still hanging afterwards.
  const alreadyLoose = new Set(before.hangingFor(me).map(p => p.name));
  const hungSomething = ply.looseAfter.find(l =>
    !(l.square === ply.to && ply.captured) && !alreadyLoose.has(l.square)) || null;

  if (intention.kind === 'protect') {
    const sq = SQUARES[target];
    if (sq === undefined || !before.board[sq]) {
      out.verdict = 'unclear';
      out.label = 'Nothing there';
      out.detail = `There was no piece of yours on ${target} before this move.`;
      return out;
    }
    const wasAttacked = before.attackersTo(sq, them).length > 0;
    const wasLosing = before.see(sq, them) > 0;

    if (!wasAttacked) {
      out.verdict = 'phantom_threat';
      out.label = 'Phantom threat';
      out.tone = 'critical';
      out.detail = `Nothing was attacking ${target}. You spent a move defending a piece that was never in danger.`;
      return out;
    }
    if (!wasLosing) {
      out.verdict = 'over_protection';
      out.label = 'Already safe';
      out.tone = 'warning';
      // Naming the defenders is the whole point of this verdict. "Defended
      // well enough" on its own loses the argument to anyone who counted one
      // defender and stopped: the usual miss is a second one on a line that
      // opened earlier, and the recapture order it implies — take with the
      // cheapest defender, not the first one that comes to mind.
      const guards = before.attackersTo(sq, me)
        .map(s => `${PIECE_NAME[before.board[s].type]} on ${algebraic(s)}`);
      out.detail = `${cap(PIECE_NAME[before.board[sq].type])} on ${target} was attacked, but ${guards.length ? `${guards.join(' and ')} covered it` : 'taking it still cost them'} — so the capture would not have won them anything.`;
      return out;
    }
    // it genuinely was hanging. Did the move fix it?
    // `ply.from` and `ply.to` are already square names, not indices.
    const movedAway = ply.from === target;
    const dest = movedAway ? ply.to : target;
    const destSq = SQUARES[dest];
    const stillLosing = after.board[destSq] && after.board[destSq].color === me
      ? after.see(destSq, them) > 0 : false;

    if (stillLosing) {
      out.verdict = 'false_defense';
      out.label = 'Defence did not hold';
      out.tone = 'critical';
      out.detail = `${cap(PIECE_NAME[before.board[sq].type])} on ${dest} can still be taken for profit after this move.`;
      return out;
    }
    if (hungSomething && hungSomething.square !== dest) {
      out.verdict = 'tunnel_vision';
      out.label = 'Tunnel vision';
      out.tone = 'critical';
      out.detail = `You saved the piece on ${target}, but your ${PIECE_NAME[hungSomething.type]} on ${hungSomething.square} is now hanging. Your scan stopped at the threatened square.`;
      return out;
    }
    // was there a bigger problem elsewhere?
    const bigger = before.hangingFor(me).find(p => p.name !== target && p.gain > before.see(sq, them));
    if (bigger) {
      out.verdict = 'wrong_priority';
      out.label = 'Bigger fish';
      out.tone = 'warning';
      out.detail = `Correct that ${target} was hanging, but your ${PIECE_NAME[bigger.type]} on ${bigger.name} was worth more and also loose.`;
      return out;
    }
    out.verdict = 'sound';
    out.label = 'Sound defence';
    out.tone = 'good';
    out.detail = `${target} really was hanging and this move dealt with it.`;
    return out;
  }

  if (intention.kind === 'attack') {
    const sq = SQUARES[target];
    if (sq === undefined || !before.board[sq] || before.board[sq].color !== them) {
      out.verdict = 'unclear';
      out.label = 'No target';
      out.detail = `There was no enemy piece on ${target} before this move.`;
      return out;
    }
    const targetType = before.board[sq].type;
    const targetStillThere = after.board[sq] && after.board[sq].color === them;
    const gainIfTaken = targetStillThere ? after.see(sq, me) : 0;
    const nowAttacked = targetStillThere ? after.attackersTo(sq, me).length > 0 : false;
    const motifs = ply.motifs || {};

    // Leaving a pawn loose while attacking something is not tunnel vision;
    // it is often just a gambit. Reserve the verdict for a real piece.
    const hungPiece = hungSomething && hungSomething.gain >= 200 ? hungSomething : null;

    // Everything below describes a threat that still has to be carried out.
    // Mate, a check and a completed capture have each already resolved, so
    // they are answered first — otherwise the verdict talks about pressure
    // on a square whose question is settled.
    if (ply.mateDelivered) {
      out.verdict = 'mate';
      out.label = 'Checkmate';
      out.tone = 'good';
      out.detail = `This is mate. Whatever you were aiming at, the game ended right here.`;
      return out;
    }

    // A king can never actually be captured, so every material question
    // below is meaningless on it: SEE on a king square returns 0, which
    // would read as "taking it loses material". Naming the king means
    // "I was giving check", and that is what gets checked.
    if (targetType === 'k') {
      if (!motifs.check) {
        out.verdict = 'empty_threat';
        out.label = 'Not a check';
        out.tone = 'warning';
        out.detail = `This move does not give check — after it, nothing of yours attacks the king on ${target}.`;
        return out;
      }
      if (hungPiece) {
        out.verdict = 'target_fixation';
        out.label = 'Check, and it cost you';
        out.tone = 'critical';
        out.detail = `A real check, but your ${PIECE_NAME[hungPiece.type]} on ${hungPiece.square} is hanging. They answer the check and keep the piece.`;
        return out;
      }
      out.verdict = 'check';
      out.label = 'Check';
      out.tone = 'good';
      out.detail = `A real check — they have to deal with it before anything else. Worth remembering that a check is only worth the move if it wins something or improves your position; it is not a threat on its own.`;
      return out;
    }

    // The target is gone, which can only mean this move took it. "Is it
    // under pressure?" is the wrong question now — whether taking it was
    // a good idea is the right one.
    if (!targetStillThere) {
      const took = PIECE_NAME[targetType];
      if (hungPiece) {
        out.verdict = 'target_fixation';
        out.label = 'Target fixation';
        out.tone = 'critical';
        out.detail = `You took the ${took} on ${target}, but your ${PIECE_NAME[hungPiece.type]} on ${hungPiece.square} is hanging now. Count what the whole sequence costs, not just what you captured.`;
      } else if (ply.tags.includes('bad_trade')) {
        out.verdict = 'bad_capture';
        out.label = 'Lost the exchange';
        out.tone = 'critical';
        out.detail = `You took the ${took} on ${target}, but the recapture wins back more than you gained.`;
      } else if (ply.tags.includes('punished') || ply.tags.includes('good_capture')) {
        out.verdict = 'won_material';
        out.label = 'Won material';
        out.tone = 'good';
        out.detail = `You took the ${took} on ${target} and they cannot win it back.`;
      } else {
        out.verdict = 'traded';
        out.label = 'Traded off';
        out.tone = 'good';
        out.detail = `You took the ${took} on ${target}. An even trade rather than a win, but the plan was real.`;
      }
      return out;
    }

    // A piece can be attacked without being capturable yet. Check the
    // tactical motifs on this square BEFORE concluding there is no threat,
    // because a fork, a pin or a discovered attack is a real attack even
    // when nothing can be taken this move.
    const inFork = motifs.fork && motifs.fork.targets.some(t => t.name === target);
    const pinOn = (motifs.pins || []).find(p => p.front.name === target);
    const skewerOn = (motifs.skewers || []).find(k => k.front.name === target);
    const discoveredOn = motifs.discovered && motifs.discovered.targets.includes(target);

    if (hungPiece && !(inFork && motifs.fork.safe)) {
      out.verdict = 'target_fixation';
      out.label = 'Target fixation';
      out.tone = 'critical';
      out.detail = `You went after ${target} and left your ${PIECE_NAME[hungPiece.type]} on ${hungPiece.square} hanging. The attack cost more than it threatened.`;
      return out;
    }

    if (inFork) {
      const others = motifs.fork.targets.filter(t => t.name !== target);
      out.verdict = 'fork';
      out.label = 'Fork';
      out.tone = 'good';
      out.detail = `Better than you may have realised — the same move also hits ${others.map(o => PIECE_NAME[o.type] + ' on ' + o.name).join(' and ')}. They cannot save both.`;
      return out;
    }
    if (pinOn) {
      out.verdict = 'pin';
      out.label = pinOn.absolute ? 'Absolute pin' : 'Pin';
      out.tone = 'good';
      out.detail = pinOn.absolute
        ? `${cap(PIECE_NAME[pinOn.front.type])} on ${target} is pinned against the king — it cannot legally move, so you can build up against it.`
        : `${cap(PIECE_NAME[pinOn.front.type])} on ${target} is pinned to the ${PIECE_NAME[pinOn.back.type]} behind it. Moving it costs them the bigger piece.`;
      return out;
    }
    if (skewerOn) {
      out.verdict = 'skewer';
      out.label = 'Skewer';
      out.tone = 'good';
      out.detail = `${cap(PIECE_NAME[skewerOn.front.type])} on ${target} has to move, and the ${PIECE_NAME[skewerOn.back.type]} behind it is what you actually win.`;
      return out;
    }
    if (discoveredOn) {
      out.verdict = 'discovered';
      out.label = 'Discovered attack';
      out.tone = 'good';
      out.detail = `The attack on ${target} comes from the ${PIECE_NAME[motifs.discovered.piece]} on ${motifs.discovered.from}, uncovered by this move.`;
      return out;
    }

    if (nowAttacked && gainIfTaken <= 0) {
      out.verdict = 'counting_error';
      out.label = 'Counting error';
      out.tone = 'critical';
      const defenders = after.attackersTo(sq, them).length;
      out.detail = `${cap(PIECE_NAME[targetType])} on ${target} is defended ${defenders} time${defenders === 1 ? '' : 's'}. Taking it loses material.`;
      return out;
    }
    if (!nowAttacked) {
      out.verdict = 'empty_threat';
      out.label = 'No real threat';
      out.tone = 'warning';
      out.detail = `After this move nothing of yours actually attacks ${target}.`;
      return out;
    }
    // A pinned piece cannot step aside, so "they can just move it" is only
    // true when the piece is actually free to go somewhere safe.
    if (canEscape(after, sq, me)) {
      out.verdict = 'escapable';
      out.label = 'They can just move';
      out.tone = 'warning';
      out.detail = `${cap(PIECE_NAME[targetType])} on ${target} has a safe square to step to, so the threat costs them nothing.`;
      return out;
    }
    out.verdict = 'sound';
    out.label = 'Real threat';
    out.tone = 'good';
    out.detail = `${cap(PIECE_NAME[targetType])} on ${target} is under real pressure and has nowhere safe to go.`;
    return out;
  }

  if (intention.kind === 'free') {
    out.verdict = ply.loss >= THRESH.MISTAKE ? 'costly_free_move' : 'free_move';
    out.label = ply.loss >= THRESH.MISTAKE ? 'Guess that cost you' : 'Logged';
    out.tone = ply.loss >= THRESH.MISTAKE ? 'warning' : 'info';
    out.detail = ply.loss >= THRESH.MISTAKE
      ? `No plan here, and this one lost material. These are the positions to study.`
      : `No plan here, and it did no damage this time.`;
    return out;
  }

  if (intention.kind === 'develop' || intention.kind === 'king_safety' || intention.kind === 'trade') {
    out.verdict = hungSomething ? 'cost_material' : 'sound';
    out.label = hungSomething ? 'Right idea, loose piece' : 'Reasonable';
    out.tone = hungSomething ? 'warning' : 'good';
    out.detail = hungSomething
      ? `Sensible plan, but it left your ${PIECE_NAME[hungSomething.type]} on ${hungSomething.square} hanging.`
      : `Nothing hanging after this move.`;
    return out;
  }

  out.verdict = 'logged';
  out.label = 'Logged';
  out.detail = '';
  return out;
}

// can the piece on `sq` step somewhere it is not profitably capturable?
function canEscape(pos, sq, attacker) {
  const p = new Position(pos.fen());
  const owner = p.board[sq];
  if (!owner) return false;
  if (p.turn !== owner.color) {
    // flip the side to move so we can generate this piece's moves
    const parts = p.fen().split(' ');
    parts[1] = owner.color;
    parts[3] = '-';
    p.load(parts.join(' '));
  }
  const moves = p.generateMoves({ square: algebraic(sq) });
  for (const m of moves) {
    p.makeMove(m);
    const safe = p.see(m.to, attacker) <= 0;
    p.undoMove();
    if (safe) return true;
  }
  return false;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ------------------------------------------------------------
   Which moves should the app ask about?
   Mix bad moves with good and neutral ones, so answering is not
   itself a tell that the move was a mistake.
   ------------------------------------------------------------ */
function pickIntentionPrompts(plies, limit = 5) {
  const hero = plies.filter(p => p.isHero);
  const bad = hero.filter(p => p.loss >= THRESH.MISTAKE).sort((a, b) => b.loss - a.loss);
  const good = hero.filter(p => p.loss === 0 && (p.tags.includes('punished') || p.tags.includes('good_capture')));
  const neutral = hero.filter(p => p.loss === 0 && !p.tags.length);

  const picked = [];
  const take = (arr, k) => { for (const x of arr.slice(0, k)) if (!picked.includes(x)) picked.push(x); };
  take(bad, Math.min(3, limit));
  take(good, 1);
  // fill with neutral moves spread across the game
  const spread = neutral.filter((_, i) => i % Math.max(1, Math.floor(neutral.length / 3)) === 0);
  take(spread, limit - picked.length);
  take(neutral, limit - picked.length);
  return picked.slice(0, limit).sort((a, b) => a.ply - b.ply);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { analyzeGame, explainBest, verifyIntention, pickIntentionPrompts, aggregate, gradePly, gradeAll, applyGrade, REFUTE_AT, recomment, TAGS, THRESH, PIECE_NAME, severityFor };
}
