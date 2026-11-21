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
     beats the second best by ≥ 15 points (only one move worked) and your move cost ≥ 20 points.
     On the win-probability scale that already rules out positions that were decided either way
     (+9 vs +5 is no lesson), which the old raw-centipawn rule over-produced.

  The puzzle starts one move earlier, so you see your opponent's move first. Short mates (≤ 5) get
  the full mating line; otherwise the line continues while your next move is also forced. Win
  probability uses Lichess' curve, `1 / (1 + e^(−0.00368208·cp))`. The engine is Stockfish 19
  lite, single-threaded WASM, in a Web Worker: no cross-origin isolation needed, so it runs on
  GitHub Pages and in the Android WebView. `npm run mine chesscom <user> 10` runs the same code in
  Node for tuning.
- **Daily mining** (`.github/workflows/mine.yml`, `scripts/mine-daily.ts`): every day at 01:30 UTC
  (07:00 IST) a GitHub Actions job runs the same miner in Node for every allowlisted user with a
  username in Settings. It scans blitz, rapid and classical games from the last 14 days that
  weren't scanned before, at most 30 per run, and saves the puzzles straight into prod
  (`convex/daily.ts`, internal functions called with the `CONVEX_DEPLOY_KEY` secret, a prod deploy
  key). Run it by hand from Actions → **Mine puzzles from new games** → Run workflow (you can set
  `max` and `days`). Locally: `npx tsx scripts/mine-daily.ts [--prod] [--max 30] [--days 14] [--dry-run]`.
  GitHub turns off scheduled workflows after 60 days without a commit; re-enable it from the
  Actions tab if that happens.
- **Automatic tags** (`lib/motifs.ts`): every puzzle is tagged from its position and solution:
  mate in 1 / 2 / 3+, back-rank mate, fork, taking a loose piece, sacrifice, promotion, quiet first
  move, long line, and the game phase. Puzzles mined from games played with under a tenth of the
  starting clock left also get `time-trouble`. Tags you add yourself are kept. After changing the
  rules, re-tag everything with `npx convex run [--prod] maintenance:retag` (repeat with the
  returned `cursor` until it is null).
- **Patterns**: recall per tag on reviews of puzzles you already knew (the weak spots float to the
  top, and each one links to those puzzles in the Library), where in your games the missed moves
  happen (phase, clock), and the puzzles you keep forgetting. After a clean solve, Practice shows
  your time next to the last clean solve.
- **Offline**: practice works with no connection, in the browser, the installed PWA and the Android
  app, and grades reach the server by themselves when the connection is back. The device keeps a
  copy of the library in IndexedDB (`src/lib/local/`): `sync.pull({since})` is a live query that
  returns only the puzzles changed since the device's cursor (every puzzle write sets `updatedAt`;
  deletions leave a `tombstones` row), so a grade on one device reaches the others as a single row.
  Grades go into an outbox and are sent in order (`practice.review` with a client-made `opId`, so a
  resend after a reload is applied once, scheduled from when the grade was given). Until the
  server's version of the card arrives, the outbox is laid over the local copy (`lib/offline.ts`), and
  the practice queue is built on the device with the server's old rules. Home's streak, heatmap and
  Patterns show the last copy while offline. Editing puzzles, adding them, scanning games and
  changing settings need a connection. A service worker (vite-plugin-pwa) caches the web app; fonts
  are bundled, so nothing loads from Google.
- **Manual puzzles**: paste one or more PGNs with a `[FEN]` header and the solution line. The side
  that plays the last move is the solver (`1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6` from a
  black-to-move FEN → you play White and Kg7 is played for you); a Switch button flips it. A bare
  FEN line followed by moves works too.
- **Anki import** (`scripts/import-anki.ts`, `lib/anki.ts`): reads every note type with a `PGN`
  field ("Chess 2.0", AnkiChess) from an Anki collection. Mistake cards made by AnkiChess keep
  their game info (your move, the best move, evals, game link). Each card's Anki review log is
  replayed through FSRS-7 into the `reviews` table; review cards keep Anki's own memory state and
  due date. Re-running skips puzzles already imported (it doesn't update their schedule).

      npx tsx scripts/import-anki.ts --prod --email you@example.com [--dry-run] [collection.anki2]

- **Access**: Google sign-in through Convex Auth, the same setup as Habitool and ebook-reader.
  Anyone can complete the Google step, but only emails on the `allowedEmails` table get a session;
  everyone else sees "That Google account isn't on the access list."

## What is deployed where

| Part | Where | Deployed by |
|---|---|---|
| Web app | GitHub Pages | automatic on push to `main` (`.github/workflows/pages.yml`) |
| Backend (`convex/`) | Convex project `chessfsrs` (team `atulpatildbz`), prod `quiet-eel-61`, dev `reliable-hyena-673` | by hand: `npx convex deploy` |
| Android APK | GitHub Actions artifact / release asset | on demand: Actions → Android APK → Run workflow, or push a `v*` tag |

The Pages and APK builds read the backend URL from the repository variable `CONVEX_URL`.

Deployment environment variables (each deployment has its own):

- `SITE_URL`: prod the Pages URL, dev `http://localhost:5173`. Google sends web sign-ins back here.
- `JWT_PRIVATE_KEY` / `JWKS`: from `node scripts/convex-keys.mjs [--prod]`.
- `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`: the OAuth client shared with Habitool (Google Cloud
  project "first"), copied without printing them:

      for k in AUTH_GOOGLE_ID AUTH_GOOGLE_SECRET; do npx convex env set --prod $k -- "$(cd ../Habitool && npx convex env get --prod $k)"; done

  That client's **Authorised redirect URIs** must list each deployment's callback:
  `https://quiet-eel-61.convex.site/api/auth/callback/google` (prod) and
  `https://reliable-hyena-673.convex.site/api/auth/callback/google` (dev).
- `ENABLE_PASSWORD_LOGIN=true`: dev only. Turns on email + password for `@chessfsrs.local` test
  accounts so the browser tests can sign in; the form appears only on the Vite dev server.

### Access

    npx convex run --prod allowlist:grant '{"email":"you@example.com"}'
    npx convex run --prod allowlist:list
    npx convex run --prod allowlist:revoke '{"email":"you@example.com"}'

Prod allows only `atulpatildbz@gmail.com`. Dev also allows `test@chessfsrs.local`, the browser
tests' password account.

## Android

The app is a Capacitor 8 wrapper around the same web build (`capacitor.config.ts`, `android/`).
Builds use relative asset paths (`BASE_PATH=./`), hash routing, and bundle the engine, so nothing
depends on the server. Google refuses sign-in inside a WebView, so the app opens Google in the system browser
(`@capacitor/browser`) with `redirectTo: chessfsrs://auth`; the intent filter in
`AndroidManifest.xml` brings that link back to the app, which finishes sign-in with the code
(`src/pages/SignIn.tsx`).

- Get an APK: Actions → **Android APK** → Run workflow, then download `chessfsrs-apk`. Install it
  on the phone (allow installs from unknown sources). It's debug-signed: fine for personal use.
- Locally (needs Android Studio / SDK): `npm run cap:android && npx cap open android`.
- Chrome on Android can also install the web app from the menu; it works offline once opened.

## Developing

    npm install
    npx convex dev        # keeps convex/ pushed to the dev deployment
    npm run dev           # http://localhost:5173

    npm test              # unit tests (PGN parsing, move judging, FSRS wrapper, mining rules)
    npm run typecheck     # app + convex/
    TEST_EMAIL=test@chessfsrs.local TEST_PASSWORD=… node tests/e2e/smoke.mjs out/   # needs dev server
    TEST_PASSWORD=… node tests/e2e/mobile.mjs out/                # Pixel 7, touch input
    BROWSER=webkit TEST_PASSWORD=… node tests/e2e/mobile.mjs out/ # iPhone 13 (Safari engine)
    # offline practice, on a production build (the service worker only runs there):
    VITE_TEST_LOGIN=1 npx vite build --outDir dist-test && npx vite preview --outDir dist-test --port 4173 &
    TEST_PASSWORD=… node tests/e2e/offline.mjs out/
    # speed: launch and tap-to-response times against budgets (fails when over), same build:
    TEST_PASSWORD=… node tests/e2e/perf.mjs all     # desktop, Pixel 7 at 4x slower CPU, iPhone 13
    # new versions reach tabs left open, never mid-puzzle (same build; serves its own copy):
    TEST_PASSWORD=… node tests/e2e/pwa-update.mjs
    # the same inside the Android app, plus cold starts (debug APK built with VITE_TEST_LOGIN=1 on
    # an emulator or phone over adb):
    TEST_PASSWORD=… node tests/e2e/perf-android.mjs
    npm run mine chesscom <username> 10 normal                    # mining in Node

Layout: `lib/` is shared by the app and Convex (puzzle model, FSRS, mining, game fetching, UCI
client); `convex/` is the backend; `src/` the React app (`pages/`, `components/Solver.tsx` is the
interactive board).

## Not yet

- Fitting FSRS parameters to your own review log (the log is already recorded).
