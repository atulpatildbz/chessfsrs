import { useEffect, useState } from "react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Pause, Play, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { MiniBoard } from "../components/Board";
import { formatLine, sanLine } from "../../lib/puzzle";
import { GRADE_NAMES, retrievability, STATE_NAMES, type Grade } from "../../lib/fsrs";
import { figurine, formatEval, moveOf, sideName } from "../lib/notation";
import { usePuzzles } from "../lib/local/store";
import { useOffline } from "../lib/local/sync";
import { navigate } from "../lib/router";
import { relative } from "../lib/time";

export function PuzzleDetail({ id }: { id: string }) {
  const p = usePuzzles().get(id);
  const { isAuthenticated } = useConvexAuth();
  const offline = useOffline();
  const canEdit = isAuthenticated && !offline;
  // The review log lives on the server; offline there's just the puzzle.
  const pid = id as Id<"puzzles">;
  const log = useQuery(api.puzzles.get, isAuthenticated ? { id: pid } : "skip")?.history ?? [];
  const update = useMutation(api.puzzles.update);
  const reset = useMutation(api.puzzles.reset);
  const remove = useMutation(api.puzzles.remove);
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (p) { setNotes(p.notes ?? ""); setTags(p.tags.join(", ")); } }, [p?._id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) return <div className="p-10 text-dim">Puzzle not found. <a className="link" href="#/library">Back to library</a></div>;

  const r = retrievability(p.card, Date.now());
  const save = async () => {
    await update({ id: pid, notes, tags: tags.split(",").map((t) => t.trim()).filter(Boolean) });
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <button className="mb-6 flex items-center gap-1.5 text-sm text-dim hover:text-boxwood" onClick={() => history.length > 1 ? history.back() : navigate("/library")}><ArrowLeft size={16} /> Library</button>
      <div className="grid gap-8 md:grid-cols-[minmax(0,380px)_1fr]">
        <div>
          <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
          <div className="mt-4 flex flex-wrap gap-2">
            <a className="btn btn-primary" href={`#/practice?id=${p._id}`}><Play size={16} /> Try it</a>
            <button className="btn btn-quiet" disabled={!canEdit} onClick={() => update({ id: pid, suspended: !p.suspended })}>{p.suspended ? <><Play size={16} /> Unsuspend</> : <><Pause size={16} /> Suspend</>}</button>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="break-words font-serif text-[1.9rem] leading-tight">{p.game ? <>vs {p.solver === "w" ? p.game.black : p.game.white}<span className="figurine mv-bad block text-[1.5rem]">{moveOf(p.game.moveLabel)}</span></> : p.title ?? `${sideName(p.solver)} to play`}</h1>
            <p className="mt-1 text-sm text-dim">
              {p.suspended ? "Suspended" : p.card.state === 0 ? "New, not practised yet" : `${STATE_NAMES[p.card.state]}, due ${relative(p.card.dueAt)}`}
              {r !== null && `. ${Math.round(r * 100)}% chance you'd solve it now`}
            </p>
          </div>
          <details className="border-y border-line py-3 text-sm">
            <summary className="cursor-pointer text-dim">Show the solution</summary>
            <p className="figurine prose-serif mt-3">{formatLine(p.fen, sanLine(p.fen, p.moves).map(figurine))}</p>
            {p.game && (
              <p className="prose-serif mt-2 text-dim">You played <span className="figurine mv-bad">{figurine(p.game.playedSan)}</span> ({formatEval(p.game.evalPlayed)}); the move was <span className="figurine mv-good">{figurine(p.game.bestSan)}</span> ({formatEval(p.game.evalBest, p.game.mate)}).</p>
            )}
          </details>
          <div className="flex flex-col gap-2">
            <label className="text-sm text-dim" htmlFor="notes">Notes</label>
            <textarea id="notes" className="field min-h-24 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What's the idea? What did you miss?" />
            <label className="mt-2 text-sm text-dim" htmlFor="tags">Tags</label>
            <input id="tags" className="field text-sm" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="fork, back rank" />
            <div className="mt-1 flex items-center gap-3">
              <button className="btn btn-quiet" onClick={save} disabled={!canEdit}>Save</button>
              {saved && <span className="text-sm text-good">Saved</span>}
              {!canEdit && <span className="text-sm text-dim">Editing needs a connection.</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {p.game?.url && <a className="link inline-flex items-center gap-1" href={p.game.url} target="_blank" rel="noreferrer">Open game <ExternalLink size={13} /></a>}
            <a className="link inline-flex items-center gap-1" href={`https://lichess.org/analysis/${p.fen.replace(/ /g, "_")}`} target="_blank" rel="noreferrer">Analyse on Lichess <ExternalLink size={13} /></a>
          </div>
          {log.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm text-dim">History</h2>
              <ul className="space-y-1 text-sm">
                {log.slice(0, 12).map((h, i) => (
                  <li key={i} className="flex gap-3"><span className="w-28 text-dim">{new Date(h.reviewedAt).toLocaleDateString()}</span><span className={h.grade === 1 ? "text-blunder" : ""}>{GRADE_NAMES[h.grade as Grade]}</span><span className="text-dim">{Math.round(h.durationMs / 1000)}s</span></li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-5">
            <button className="btn btn-ghost text-sm" disabled={!canEdit} onClick={() => { if (confirm("Forget all progress on this puzzle? It becomes new again.")) void reset({ id: pid }); }}><RotateCcw size={15} /> Reset progress</button>
            <button className="btn btn-ghost text-sm text-blunder" disabled={!canEdit} onClick={async () => { if (confirm("Delete this puzzle?")) { await remove({ id: pid }); navigate("/library"); } }}><Trash2 size={15} /> Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}
