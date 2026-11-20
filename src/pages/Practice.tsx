import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Lightbulb, RotateCcw, Undo2, Eye } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import type { PracticePuzzle } from "../../convex/practice";
import { Solver, type Attempt, type Feedback, type SolverHandle, type SolverStatus } from "../components/Solver";
import { formatInterval, GRADE_NAMES, preview, suggestGrade, type Grade } from "../../lib/fsrs";
import { formatLine, moverAt, sanLine } from "../../lib/puzzle";
import { figurine, formatEval, sideName } from "../lib/notation";
import { startOfToday, useNow } from "../lib/time";
import { navigate } from "../lib/router";

export function Practice({ puzzleId }: { puzzleId: string | null }) {
  if (puzzleId) return <SinglePuzzle id={puzzleId as Id<"puzzles">} />;
  return <Session />;
}

/** Try one puzzle from the library without touching its schedule. */
function SinglePuzzle({ id }: { id: Id<"puzzles"> }) {
  const p = useQuery(api.puzzles.get, { id });
  if (p === undefined) return null;
  if (p === null) return <Empty title="Puzzle not found" body="It may have been deleted." />;
  return (
    <Trainer
      key={p._id}
      puzzle={p as unknown as PracticePuzzle}
      graded={false}
      header={<button className="btn btn-ghost !px-3 !py-1.5 text-sm" onClick={() => navigate(`/puzzle/${id}`)}><ArrowLeft size={16} /> Back</button>}
    />
  );
}

function Session() {
  const now = useNow(15_000);
  const dayStart = useMemo(() => startOfToday(), [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useQuery(api.practice.queue, { now, dayStart });
  const [current, setCurrent] = useState<PracticePuzzle | null>(null);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<{ reviewId: Id<"reviews">; puzzle: PracticePuzzle } | null>(null);
  const undo = useMutation(api.practice.undo);

  // Pick the next puzzle: due ones first, with a new puzzle after every two reviews. A graded
  // puzzle drops out of the queue by itself: Convex resolves the mutation only once queries
  // reflect it.
  useEffect(() => {
    if (current || !q) return;
    const pickNew = q.fresh.length > 0 && (q.due.length === 0 || count % 3 === 2);
    const next = pickNew ? q.fresh[0] : q.due[0];
    if (next) setCurrent(next);
  }, [q, current, count]);

  const onGraded = useCallback((reviewId: Id<"reviews">, p: PracticePuzzle) => {
    setLast({ reviewId, puzzle: p });
    setCount((c) => c + 1);
    setCurrent(null);
  }, []);

  const doUndo = async () => {
    if (!last) return;
    await undo({ reviewId: last.reviewId });
    setCurrent({ ...last.puzzle });
    setCount((c) => Math.max(0, c - 1));
    setLast(null);
  };

  if (!q) return null;

  const header = (
    <div className="flex items-center gap-4 text-sm text-sage">
      <span title="Due now"><b className="font-semibold text-bone">{q.due.length}</b> due</span>
      <span title="New puzzles left today"><b className="font-semibold text-bone">{q.fresh.length}</b> new</span>
      <span title="Done this session"><b className="font-semibold text-bone">{count}</b> done</span>
      {last && <button onClick={doUndo} className="ml-auto flex items-center gap-1 hover:text-bone" title="Undo last grade (U)"><Undo2 size={15} /> Undo</button>}
    </div>
  );

  if (!current) {
    if (q.nextAt) return <Waiting nextAt={q.nextAt} header={header} />;
    return (
      <Empty
        title={count ? `Done for now: ${count} puzzle${count === 1 ? "" : "s"}` : "Nothing due"}
        body={q.newLeft === 0 && q.introducedToday > 0 ? "You've had today's new puzzles. More tomorrow, or raise the daily limit in Settings." : "Add puzzles or scan your games to find the moments you missed."}
        actions={<>
          <a className="btn btn-primary" href="#/import">Find puzzles in my games</a>
          <a className="btn btn-ghost" href="#/add">Add a puzzle</a>
        </>}
        extra={last && <button onClick={doUndo} className="btn btn-quiet"><Undo2 size={16} /> Undo last grade</button>}
      />
    );
  }

  return <Trainer key={current._id + count} puzzle={current} graded desiredRetention={q.desiredRetention} header={header} onGraded={onGraded} onUndo={last ? doUndo : undefined} />;
}

function Waiting({ nextAt, header }: { nextAt: number; header: React.ReactNode }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      {header}
      <div className="mt-16 text-center">
        <p className="font-serif text-5xl tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</p>
        <p className="mt-3 text-sage">until a puzzle you're still learning comes back. Leave this open or come back later.</p>
      </div>
    </div>
  );
}

function Empty({ title, body, actions, extra }: { title: string; body: string; actions?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 px-6 py-16">
      <h1 className="font-serif text-3xl">{title}</h1>
      <p className="text-sage">{body}</p>
      <div className="mt-2 flex flex-wrap gap-3">{actions}</div>
      {extra}
    </div>
  );
}

type TrainerProps = {
  puzzle: PracticePuzzle;
  graded: boolean;
  desiredRetention?: number;
  header?: React.ReactNode;
  onGraded?: (reviewId: Id<"reviews">, p: PracticePuzzle) => void;
  onUndo?: () => void;
};

function Trainer({ puzzle, graded, desiredRetention = 0.9, header, onGraded, onUndo }: TrainerProps) {
  const solver = useRef<SolverHandle>(null);
  const [status, setStatus] = useState<SolverStatus>("intro");
  const [ply, setPly] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>("none");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const review = useMutation(api.practice.review);

  const line = useMemo(() => ({ fen: puzzle.fen, moves: puzzle.moves, solver: puzzle.solver }), [puzzle]);
  const san = useMemo(() => sanLine(puzzle.fen, puzzle.moves), [puzzle]);
  const done = status === "solved" || status === "revealed";
  const suggested = attempt ? suggestGrade(attempt) : null;
  const previews = useMemo(() => (attempt && graded ? preview(puzzle.card, puzzle._id, Date.now(), desiredRetention) : null), [attempt, graded, puzzle, desiredRetention]);
  const userMoveIdx = useMemo(() => puzzle.moves.map((_, i) => i).filter((i) => moverAt(puzzle.fen, i) === puzzle.solver), [puzzle]);
  const userStep = userMoveIdx.filter((i) => i < ply).length + (done ? 0 : 1);

  const onStatus = useCallback((s: SolverStatus, p: number, fb: Feedback) => { setStatus(s); setPly(p); setFeedback(fb); }, []);
  const onFinish = useCallback((a: Attempt) => setAttempt((prev) => prev ?? a), []);

  const grade = useCallback(async (g: Grade) => {
    if (!attempt || submitting || !graded) return;
    setSubmitting(true);
    try {
      const r = await review({ id: puzzle._id as Id<"puzzles">, grade: g, durationMs: attempt.ms, mistakes: attempt.mistakes, hints: attempt.hints, revealed: attempt.revealed });
      onGraded?.(r.reviewId, puzzle);
    } finally {
      setSubmitting(false);
    }
  }, [attempt, graded, onGraded, puzzle, review, submitting]);

  const retry = () => { setFeedback("none"); solver.current?.retry(); };

  // Keyboard: H hint, S solution, R retry, 1–4 grade, Space/Enter accept suggestion, U undo.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "h") solver.current?.hint();
      else if (k === "s") solver.current?.reveal();
      else if (k === "r" && done) retry();
      else if (k === "u" && onUndo) onUndo();
      else if (done && graded && ["1", "2", "3", "4"].includes(k)) void grade(Number(k) as Grade);
      else if (done && graded && (k === " " || k === "enter") && suggested) { e.preventDefault(); void grade(suggested); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const game = puzzle.game;
  const prompt = (() => {
    if (status === "revealed") return { text: "Here's the line.", tone: "text-sage" };
    if (status === "solved") return feedback === "alt" ? { text: "Checkmate. That works too.", tone: "text-moss" } : { text: attempt && attempt.mistakes > 0 ? "Solved, after a miss." : "Solved.", tone: "text-moss" };
    if (feedback === "wrong") return { text: "Not that one. Try again.", tone: "text-claret" };
    if (feedback === "correct") return { text: "Right. Keep going.", tone: "text-moss" };
    if (status === "intro") return { text: game ? `Your game vs ${opponentOf(puzzle)}.` : "Watch the move.", tone: "text-sage" };
    return { text: game ? `Find the move you missed.` : `${sideName(puzzle.solver)} to play.`, tone: "text-bone" };
  })();

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-3 pb-6 pt-3 md:flex-row md:items-start md:gap-8 md:px-6 md:pt-6">
      <div className="w-full md:w-auto md:flex-1">
        <div className="mx-auto w-full md:max-w-[min(100%,calc(100dvh-3rem))]">
          <Solver ref={solver} puzzle={line} onStatus={onStatus} onFinish={onFinish} />
        </div>
      </div>

      <aside className="flex w-full flex-col gap-4 md:w-[340px] md:shrink-0">
        {header && <div className="px-1">{header}</div>}

        <div className="panel p-5">
          <div className="flex items-center gap-3">
            <span className={`h-4 w-4 shrink-0 rounded-full border ${puzzle.solver === "w" ? "border-bone bg-bone" : "border-sage bg-black"}`} aria-hidden />
            <p className={`font-serif text-xl leading-snug ${prompt.tone}`} aria-live="polite">{prompt.text}</p>
          </div>
          {!done && userMoveIdx.length > 1 && (
            <p className="mt-2 text-sm text-sage">{sideName(puzzle.solver)} to play · move {Math.min(userStep, userMoveIdx.length)} of {userMoveIdx.length}</p>
          )}
          {!done && userMoveIdx.length === 1 && status !== "intro" && <p className="mt-2 text-sm text-sage">{sideName(puzzle.solver)} to play</p>}

          {!done && (
            <div className="mt-5 flex gap-2">
              <button className="btn btn-quiet flex-1" onClick={() => solver.current?.hint()} disabled={status !== "user"}><Lightbulb size={16} /> Hint <span className="kbd hidden md:inline">H</span></button>
              <button className="btn btn-quiet flex-1" onClick={() => solver.current?.reveal()} disabled={status === "intro"}><Eye size={16} /> Solution <span className="kbd hidden md:inline">S</span></button>
            </div>
          )}

          {done && graded && previews && suggested && (
            <div className="pop mt-5">
              <div className="grid grid-cols-4 gap-2">
                {([1, 2, 3, 4] as Grade[]).map((g) => (
                  <button key={g} disabled={submitting} onClick={() => void grade(g)}
                    className={`flex flex-col items-center rounded-xl px-1 py-2.5 transition-colors ${g === suggested ? "bg-brass text-[#1c1606] hover:bg-brass-2" : "bg-felt-3/60 text-bone hover:bg-felt-3"}`}>
                    <span className="text-sm font-semibold">{GRADE_NAMES[g]}</span>
                    <span className={`text-xs ${g === suggested ? "opacity-75" : "text-sage"}`}>{formatInterval(previews[g] - Date.now())}</span>
                  </button>
                ))}
              </div>
              <p className="mt-2.5 text-xs text-sage">{gradeReason(attempt!)} <span className="hidden md:inline">Space accepts, 1–4 to choose.</span></p>
            </div>
          )}
          {done && (
            <div className="mt-3 flex gap-2">
              <button className="btn btn-ghost !py-1.5 text-sm" onClick={retry}><RotateCcw size={15} /> Play again</button>
            </div>
          )}
        </div>

        {done && (
          <div className="panel pop p-5 text-sm leading-relaxed">
            <p className="figurine text-[0.95rem] text-bone">
              {formatLine(puzzle.fen, san.map(figurine))}
            </p>
            {game && (
              <div className="mt-4 space-y-1.5 text-sage">
                <p>
                  In the game you played <b className="figurine font-semibold text-claret">{figurine(game.playedSan)}</b> ({formatEval(game.evalPlayed)}).
                  The only good move was <b className="figurine font-semibold text-moss">{figurine(game.bestSan)}</b> ({formatEval(game.evalBest, game.mate)}).
                </p>
                <p>{game.white} vs {game.black} · {game.timeClass}{game.playedAt ? ` · ${new Date(game.playedAt).toLocaleDateString()}` : ""}</p>
              </div>
            )}
            {puzzle.notes && <p className="mt-3 whitespace-pre-wrap text-sage">{puzzle.notes}</p>}
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
              {game?.url && <a className="inline-flex items-center gap-1 text-brass hover:underline" href={game.url} target="_blank" rel="noreferrer">Open game <ExternalLink size={13} /></a>}
              <a className="inline-flex items-center gap-1 text-brass hover:underline" href={`https://lichess.org/analysis/${puzzle.fen.replace(/ /g, "_")}?color=${puzzle.solver === "w" ? "white" : "black"}`} target="_blank" rel="noreferrer">Analyse on Lichess <ExternalLink size={13} /></a>
              <a className="text-sage hover:text-bone hover:underline" href={`#/puzzle/${puzzle._id}`}>Edit notes</a>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

function opponentOf(p: PracticePuzzle) {
  if (!p.game) return "";
  return p.solver === "w" ? p.game.black : p.game.white;
}

function gradeReason(a: Attempt) {
  if (a.revealed) return "You looked at the solution, so it comes back soon.";
  if (a.mistakes > 0) return `${a.mistakes} wrong move${a.mistakes > 1 ? "s" : ""}, so it comes back soon.`;
  if (a.hints > 0) return "Solved with a hint.";
  return `Solved in ${Math.round(a.ms / 1000)}s.`;
}

