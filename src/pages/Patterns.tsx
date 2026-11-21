import { api } from "../../convex/_generated/api";
import { MiniBoard } from "../components/Board";
import { MOTIFS, PHASES, TIME_TROUBLE } from "../../lib/motifs";
import { useCachedQuery } from "../lib/local/sync";

const LABELS: Record<string, string> = {
  "mate-in-1": "Mate in 1",
  "mate-in-2": "Mate in 2",
  "mate-in-3+": "Mate in 3 or more",
  "back-rank-mate": "Back-rank mate",
  fork: "Fork",
  "hanging-piece": "Taking a loose piece",
  sacrifice: "Sacrifice",
  promotion: "Promotion",
  "quiet-move": "Quiet first move (no check or capture)",
  "long-line": "Long line (3+ of your moves)",
  opening: "Opening",
  middlegame: "Middlegame",
  endgame: "Endgame",
  [TIME_TROUBLE]: "Played in time trouble",
  "source:games": "From your games",
  "source:manual": "Added by hand",
};
const KEYS = [...MOTIFS, ...PHASES, TIME_TROUBLE, "source:games", "source:manual"];
/** Below this many reviews a recall figure is mostly noise. */
const MIN_REVIEWS = 5;

const pct = (x: number) => `${Math.round(x * 100)}%`;
const secs = (ms: number | null) => (ms === null ? "" : `${Math.round(ms / 1000)} s`);

export function Patterns() {
  const d = useCachedQuery(api.stats.patterns, {}, "patterns");
  if (!d) return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-[2.1rem] leading-tight">Patterns</h1>
      <p className="prose-serif mt-3 max-w-2xl text-dim" role="status">{d === null ? "" : navigator.onLine ? "Adding up your reviews…" : "Patterns come from the server. Open this page once while online to keep a copy for offline use."}</p>
    </div>
  );

  const rows = KEYS.map((k) => d.groups.find((g) => g.key === k)).filter((g): g is NonNullable<typeof g> => !!g && g.puzzles > 0);
  const rated = rows.filter((g) => g.reviews >= MIN_REVIEWS).map((g) => ({ ...g, recall: 1 - g.misses / g.reviews }));
  const overall = d.recall;
  const motifRows = rated.filter((g) => !g.key.startsWith("source:")).sort((a, b) => a.recall - b.recall);
  const unrated = rows.filter((g) => g.reviews < MIN_REVIEWS && !g.key.startsWith("source:"));
  const sourceRows = rated.filter((g) => g.key.startsWith("source:"));

  const games = d.games;
  const phaseOrder = ["opening", "middlegame", "endgame"];
  const phases = phaseOrder.map((k) => ({ key: k, n: games.byPhase.find((x) => x.key === k)?.n ?? 0 }));
  const maxPhase = Math.max(1, ...phases.map((p) => p.n));

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-[2.1rem] leading-tight">Patterns</h1>
      <p className="prose-serif mt-3 max-w-2xl text-dim">
        Which kinds of puzzles you get wrong when they come back for review, from your last {d.reviews} reviews. Tags are worked out from each position and its solution.
      </p>

      <section className="mt-8">
        <h2 className="font-serif text-2xl">Hardest for you</h2>
        {motifRows.length === 0 ? (
          <p className="mt-3 text-sm text-dim">Not enough reviews yet. Each kind of puzzle needs {MIN_REVIEWS} reviews before its number means much.</p>
        ) : (
          <ul className="mt-4 divide-y divide-line/50">
            {motifRows.map((g) => (
              <li key={g.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 py-3 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)_auto]">
                <a className="min-w-0 truncate underline-offset-[3px] hover:underline md:whitespace-normal" href={`#/library?q=${encodeURIComponent(g.key)}`}>{LABELS[g.key] ?? g.key}</a>
                <span className={`text-right font-semibold tabular-nums md:order-3 ${overall !== null && g.recall < overall - 0.05 ? "text-blunder" : "text-ink"}`}>{pct(g.recall)}</span>
                <div className="col-span-2 md:order-2 md:col-span-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-paper-3">
                    <div className={`h-full ${overall !== null && g.recall < overall - 0.05 ? "bg-blunder" : "bg-good"}`} style={{ width: pct(g.recall) }} />
                  </div>
                  <p className="mt-1 text-xs text-dim">{g.puzzles} puzzle{g.puzzles === 1 ? "" : "s"}, {g.reviews} reviews{g.avgSolveMs !== null ? `, ${secs(g.avgSolveMs)} to solve` : ""}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {overall !== null && motifRows.length > 0 && <p className="mt-3 text-xs text-dim">Recall across all reviews: {pct(overall)}. Red means at least 5 points below that.</p>}
        {unrated.length > 0 && (
          <p className="mt-2 text-xs text-dim">Too few reviews yet: {unrated.map((g) => `${LABELS[g.key] ?? g.key} (${g.puzzles})`).join(", ")}.</p>
        )}
        {sourceRows.length === 2 && (
          <p className="mt-2 text-xs text-dim">{sourceRows.map((g) => `${LABELS[g.key]}: ${pct(g.recall)}`).join(", ")}</p>
        )}
      </section>

      {games.total > 0 && (
        <section className="offscreen-lazy mt-12">
          <h2 className="font-serif text-2xl">Where your games go wrong</h2>
          <p className="mt-1 text-sm text-dim">{games.total} missed moves found in your games.</p>
          <div className="mt-4 grid gap-6 md:grid-cols-2">
            <div className="border-t border-line pt-4">
              <p className="text-sm text-dim">By phase</p>
              <ul className="mt-3 space-y-2.5">
                {phases.map((p) => (
                  <li key={p.key} className="grid grid-cols-[100px_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
                    <span>{LABELS[p.key]}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-paper-3"><div className="h-full bg-[var(--sq-dark)]" style={{ width: `${(p.n / maxPhase) * 100}%` }} /></div>
                    <span className="text-right tabular-nums text-dim">{p.n}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="border-t border-line pt-4 text-sm">
              <p className="text-dim">Clock</p>
              <p className="mt-3"><span className="font-serif text-4xl">{pct(games.timeTrouble / games.total)}</span> <span className="text-dim">made in time trouble (under a tenth of your starting time)</span></p>
              {games.byTimeClass.filter((x) => x.key !== "unknown").length > 0 && (
                <p className="mt-3 text-dim">{games.byTimeClass.filter((x) => x.key !== "unknown").sort((a, b) => b.n - a.n).map((x) => `${x.key} ${x.n}`).join(", ")}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {d.leeches.length > 0 && (
        <section className="offscreen-lazy mt-12">
          <h2 className="font-serif text-2xl">Puzzles you keep missing</h2>
          <p className="mt-1 text-sm text-dim">Forgotten three times or more. Worth a slow look: write down what you miss in the puzzle's notes.</p>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {d.leeches.map((p) => (
              <a key={p._id} href={`#/puzzle/${p._id}`} className="block">
                <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
                <p className="mt-1.5 truncate text-sm">{p.label ?? `${p.solver === "w" ? "White" : "Black"} to play`}</p>
                <p className="text-xs text-dim">missed {p.lapses} times</p>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
