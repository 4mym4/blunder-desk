# Blunder Desk

A chess review tool built around one idea: at beginner level, the engine's
evaluation is the wrong teacher. What matters is *which piece can be taken*,
and *what you thought you were doing when you left it there*.

So this does two things nothing else does:

1. **Classifies errors by cause**, not by centipawn loss — hung piece, left
   one behind, missed free material, bad trade, allowed mate.
2. **Records your intention** for a move ("I was protecting c2", "I was
   attacking g6", "no idea") and then checks the claim against the position,
   naming the reasoning error: phantom threat, counting error, target
   fixation, tunnel vision.

## Run it

Needs Node 18 or newer. There are no dependencies to install.

```bash
npm start          # builds dist/index.html and serves it on :5173
```

Other scripts:

```bash
npm run build      # just build dist/index.html
npm test           # engine + analysis test suites
npm run proxy      # chess.com import proxy on :8787 (see below)
```

`dist/index.html` is fully self-contained — you can also just open the file.

## Importing games

| Source | How |
| --- | --- |
| **Lichess** | Built in. Type a username; `/api/games/user/{name}` is CORS-enabled and needs no token. |
| **Chess.com** | Needs the proxy. `npm run proxy`, then put `http://localhost:8787` in the Chess.com card. |
| **Anything** | Paste a PGN, or drop a `.pgn` file anywhere on the page. |

### Why chess.com needs a proxy

Chess.com's Published-Data API sends no `Access-Control-Allow-Origin` header,
so the browser blocks the response before your code sees it. No browser-only
app can read it — this is not something a different fetch call can fix. The
proxy calls chess.com from Node, where CORS does not apply, and re-serves the
result with the right header.

Chess.com enforces two rules that `server/proxy.js` already handles:

- Requests need a descriptive `User-Agent` with a contact address, or you get
  a `403`. **Set yours:** `CONTACT=you@example.com npm run proxy`
- Requests must be serial. Parallel ones get `429`, so the proxy walks the
  monthly archives one at a time with a short pause.

Note that running the built page from a `file://` URL will block the proxy
call too (opaque origin). Use `npm start` rather than opening the file when
you want live imports.

## Layout

```
src/engine.js        chess rules: 0x88 board, legal moves, SAN, FEN, SEE
src/tactics.js       alpha-beta search + fork/pin/skewer/discovery detection
src/commentary.js    grades and the one-line comment on every move
src/analysis.js      the error taxonomy and intention verification
src/app.tmpl.html    the UI; build.js inlines the modules into it
build.js             -> dist/index.html (single file, no deps)
server/static.js     zero-dep static server
server/proxy.js      zero-dep chess.com CORS proxy
test/                engine + tactics + analysis suites
```

`src/engine.js` and `src/analysis.js` are plain CommonJS and run in Node
directly, which is what makes them testable. `build.js` strips the
`module.exports` block and drops both into the page, where they share one
scope.

## The engine

Written from scratch — no chess.js. It is verified with **perft**, which
counts leaf nodes to a given depth and compares against published values.
This is the standard correctness test for a move generator: it catches
castling-through-check, en-passant pins, promotion and disambiguation bugs
that ordinary tests miss.

```
initial position   depth 4   197,281 nodes
Kiwipete           depth 3    97,862
position 3         depth 4    43,238
position 4         depth 3     9,467
position 5         depth 3    62,379
```

All pass. Run `npm run test:engine` to confirm.

## How a verdict is reached

Two layers, and they do different jobs.

**The search** (`src/tactics.js`) decides *how bad* a move was. It is a
material-only alpha-beta with a quiescence pass, so it never stops counting in
the middle of an exchange. It understands sacrifices, delayed tactics, and
moves that hang a piece in order to win more back two moves later — the things
pure static counting gets wrong.

**The static pass** (`src/analysis.js`) decides *what to say*. Attacker and
defender counts, static exchange evaluation, and motif detection give
explanations a beginner can act on: "your knight on f4 can be taken by the e5
pawn and nothing defends it" rather than "−3.2".

Where they disagree, the search wins. If it finds that taking a supposedly
free piece gains almost nothing, the static "missed free material" claim is
dropped rather than reported — otherwise the grade and the comment contradict
each other, which reads as a bug because it is one.

Motifs detected: fork, pin (including absolute), skewer, discovered attack.
These carry value floors — lining a knight up against a pawn is a coincidence,
not a tactic, and is not reported.

### What it will not do

The evaluation is material plus mate. It is deliberately **not positional**,
and the app never pretends otherwise:

- It will not judge pawn structure, space, or long-term king safety. Comments
  about those (a pawn pushed in front of a castled king, an early queen) are
  flagged as principles, never as evaluations.
- Default search depth is 3 ply plus quiescence, roughly 150ms a move. It
  finds two-move tactics reliably and deep combinations not at all.
- A commercial engine will therefore disagree with it on quiet positions.
  It should agree closely on anything where material changes hands.

Grades: Book, Best, Strong, Solid, Missed it, Inaccuracy, Mistake, Blunder —
set from how much worse the move played was than the best the search found.

The hang-rate metric still excludes `unresolved_hang` (a piece that was
already loose and stays loose), so one blunder is never charged twice.

## Metrics

| Name | Meaning |
| --- | --- |
| Hang rate | % of your moves that left a piece capturable at a profit |
| Punish rate | of the free pieces offered to you, the % you actually took |
| Material dropped | total pawns' worth you left capturable |
| Material left | total pawns' worth of free enemy material you walked past |
| First big error | move number of your first error worth 3+ pawns |
| Fast and wrong | of moves played under 4s, the % that lost material |

Dropped and left are *material at stake*, not material actually lost — if you
hang a rook and nobody takes it, it still counts. That is the point: the
habit is being measured, not the luck.

Clock-dependent numbers need `[%clk]` tags in the PGN. Lichess supplies them;
most pasted PGNs do not, and those tiles show `—`.

## Where to take it next

- **Rating-band severity.** The Lichess open database is queryable by rating.
  A move that drops a piece against 1800s is near-fatal; against 240s it is
  punished maybe a quarter of the time. Weighting severity by what your actual
  opponents do would make the advice much sharper than any engine's.
- **Spaced repetition.** Every blunder position is already a puzzle with a
  known answer. Store them with an FSRS schedule and re-serve them, with
  intervals keyed to the *error type* rather than the position.
- **Deeper search.** The grading loop is already incremental and yields to the
  browser, so raising the depth is a one-line change (`gradeInBackground`)
  traded against time. A Web Worker would let it go deeper without the UI
  noticing; `dist/index.html` is self-contained so a worker needs a blob URL.
- **Opening study from your own data.** You have the games; find what you
  actually face and lose to, instead of studying theory nobody plays at 240.
- **Storage.** Currently in-memory (the hosted artifact version uses its own
  document store). For local use, IndexedDB or a small SQLite file via
  `node:sqlite` would persist games and tags across sessions.
