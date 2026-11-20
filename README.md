# chessfsrs

Anki, but only for chess puzzles. Puzzles come from your own chess.com and lichess games (the
moments where only one move worked and you played something else) or from PGNs you paste.
[FSRS](https://github.com/open-spaced-repetition/ts-fsrs) decides when each one comes back.

Live: https://atulpatildbz.github.io/chessfsrs

## How it works

- **Practice**: you play the solving side on a real board (chessground). Your opponent's moves are
  played for you. A wrong move shakes the board and counts as a miss; any checkmating move is
  accepted when the line ends in mate. Hint (H) marks the piece, a second press draws the arrow;
  Solution (S) plays the line out. Afterwards a grade is suggested from how it went (a miss or
  looking at the solution → Again, a hint → Hard, clean → Good, clean and quick → Easy) and you
  confirm it with Space or pick another with 1–4. Each button shows when the puzzle would return.
  U undoes the last grade.
- **Scheduling**: FSRS-7 via `ts-fsrs` 6 (`lib/fsrs.ts`), run inside the Convex `practice:review`
  mutation so the server owns the schedule; the client uses the same module only for the button
  previews. Learning steps (1 min, 10 min) bring a missed puzzle back in the same session. New
  puzzles per day and target recall are in Settings. Every review is logged with the card state
  before it (`reviews` table), which powers undo, stats and a future FSRS parameter fit.
- **Puzzles from games** (`lib/mining.ts`, runs in the browser): fetch recent games
  (`lib/games.ts`; chess.com public API and lichess API, both CORS-enabled), skip games scanned
  before, then
  1. a quick Stockfish pass over every position you moved from (lichess' own analysis is used
     when the game has it) flags moves that cost ≥ 12 points of win probability;
  2. each flagged move is checked with MultiPV 2 at depth. It becomes a puzzle when the best move
     beats the second best by ≥ 15 points (only one move worked), your move cost ≥ 20 points, you
     weren't still clearly winning afterwards, and the position wasn't lost anyway.

  The puzzle starts one move earlier, so you see your opponent's move first. Short mates (≤ 5) get
  the full mating line; otherwise the line continues while your next move is also forced. Win
  probability uses Lichess' curve, `1 / (1 + e^(−0.00368208·cp))`. The engine is Stockfish 19
  lite, single-threaded WASM, in a Web Worker: no cross-origin isolation needed, so it runs on
  GitHub Pages and in the Android WebView. `npm run mine chesscom <user> 10` runs the same code in
  Node for tuning.
- **Manual puzzles**: paste one or more PGNs with a `[FEN]` header and the solution line. The side
  that plays the last move is the solver (`1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6` from a
  black-to-move FEN → you play White and Kg7 is played for you); a Switch button flips it. A bare
  FEN line followed by moves works too.
- **Access**: Convex Auth with email + password. Only emails on the `allowedEmails` table can
  get a session.

## What is deployed where

| Part | Where | Deployed by |
|---|---|---|
| Web app | GitHub Pages | automatic on push to `main` (`.github/workflows/pages.yml`) |
| Backend (`convex/`) | Convex project `chessfsrs` (team `atulpatildbz`), prod `quiet-eel-61`, dev `reliable-hyena-673` | by hand: `npx convex deploy` |
| Android APK | GitHub Actions artifact / release asset | on demand: Actions → Android APK → Run workflow, or push a `v*` tag |

The Pages and APK builds read the backend URL from the repository variable `CONVEX_URL`.

Deployment environment variables (each deployment has its own): `SITE_URL` (prod: the Pages URL;
dev: `http://localhost:5173`), and `JWT_PRIVATE_KEY` / `JWKS` from
`node scripts/convex-keys.mjs [--prod]`.

### Access

    npx convex run --prod allowlist:grant '{"email":"you@example.com"}'
    npx convex run --prod allowlist:list
    npx convex run --prod allowlist:revoke '{"email":"you@example.com"}'

First visit: choose "Create account" with an allowlisted email. Forgot the password (there's no
email reset):

    npx convex run --prod auth:setPassword '{"email":"you@example.com","password":"new-password"}'

## Android

The app is a Capacitor 8 wrapper around the same web build (`capacitor.config.ts`, `android/`).
Builds use relative asset paths (`BASE_PATH=./`), hash routing, and bundle the engine, so nothing
depends on the server. Sign-in is email + password, so no OAuth deep links are needed.

- Get an APK: Actions → **Android APK** → Run workflow, then download `chessfsrs-apk`. Install it
  on the phone (allow installs from unknown sources). It's debug-signed: fine for personal use.
- Locally (needs Android Studio / SDK): `npm run cap:android && npx cap open android`.
- Until then, Chrome on Android can install the web app from the menu (it has a manifest).

## Developing

    npm install
    npx convex dev        # keeps convex/ pushed to the dev deployment
    npm run dev           # http://localhost:5173

    npm test              # unit tests (PGN parsing, move judging, FSRS wrapper, mining rules)
    npm run typecheck     # app + convex/
    TEST_EMAIL=… TEST_PASSWORD=… node tests/e2e/smoke.mjs out/   # browser flow, needs dev server
    npm run mine chesscom <username> 10 normal                    # mining in Node

Layout: `lib/` is shared by the app and Convex (puzzle model, FSRS, mining, game fetching, UCI
client); `convex/` is the backend; `src/` the React app (`pages/`, `components/Solver.tsx` is the
interactive board).

## Not yet

- Offline practice (Convex keeps no offline cache; the app needs a connection).
- Fitting FSRS parameters to your own review log (the log is already recorded).
- Google sign-in (needs a redirect URI added to the Google OAuth client).
