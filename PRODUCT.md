# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Primary — the improving beginner.** A player reviewing their own finished games, usually shortly after playing them. At this level the deciding errors are material: a piece left capturable, free material walked past, a capture counted wrong. The job is not "what was the engine's evaluation" but "which piece could be taken, and what did I think I was doing when I left it there."

**Secondary — a coach reviewing a student's games.** Confirmed as a real audience. The product has no sharing, export, or multi-account capability today, and no decision has been made about what coach-facing output should be. Future work must not assume one exists, and must not invent one without asking.

## Product Purpose

Blunder Desk reviews finished chess games and explains losses by cause rather than by centipawn loss, then tests the reasoning behind a move rather than only the move itself.

1. **Classifies each error by cause** — hung a piece, left one behind, missed free material, bad trade, allowed mate in one, missed mate in one.
2. **Captures the player's intention before revealing the verdict** ("I was protecting c2", "I was attacking g6", "I was giving check", "no idea"), checks that claim against the position, and names the reasoning error: phantom threat, counting error, target fixation, tunnel vision, wrong priority, empty threat.

Success is a falling hang rate and a rising punish rate across many games — the habit changing, not one game's score.

## Positioning

Two mechanisms a neighboring review tool could not truthfully copy without rebuilding around them:

- **Error taxonomy over evaluation.** Verdicts are facts about the position — attacker and defender counts, static exchange evaluation, motif detection — so each is explainable in one sentence to a beginner. "Your knight on f4 can be taken by the e5 pawn and nothing defends it", never "−3.2".
- **Intention verification.** The player states what they were trying to do, and the app grades the *reasoning*, not just the move. No mainstream review tool asks the player anything before showing the answer.

Supporting the first: a material-only alpha-beta search with quiescence decides *how bad* a move was; the static pass decides *what to say*. Where they disagree the search wins and the static claim is dropped, so the grade and the comment can never contradict each other.

## Operating Context

Review happens after the game, on whatever screen the player has — the review surface is used at desktop width and on a phone, and must work at both.

Three import paths, all built:

| Source | Mechanism |
| --- | --- |
| Lichess | Direct from the browser; the public API is CORS-enabled and needs no token |
| Chess.com | Requires `server/proxy.js` on :8787 — the Published-Data API sends no `Access-Control-Allow-Origin`, so no browser-only app can read it |
| Any site | Paste a PGN, or drop a `.pgn` file on the page |

**Both runtimes are first-class and must stay that way:**

- **Local** — `npm start` builds and serves on :5173; the optional proxy on :8787 enables chess.com. Live imports work. No persistence; state lasts until the page closes.
- **Published artifact** — outbound requests are blocked, so Lichess and the proxy are both unreachable and the paste box is the only import path. Storage is the artifact document store.

Every feature must degrade gracefully when outbound requests are blocked. Chess.com additionally enforces a descriptive `User-Agent` carrying a contact address (403 otherwise) and serial requests (429 otherwise); the proxy already handles both.

## Capabilities and Constraints

Built and working:

- Chess engine written from scratch, no chess.js — 0x88 board, legal move generation, SAN, FEN, static exchange evaluation. Verified by perft against published node counts.
- Material-only alpha-beta search with a quiescence pass. Default depth 3 plus quiescence, roughly 150ms per move, graded incrementally in the background so the page stays responsive.
- Motif detection: fork, pin (including absolute), skewer, discovered attack — each with a value floor, so a knight lined up against a pawn is not reported as a tactic.
- Grades: Book, Best, Strong, Solid, Missed it, Inaccuracy, Mistake, Blunder.
- Metrics: hang rate, punish rate, material dropped, material left, first big error, fast-and-wrong. Dropped and left measure material *at stake*, not material actually lost — hang a rook and survive and it still counts, because the habit is what is being measured.
- Three views: Review (board, scoresheet, verdict, intention capture), Games (import and list), Patterns (aggregate across games).
- Light and dark themes; `prefers-reduced-motion` honored on every animation.

Deliberate current limits — real, but **not** declared binding:

- The evaluation is material plus mate and makes no positional claim. Remarks about pawn structure, early queen sorties or king shelter are framed as principles, never as evaluations. A commercial engine will disagree on quiet positions, and should agree closely wherever material changes hands.
- Search depth finds two-move tactics reliably and deep combinations not at all.
- No accuracy percentage; habit metrics only.

The last two were explicitly **not** marked binding, so future work may revisit positional evaluation or an accuracy-style metric on their own merits rather than treating them as settled.

Undecided — record, do not invent:

- What a coach-facing artifact is (export, share link, printable summary). No decision made.
- Local persistence. In-memory today; `node:sqlite` or IndexedDB are candidates, unexplored.

## Brand Commitments

Name: **Blunder Desk**. The masthead currently reads "rating 240 · hang rate first" — the author's own rating used as a tagline, not a stated audience ceiling.

Voice, as written consistently through the UI and README: plain, specific, and unflattering without being discouraging. It names the piece and the square. It states what the tool cannot do rather than bluffing. It does not congratulate.

## Evidence on Hand

Real, in-repo, usable:

- **Perft verification** of the move generator — initial position depth 4 (197,281 nodes), Kiwipete depth 3 (97,862), positions 3–5. All pass; `npm run test:engine` reproduces.
- **Test suites** for engine, tactics and analysis, including intention-verdict and check-evasion cases.
- **A sample game** shipped in the page so the desk is never empty, clearly marked as example data.
- The author's own imported games as live working material.

No testimonials, usage numbers, customers, pricing, licensing or deployment claims exist. Future work must not fabricate any.

## Product Principles

1. **Name the cause, not the score.** Every verdict is a fact about the position a beginner can act on — which piece, which square, what takes it.
2. **Ask before you tell.** On a prompted move the analysis stays hidden until the player says what they intended. Hindsight must never write the answer. *(Binding.)*
3. **Measure the habit, not the luck.** Material at stake counts whether or not the opponent punished it.
4. **Never contradict yourself.** Where the search and the static pass disagree, the search wins and the weaker claim is dropped rather than printed beside it.
5. **One file, zero dependencies.** `dist/index.html` stays a single self-contained, openable page. This constrains fonts, storage, and any future Web Worker. *(Binding.)*

## Accessibility & Inclusion

No external standard was set as a product requirement. The incumbent code establishes a floor future work should not regress: semantic tab roles (`role="tablist"` / `tabpanel`), `aria-current` / `aria-selected` / `aria-pressed` state, visible `:focus-visible` rings, keyboard navigation of the move list, `prefers-reduced-motion` honored on every animation, and both light and dark themes.

Two open issues measured against that floor: `.eyebrow` labels are set at 10.5px (below an 11px legibility floor) and carry long uppercase runs in body text.
