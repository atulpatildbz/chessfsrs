// Dev harness: mine puzzles from real games in Node with the same engine build the app uses.
//   npx tsx scripts/mine.ts chesscom <username> [games=3] [strength=normal]
import { createRequire } from "node:module";
import { fetchChesscomGames, fetchLichessGames } from "../lib/games";
import { minePuzzles, type Strength } from "../lib/mining";
import { UciEngine } from "../lib/uci";
import { formatLine, sanLine } from "../lib/puzzle";

const require = createRequire(import.meta.url);
const [site = "chesscom", user = "", n = "3", strength = "normal"] = process.argv.slice(2);
if (!user) throw new Error("usage: tsx scripts/mine.ts chesscom|lichess <username> [games] [strength]");

const listeners: ((l: string) => void)[] = [];
const realFetch = globalThis.fetch;
const sf = require("stockfish")("lite-single", (line: string) => listeners.forEach((f) => f(line)));
globalThis.fetch = realFetch;
const engine = new UciEngine({ send: (c) => sf.processCommand(c), onLine: (cb) => listeners.push(cb), close: () => sf.terminate?.() });

const opts = { max: Number(n), timeClasses: ["blitz", "rapid", "bullet", "classical"] as never };
const games = site === "lichess" ? await fetchLichessGames(user, opts) : await fetchChesscomGames(user, opts);
console.log(`${games.length} games`);
let total = 0;
for (const g of games) {
  const t = Date.now();
  const ps = await minePuzzles(g, engine, strength as Strength);
  console.log(`\n${g.url} (${g.timeClass}, user ${g.userColor}, evals: ${!!g.evals}) — ${ps.length} puzzles in ${((Date.now() - t) / 1000).toFixed(1)}s`);
  for (const p of ps) {
    console.log(`  ${p.moveLabel} (best ${p.bestSan}; ${p.evalBest} vs played ${p.evalPlayed}${p.mate ? `, mate ${p.mate}` : ""})`);
    console.log(`    ${p.fen}\n    ${formatLine(p.fen, sanLine(p.fen, p.moves))}`);
  }
  total += ps.length;
}
console.log(`\ntotal ${total}`);
engine.close();
process.exit(0);
