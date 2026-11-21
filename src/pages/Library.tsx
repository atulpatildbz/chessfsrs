import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { Plus, Search } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { MiniBoard } from "../components/Board";
import { STATE_NAMES } from "../../lib/fsrs";
import { relative } from "../lib/time";

type Src = "manual" | "chesscom" | "lichess" | undefined;
type St = "new" | "learning" | "review" | "suspended" | undefined;
const SOURCES: [Src, string][] = [[undefined, "All"], ["chesscom", "chess.com"], ["lichess", "lichess"], ["manual", "Added by hand"]];
const STATES: [St, string][] = [[undefined, "Any state"], ["new", "New"], ["learning", "Learning"], ["review", "Known"], ["suspended", "Suspended"]];

export function Library({ initialSearch = "" }: { initialSearch?: string }) {
  const [source, setSource] = useState<Src>();
  const [state, setState] = useState<St>();
  const [search, setSearch] = useState(initialSearch);
  const { results, status, loadMore } = usePaginatedQuery(api.puzzles.list, { source, state, search: search || undefined }, { initialNumItems: 24 });

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-10 md:py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex w-full items-center justify-between gap-3 md:w-auto">
          <h1 className="font-serif text-3xl">Library</h1>
          <a className="btn btn-ghost !py-1.5 text-sm md:hidden" href="#/add"><Plus size={15} /> Add</a>
        </div>
        <label className="relative w-full sm:w-64">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sage" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search names, tags, notes" className="field !pl-9 text-sm" />
        </label>
      </div>
      {/* Phones: one swipeable row per filter. Wider: a single wrapping row. */}
      <div className="mt-3 space-y-1 md:mt-5 md:flex md:flex-wrap md:gap-2 md:space-y-0">
        <div className={CHIP_ROW}>
          {SOURCES.map(([v, l]) => <Chip key={l} on={source === v} onClick={() => setSource(v)}>{l}</Chip>)}
        </div>
        <span className="mx-1 hidden w-px self-stretch bg-line md:block" />
        <div className={CHIP_ROW}>
          {STATES.map(([v, l]) => <Chip key={l} on={state === v} onClick={() => setState(v)}>{l}</Chip>)}
        </div>
      </div>

      {status === "LoadingFirstPage" ? null : results.length === 0 ? (
        <div className="mt-16 max-w-md">
          <p className="text-sage">No puzzles match. Add some, or scan your games.</p>
          <div className="mt-4 flex gap-3"><a className="btn btn-primary" href="#/import">Scan my games</a><a className="btn btn-ghost" href="#/add">Add a puzzle</a></div>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((p) => (
            <a key={p._id} href={`#/puzzle/${p._id}`} className={`group block ${p.suspended ? "opacity-50" : ""}`}>
              <div className="transition-transform group-hover:scale-[1.02]">
                <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
              </div>
              <p className="mt-2 truncate text-sm">{p.game ? `vs ${p.solver === "w" ? p.game.black : p.game.white} · ${p.game.moveLabel}` : p.title ?? (p.tags.join(", ") || "Puzzle")}</p>
              <p className="text-xs text-sage">
                {p.suspended ? "Suspended" : p.state === 0 ? "New" : `${STATE_NAMES[p.state]} · due ${relative(p.dueAt)}`}
                {p.lapses ? ` · missed ${p.lapses}×` : ""}
              </p>
            </a>
          ))}
        </div>
      )}
      {status === "CanLoadMore" && <button className="btn btn-ghost mt-8" onClick={() => loadMore(24)}>Show more</button>}
    </div>
  );
}

// py-1 leaves room for the focus ring inside the scroller.
const CHIP_ROW = "no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-1 md:contents";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors md:py-1 ${on ? "bg-bone text-felt" : "bg-felt-2 text-sage hover:text-bone"}`}>{children}</button>
  );
}
