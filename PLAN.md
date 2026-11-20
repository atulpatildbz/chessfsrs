# chessfsrs — build plan

Anki-style spaced repetition, but only for chess puzzles. Puzzles come from (a) manual PGN paste and
(b) automatic mining of the user's own chess.com / lichess games. Scheduling uses FSRS.

## Goals (in priority order)
1. Actually make the user a better player: solve-the-position practice, not flip-a-card. Puzzles
   from the user's own mistakes are the highest-value content.
2. Looks good, feels fast, works great on a phone (drag/tap moves, big board).
3. Web on GitHub Pages now; Android native app later (same codebase).

## Stack
| Concern | Choice | Why |
|---|---|---|
| UI | React 19 + TypeScript + Vite 8 + Tailwind 4 | Same as the user's other apps |
| Native Android | Capacitor 8 (web build wrapped in a WebView) | Used in Habitool already; one codebase |
| Backend | Convex (queries/mutations, reactive) | User's existing pattern |
| Auth | Convex Auth (`@convex-dev/auth@0.0.98`, v0 API like ebook-reader), **Password** provider + `allowedEmails` allowlist | Google OAuth needs a new redirect URI in Google Cloud Console that only the user can add; password works on web + Capacitor today with no deep links. Google can be added later. |
| Chess rules / PGN | `chess.js` 1.4 | Standard |
| Board | `@lichess-org/chessground` 10.x | Lichess' board: best touch UX, animations, premove-free |
| FSRS | `ts-fsrs` 6 (FSRS-7 model, `DefaultScheduler`) | Official open-spaced-repetition implementation |
| Engine | `stockfish` 19 npm, **lite single-threaded WASM** in a Web Worker | No COOP/COEP headers needed (GitHub Pages can't set them), ~1.8 MB, runs in Android WebView |
| Hosting | GitHub Pages via Actions, hash routing (no 404 rewrites needed) | |

## Data model (Convex)
- `authTables` + `allowedEmails {email, createdAt}` (CLI-managed allowlist, checked on session creation and every function).
- `settings {userId, chesscomUsername?, lichessUsername?, desiredRetention=0.9, newPerDay=20, boardTheme, pieceSet, sound}`.
- `puzzles {userId, fen, moves: string[] (UCI), solver: 'w'|'b', source: 'manual'|'chesscom'|'lichess', pgn, tags: string[], notes?, game?: {url, white, black, date, timeClass, playedSan, playedUci, evalBefore, evalBest, evalPlayed}, dedupeKey, suspended, createdAt, card: FsrsCard, dueAt, state}`
  - Every ply whose mover == `solver` is a user move; all other plies are auto-played.
  - `card` = ts-fsrs card serialized (dates → ms). `dueAt`/`state` duplicated at top level for indexes.
  - Indexes: `by_user_due [userId, suspended, dueAt]`, `by_user_key [userId, dedupeKey]`, `by_user_created`.
- `reviews {userId, puzzleId, rating, reviewedAt, durationMs, mistakes, hintsUsed, revealed, stateBefore, scheduledDays}` (revlog; powers stats, heatmap, new-per-day limit, future FSRS parameter optimisation).
- `analyzedGames {userId, site, gameId, analyzedAt, puzzlesFound}` so re-scans are incremental.

FSRS scheduling runs **server-side** in the `review` mutation (shared `lib/fsrs.ts` imported by both
`convex/` and `src/`); the client uses the same module only to preview the interval on each grade button.

## Manual puzzle input
Accept one or many PGNs pasted at once, e.g.
```
[FEN "r2q1rk1/ppp2p2/3pnn2/2b1p3/4P2B/2NP4/PPP2PPP/R2Q1RK1 b - - 0 1"]
1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6 *
```
- Solver detection: **the solver is the side that plays the last move of the line** (puzzles end on
  the solver's move). Example: 6 plies, FEN black-to-move → Kg7 is the opponent's set-up move, solver = White.
  Overridable in the preview with a toggle.
- Without `[FEN]`, start from the initial position. Variations/comments are stripped (mainline only).
- Live board preview + validation errors before saving. Duplicates (same `dedupeKey` = FEN + line) skipped.

## Practice (the core loop)
- Queue = due learning/relearning cards, then due reviews (oldest first), interleaved with new cards up
  to `newPerDay` minus new cards already introduced today. Short learning steps (1m/10m) re-enter the same session;
  if only not-yet-due learning cards remain, show a countdown instead of ending.
- Board oriented to solver. Opponent's set-up move is animated after ~500 ms with last-move highlight.
- User move correct → green feedback, opponent reply auto-played. Wrong → red shake, take-back, mistake++.
  Any **checkmating** move is accepted when the expected move mates. Promotion chooser when needed.
- Hint (H): first press highlights the piece's square, second press shows the arrow. Show solution (S) plays it out.
- After the line: suggested grade, user confirms with 1–4 / buttons showing the next interval:
  - revealed solution or ≥1 mistake → **Again**; hint used → **Hard**; clean → **Good**; clean and fast
    (≤ ~5 s per user move) → **Easy**.
- Info after solving: full line in SAN, "In the game you played Bxa1 (eval drop)", link to the game and
  to Lichess analysis. Notes field.
- Sounds via WebAudio (move, capture, wrong, solved) — no asset licensing.

## Mining puzzles from games (client-side)
1. Fetch: chess.com public API (`/pub/player/{u}/games/archives` → newest months, `pgn`, `url`,
   `time_class`); lichess `GET /api/games/user/{u}?max=N&perfType=…&evals=true&pgnInJson=true`
   (NDJSON). Both send CORS headers. Skip games already in `analyzedGames`.
2. Pass 1 (cheap): eval every position (lichess `evals` when present, else Stockfish depth ~10).
   Candidate when the user's move drops their win probability by ≥ 12 points
   (`winProb(cp) = 1/(1+exp(-0.00368208·cp))`, mate = ±10000 cp).
3. Pass 2 (only candidates): MultiPV 2 at depth 14/18/22 (Fast/Normal/Deep). Keep when
   - only-move: `winProb(best) − winProb(second) ≥ 0.15` (positions with a single legal move are skipped),
   - user missed it: played ≠ best and `winProb(best) − winProb(played) ≥ 0.20`,
   - meaningful: not still clearly winning after the played move (`winProb(played) < 0.85`) and not
     hopeless after the best move (`winProb(best) ≥ 0.10`).
   This is a win-probability version of the existing `~/code/chess-mistakes-to-anki` logic (raw 150 cp gap),
   which over-produced puzzles in already-decided positions.
4. Line: start from the position **before the opponent's previous move** (gives context, Lichess-puzzle style),
   moves = `[opponentMove, best]`. Extend: if best is mate-in-≤5, append the full PV (any mating move accepted
   at each step). Otherwise, after the PV's opponent reply, check whether the user's next move is again an
   only-move (same test) and extend up to 3 user moves total.
5. Save in batches as they're found; progress UI (game i/N, positions), cancellable. Runs in a Worker so the
   UI stays smooth; screen wake lock while scanning.

## Screens
- **Home**: due count, new count, "Start practice" CTA, streak, 12-week review heatmap, retention (last 30 days),
  card state breakdown.
- **Practice**: as above, full-screen-ish board, minimal chrome on mobile.
- **Library**: grid of mini boards with filters (source, state, tag, suspended), search; open → detail
  (edit tags/notes/solver, suspend, delete, reset, practice this one).
- **Add**: PGN paste with preview.
- **Import from games**: usernames (prefilled from settings), sources, number of games, time classes, strength.
- **Settings**: usernames, desired retention, new/day, board theme, piece set, sound, sign out.

## Android readiness
- Relative asset paths in mobile builds (`BASE_PATH=./`), hash routing, no reliance on server rewrites.
- Engine files copied into `public/engine/` at build time — work offline inside the APK.
- Capacitor project (`com.atulpatildbz.chessfsrs`) + GitHub Action that builds a debug APK on demand.
- Safe-area insets, touch-first controls, no hover-only affordances.

## Testing
- Vitest unit tests: PGN parsing + solver detection, move checking (incl. mate alternatives, promotion),
  grade suggestion, FSRS wrapper round-trip (serialize ↔ deserialize), puzzle-detection thresholds
  (pure function over eval numbers), dedupe key.
- Headless browser smoke test of the built app (sign-in screen renders, practice flow with a seeded puzzle).

## Deployment
- New Convex project `chessfsrs` (dev + prod), env: `SITE_URL`, `JWT_PRIVATE_KEY`, `JWKS`.
- Allowlist the owner's email via CLI.
- GitHub repo `chessfsrs`, Pages from Actions, repo variable `CONVEX_URL`.

## Out of scope for v1
Offline review queue (Convex has no persistent offline cache), FSRS parameter optimisation from revlog,
Google sign-in, iOS.
