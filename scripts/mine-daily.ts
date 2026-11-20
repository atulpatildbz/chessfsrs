// Daily: find new games of everyone with a chess.com / lichess username in Settings, mine them with
// Stockfish, and save the puzzles. Runs in GitHub Actions (.github/workflows/mine.yml) with
// CONVEX_DEPLOY_KEY set to a prod deploy key; locally:
//   npx tsx scripts/mine-daily.ts [--prod] [--max 30] [--days 14] [--strength normal] [--dry-run]
import { execFileSync } from "node:child_process";
import { fetchChesscomGames, fetchLichessGames, type GameRecord, type Site, type TimeClass } from "../lib/games";
import { minePuzzles, toPuzzleInput, type Strength } from "../lib/mining";
import { nodeEngine } from "./node-engine";

const args = process.argv.slice(2);
const opt = (name: string, def: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const int = (name: string, def: string) => {
  const n = Number(opt(name, def));
  if (!Number.isInteger(n) || n < 1 || n > 300) throw new Error(`${name} must be a whole number from 1 to 300`);
  return n;
};
const max = int("--max", "30");
const days = int("--days", "14");
const strength = opt("--strength", "normal") as Strength;
if (!["fast", "normal", "deep"].includes(strength)) throw new Error("--strength must be fast, normal or deep");
const dryRun = args.includes("--dry-run");
// Same defaults as the in-app scan: bullet games are mostly about the clock.
const timeClasses: TimeClass[] = ["blitz", "rapid", "classical"];

function convex(fn: string, payload: unknown) {
  const out = execFileSync("npx", ["convex", "run", ...(args.includes("--prod") ? ["--prod"] : []), fn, JSON.stringify(payload)], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out.slice(out.search(/[[{]/)));
}

type Target = { userId: string; chesscom: string | null; lichess: string | null; analyzed: string[] };
const since = Date.now() - days * 86_400_000;
const targets: Target[] = convex("daily:targets", { since });
console.log(`${targets.length} user(s) with usernames set`);
const engine = nodeEngine();
let failures = 0;
try {
  for (const t of targets) {
    const seen = new Set(t.analyzed);
    for (const [site, username] of [["chesscom", t.chesscom], ["lichess", t.lichess]] as [Site, string | null][]) {
      if (!username) continue;
      let games: GameRecord[] = [];
      try {
        const opts = { max, timeClasses, since, skip: (id: string) => seen.has(`${site}:${id}`) };
        games = site === "chesscom" ? await fetchChesscomGames(username, opts) : await fetchLichessGames(username, opts);
      } catch (e) {
        console.error(`  ${site} ${username}: ${(e as Error).message}`);
        failures++;
        continue;
      }
      console.log(`${site} ${username}: ${games.length} new game(s) in the last ${days} days`);
      // Save every few games, so a crash or timeout keeps what was done.
      let batch: { site: Site; gameId: string; puzzles: ReturnType<typeof toPuzzleInput>[] }[] = [];
      let added = 0, found = 0;
      const flush = () => {
        const games = batch;
        batch = [];
        if (!games.length || dryRun) return;
        try {
          added += convex("daily:save", { userId: t.userId, games }).added;
        } catch (e) {
          // Not marked as scanned, so tomorrow's run tries these games again.
          console.error(`  saving ${games.length} game(s) failed: ${(e as Error).message.split("\n")[0]}`);
          failures++;
        }
      };
      for (const g of games) {
        const started = Date.now();
        try {
          const ps = await minePuzzles(g, engine, strength);
          found += ps.length;
          batch.push({ site, gameId: g.id, puzzles: ps.map(toPuzzleInput) });
          console.log(`  ${g.white} vs ${g.black} (${g.timeClass}): ${ps.length} puzzle(s) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
        } catch (e) {
          console.error(`  ${g.url}: ${(e as Error).message}`);
          failures++;
        }
        if (batch.length >= 5) flush();
      }
      flush();
      console.log(`  ${found} found, ${dryRun ? "not saved (dry run)" : `${added} new`}`);
    }
  }
} finally {
  engine.close();
}
process.exit(failures ? 1 : 0);
