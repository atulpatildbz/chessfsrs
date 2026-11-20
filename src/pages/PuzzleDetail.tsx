import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MiniBoard } from "../components/Board";
import { formatLine, sanLine } from "../../lib/puzzle";
import { GRADE_NAMES, retrievability, STATE_NAMES, type Grade } from "../../lib/fsrs";
import { figurine, formatEval, sideName } from "../lib/notation";
import { navigate } from "../lib/router";
import { relative } from "../lib/time";

export function PuzzleDetail({ id }: { id: string }) {
  const p = useQuery(api.puzzles.get, { id: id as Id<"puzzles"> });
  const update = useMutation(api.puzzles.update);
  const reset = useMutation(api.puzzles.reset);
  const remove = useMutation(api.puzzles.remove);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (p) { setNotes(p.notes ?? ""); setTags(p.tags.join(", ")); } }, [p?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (p === undefined) return null;
  if (p === null) return <div className="p-10 text-sage">Puzzle not found. <a className="text-brass" href="#/library">Back to library</a></div>;

  const r = retrievability(p.card, Date.now());
  const save = async () => {
    await update({ id: p._id, notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <button className="mb-6 flex items-center gap-1.5 text-sm text-sage hover:text-bone" onClick={() => history.length > 1 ? history.back() : navigate("/library")}><ArrowLeft size={16} /> Library</button>
      <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_1fr]">
        <div>
          <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn btn-primary" href={`#/practice?id=${p._id}`}><Play size={16} /> Try it</a>
            <button className="btn btn-quiet" onClick={() => update({ id: p._id, suspended: !p.suspended })}>{p.suspended ? <><Play size={16} /> Unsuspend</> : <><Pause size={16} /> Suspend</>}</button>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="font-serif text-2xl">{p.game ? `vs ${p.solver === "w" ? p.game.black : p.game.white}, ${p.game.moveLabel}` : p.title ?? `${sideName(p.solver)} to play`}</h1>
            <p className="mt-1 text-sm text-sage">
              {p.suspended ? "Suspended" : p.state === 0 ? "New, not practised yet" : `${STATE_NAMES[p.state]} · due ${relative(p.dueAt)}`}
              {r !== null && ` · ${Math.round(r * 100)}% chance you'd solve it now`}
            </p>
          </div>
          <details className="panel p-4 text-sm">
            <summary className="cursor-pointer text-sage">Solution</summary>
            <p className="figurine mt-3">{formatLine(p.fen, sanLine(p.fen, p.moves).map(figurine))}</p>
            {p.game && (
              <p className="mt-2 text-sage">You played <span className="figurine text-claret">{figurine(p.game.playedSan)}</span> ({formatEval(p.game.evalPlayed)}); best was <span className="figurine text-moss">{figurine(p.game.bestSan)}</span> ({formatEval(p.game.evalBest, p.game.mate)}).</p>
            )}
          </details>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-sage" htmlFor="notes">Notes</label>
            <textarea id="notes" className="field min-h-24 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What's the idea? What did you miss?" />
            <label className="mt-2 text-sm text-sage" htmlFor="tags">Tags</label>
            <input id="tags" className="field text-sm" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fork, back rank" />
            <div className="mt-1 flex items-center gap-3">
              <button className="btn btn-quiet" onClick={save}>Save</button>
              {saved && <span className="text-sm text-moss">Saved</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {p.game?.url && <a className="inline-flex items-center gap-1 text-brass hover:underline" href={p.game.url} target="_blank" rel="noreferrer">Open game <ExternalLink size={13} /></a>}
            <a className="inline-flex items-center gap-1 text-brass hover:underline" href={`https://lichess.org/analysis/${p.fen.replace(/ /g, "_")}`} target="_blank" rel="noreferrer">Analyse on Lichess <ExternalLink size={13} /></a>
          </div>
          {p.history.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm text-sage">History</h2>
              <ul className="space-y-1 text-sm">
                {p.history.slice(0, 12).map((h, i) => (
                  <li key={i} className="flex gap-3"><span className="w-28 text-sage">{new Date(h.reviewedAt).toLocaleDateString()}</span><span className={h.grade === 1 ? "text-claret" : ""}>{GRADE_NAMES[h.grade as Grade]}</span><span className="text-sage">{Math.round(h.durationMs / 1000)}s</span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line/60 pt-5">
            <button className="btn btn-ghost text-sm" onClick={() => { if (confirm("Forget all progress on this puzzle? It becomes new again.")) void reset({ id: p._id }); }}><RotateCcw size={15} /> Reset progress</button>
            <button className="btn btn-ghost text-sm text-claret" onClick={async () => { if (confirm("Delete this puzzle?")) { await remove({ id: p._id }); navigate("/library"); } }}><Trash2 size={15} /> Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}
