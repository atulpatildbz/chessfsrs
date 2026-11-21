import { useMemo, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { ArrowLeftRight, Check } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useOffline } from "../lib/local/sync";
import { MiniBoard } from "../components/Board";
import { parsePuzzle, splitPgns, formatLine, moverAt, type Color, type ParsedPuzzle } from "../../lib/puzzle";
import { figurine, sideName } from "../lib/notation";
import { navigate } from "../lib/router";

const EXAMPLE = `[Site "Chess.com"]
[SetUp "1"]
[FEN "r2q1rk1/ppp2p2/3pnn2/2b1p3/4P2B/2NP4/PPP2PPP/R2Q1RK1 b - - 0 1"]
1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6 *`;

export function AddPuzzles() {
  const [text, setText] = useState("");
  const [overrides, setOverrides] = useState<Record<number, Color>>({});
  const [tags, setTags] = useState("");
  const [result, setResult] = useState<{ added: number; duplicates: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useMutation(api.puzzles.add);
  const { isAuthenticated } = useConvexAuth();
  const offline = useOffline() || !isAuthenticated;

  const parsed = useMemo(() => splitPgns(text).map(parsePuzzle), [text]);
  const valid = parsed.flatMap((r, i) => (r.ok ? [{ ...r.puzzle, solver: overrides[i] ?? r.puzzle.solver, i }] : []));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const t = tags.split(",").map((s) => s.trim()).filter(Boolean);
      const site = (p: ParsedPuzzle) => (p.site?.toLowerCase().includes("lichess") ? "lichess" : p.site?.toLowerCase().includes("chess.com") ? "chesscom" : null);
      const r = await add({
        items: valid.map((p) => ({ fen: p.fen, moves: p.moves, solver: p.solver, source: "manual" as const, pgn: p.pgn, title: p.title, tags: [...t, ...(site(p) ? [site(p) === "lichess" ? "lichess" : "chess.com"] : [])] })),
      });
      setResult(r);
      setText("");
      setOverrides({});
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^.*ConvexError: /, "").split("\n")[0] : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-[2.1rem] leading-tight">Add puzzles</h1>
      <p className="prose-serif mt-3 max-w-xl text-dim">
        Paste one or more PGNs with a <code className="text-boxwood">[FEN]</code> header and the solution line. The side that plays the last move is the one you'll play; earlier moves by the other side are played for you.
      </p>

      <div className="mt-6 grid gap-8 md:grid-cols-[1fr_minmax(0,340px)]">
        <div className="flex flex-col gap-3">
          <textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} rows={12} spellCheck={false}
            placeholder={EXAMPLE} className="field scroll-thin min-h-56 font-[ui-monospace,monospace] text-sm leading-relaxed" aria-label="PGN" />
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Tags, comma separated (optional): fork, endgame" className="field text-sm" />
          <div className="flex flex-wrap items-center gap-3">
            {offline && <span className="text-sm text-dim">Adding needs a connection.</span>}
            <button className="btn btn-primary" disabled={!valid.length || busy || offline} onClick={save}>
              {valid.length > 1 ? `Add ${valid.length} puzzles` : "Add puzzle"}
            </button>
            {!text && <button className="btn btn-ghost text-sm" onClick={() => setText(EXAMPLE)}>Paste the example</button>}
            {result && (
              <span className="flex items-center gap-1.5 text-sm text-good">
                <Check size={16} /> Added {result.added}{result.duplicates ? `, skipped ${result.duplicates} already in your library` : ""}.
                <button className="ml-1 text-boxwood underline-offset-4 hover:underline" onClick={() => navigate("/practice")}>Practise now</button>
              </span>
            )}
            {error && <span className="text-sm text-blunder">{error}</span>}
          </div>
        </div>

        <div className="flex flex-col gap-5">
          {parsed.length === 0 && <p className="text-sm text-dim">A preview of each puzzle shows up here.</p>}
          {parsed.map((r, i) =>
            r.ok ? (
              <Preview key={i} p={{ ...r.puzzle, solver: overrides[i] ?? r.puzzle.solver }} onFlip={() => setOverrides({ ...overrides, [i]: (overrides[i] ?? r.puzzle.solver) === "w" ? "b" : "w" })} />
            ) : (
              <div key={i} className="panel p-4 text-sm">
                <p className="text-blunder">Puzzle {i + 1} can't be read: {r.error}</p>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function Preview({ p, onFlip }: { p: ParsedPuzzle; onFlip: () => void }) {
  const userMoves = p.moves.filter((_, i) => moverAt(p.fen, i) === p.solver).length;
  const auto = moverAt(p.fen, 0) !== p.solver;
  return (
    <div className="panel p-4">
      <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
      <p className="figurine mt-3 text-sm">{formatLine(p.fen, p.san.map(figurine))}</p>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm text-dim">
        <span>You play {sideName(p.solver)}: {userMoves} move{userMoves === 1 ? "" : "s"} to find{auto ? ", after the first move" : ""}.</span>
        <button onClick={onFlip} className="link flex shrink-0 items-center gap-1" title="Play the other side"><ArrowLeftRight size={14} /> Switch</button>
      </div>
    </div>
  );
}
