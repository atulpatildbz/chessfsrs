import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { ArrowLeft, ExternalLink, Lightbulb, RotateCcw, Undo2, Eye } from "lucide-react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { buildQueue, type LocalPuzzle } from "../../lib/offline";
import { enqueue, isInFlight, removeOp, useLocal, usePuzzles } from "../lib/local/store";
import { useOffline } from "../lib/local/sync";
import { Solver, type Attempt, type Feedback, type SolverHandle, type SolverStatus } from "../components/Solver";
import { formatInterval, GRADE_NAMES, preview, suggestGrade, type Grade } from "../../lib/fsrs";
import { formatLine, lichessAnalysisUrl, moverAt, sanLine } from "../../lib/puzzle";
import { figurine, formatEval, sideName } from "../lib/notation";
import { startOfToday, useNow } from "../lib/time";
import { navigate } from "../lib/router";
import { useHoldUpdates } from "../lib/pwa";

type PracticePuzzle = LocalPuzzle;
const DEFAULT_NEW_PER_DAY = 15;

export function Practice({ puzzleId }: { puzzleId: string | null }) {
  if (puzzleId) return <SinglePuzzle id={puzzleId} />;
  return <Session />;
}

/** Try one puzzle from the library without touching its schedule. */
function SinglePuzzle({ id }: { id: string }) {
  const p = usePuzzles().get(id);
  if (!p) return <Empty title="Puzzle not found" body="It may have been deleted." />;
  return (
    <Trainer
      key={p._id}
      puzzle={p}
      graded={false}
      header={<button className="btn btn-ghost !px-3 !py-1.5 text-sm" onClick={() => navigate(`/puzzle/${id}`)}><ArrowLeft size={16} /> Back</button>}
    />
  );
}

function Session() {
  const now = useNow(5_000);
  const dayStart = useMemo(() => startOfToday(), [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const puzzles = usePuzzles();
  const { settings, ops } = useLocal();
  const q = useMemo(
    () => buildQueue(puzzles.values(), { now: Date.now(), dayStart, newPerDay: settings?.newPerDay ?? DEFAULT_NEW_PER_DAY }),
    [puzzles, dayStart, settings?.newPerDay, now], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<{ opId: string; puzzle: PracticePuzzle } | null>(null);
  // Grades apply to the local copy at once (and reach the server whenever there's a connection),
  // so a graded puzzle has already left the queue when the next one is picked.
  const current = currentId ? puzzles.get(currentId) ?? null : null;

  // Pick the next puzzle: due ones first, with a new puzzle after every two reviews.
  useEffect(() => {
    if (current) return;
    const pickNew = q.fresh.length > 0 && (q.due.length === 0 || count % 3 === 2);
    const next = pickNew ? q.fresh[0] : q.due[0];
    if (next) setCurrentId(next._id);
  }, [q, current, count]);

  const onGraded = useCallback((opId: string, p: PracticePuzzle) => {
    setLast({ opId, puzzle: p });
    setCount((c) => c + 1);
    setCurrentId(null);
  }, []);

  const doUndo = () => {
    if (!last) return;
    const pending = ops.find((o) => o.opId === last.opId);
    if (pending && pending.ack === undefined && !isInFlight(last.opId)) removeOp(last.opId); // never left this device
    else enqueue({ kind: "undo", opId: crypto.randomUUID(), targetOpId: last.opId, puzzleId: last.puzzle._id, cardBefore: last.puzzle.card, introducedBefore: last.puzzle.introducedAt });
    setCurrentId(last.puzzle._id);
    setCount((c) => Math.max(0, c - 1));
    setLast(null);
  };

  const header = (
    <div>
      <div className="flex items-center gap-4 text-sm text-dim">
        <span title="Due now"><b className="font-semibold text-ink">{q.due.length}</b> due</span>
        <span title="New puzzles left today"><b className="font-semibold text-ink">{q.fresh.length}</b> new</span>
        <span title="Done this session"><b className="font-semibold text-ink">{count}</b> done</span>
        {last && <button onClick={doUndo} className="ml-auto flex items-center gap-1 hover:text-ink" title="Undo last grade (U)"><Undo2 size={15} /> Undo</button>}
      </div>
      <SyncNote />
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

  return <Trainer key={current._id + count} puzzle={current} graded desiredRetention={settings?.desiredRetention ?? 0.9} header={header} onGraded={onGraded} onUndo={last ? doUndo : undefined} />;
}

/** Says when grades are waiting for a connection. Silent when everything is on the server. */
function SyncNote() {
  const offline = useOffline();
  const { isAuthenticated } = useConvexAuth();
  const pending = useLocal().ops.filter((o) => o.ack === undefined).length;
  if (!offline && (pending === 0 || isAuthenticated)) return null;
  const grades = `${pending} grade${pending === 1 ? "" : "s"}`;
  return (
    <p className="mt-1 text-xs text-dim" role="status">
      {offline ? (pending ? `Offline. ${grades} will sync when you're back online.` : "Offline. Your grades will sync when you're back online.") : `${grades} waiting to sync.`}
    </p>
  );
}

function Waiting({ nextAt, header }: { nextAt: number; header: React.ReactNode }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.round((nextAt - Date.now()) / 1000));
  return (
    <div className="mx-auto max-w-lg px-5 py-10">
      {header}
      <div className="mt-16 text-center">
        <p className="font-serif text-6xl tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</p>
        <p className="prose-serif mt-3 text-dim">until a puzzle you're still learning comes back. Leave this open or come back later.</p>
      </div>
    </div>
  );
}

function Empty({ title, body, actions, extra }: { title: string; body: string; actions?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-4 px-6 py-16">
      <h1 className="font-serif text-[2.1rem] leading-tight">{title}</h1>
      <p className="prose-serif text-dim">{body}</p>
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
  onGraded?: (opId: string, p: PracticePuzzle) => void;
  onUndo?: () => void;
};

function Trainer({ puzzle: initial, graded, desiredRetention = 0.9, header, onGraded, onUndo }: TrainerProps) {
  // The local copy hands out a new object whenever a sync touches it; the board must not reset
  // mid-solve because of that. Each puzzle gets a fresh Trainer (keyed by the caller).
  const [puzzle] = useState(initial);
  const solver = useRef<SolverHandle>(null);
  const [status, setStatus] = useState<SolverStatus>("intro");
  const [ply, setPly] = useState(0);
  const [feedback, setFeedback] = useState<Feedback>("none");
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const graded1 = useRef(false);
  const { isAuthenticated } = useConvexAuth();
  // Woodpecker-style feedback: are you recognising this one faster than last time? Frozen at the
  // first answer, so grading this attempt doesn't replace "last time" with itself.
  const lastSolveLive = useQuery(api.stats.lastSolve, graded && isAuthenticated ? { puzzleId: puzzle._id as Id<"puzzles"> } : "skip");
  const lastSolve = useRef<{ ms: number } | null | undefined>(undefined);
  if (lastSolve.current === undefined && lastSolveLive !== undefined) lastSolve.current = lastSolveLive;

  const line = useMemo(() => ({ fen: puzzle.fen, moves: puzzle.moves, solver: puzzle.solver }), [puzzle]);
  const san = useMemo(() => sanLine(puzzle.fen, puzzle.moves), [puzzle]);
  const done = status === "solved" || status === "revealed";
  const suggested = attempt ? suggestGrade(attempt) : null;
  const previews = useMemo(() => (attempt && graded ? preview(puzzle.card, puzzle._id, Date.now(), desiredRetention) : null), [attempt, graded, puzzle, desiredRetention]);
  const userMoveIdx = useMemo(() => puzzle.moves.map((_, i) => i).filter((i) => moverAt(puzzle.fen, i) === puzzle.solver), [puzzle]);
  const userStep = userMoveIdx.filter((i) => i < ply).length + (done ? 0 : 1);
  // Once you've touched the puzzle (a move, a miss, a hint) or it's waiting for a grade, a new version waits.
  const [hinted, setHinted] = useState(false);
  useHoldUpdates(ply > (userMoveIdx[0] ?? 0) || feedback !== "none" || hinted || attempt !== null);
  const hint = () => { setHinted(true); solver.current?.hint(); };

  const onStatus = useCallback((s: SolverStatus, p: number, fb: Feedback) => { setStatus(s); setPly(p); setFeedback(fb); }, []);
  const onFinish = useCallback((a: Attempt) => setAttempt((prev) => prev ?? a), []);

  const grade = useCallback((g: Grade) => {
    if (!attempt || graded1.current || !graded) return;
    graded1.current = true;
    const opId = crypto.randomUUID();
    enqueue({
      kind: "review", opId, puzzleId: puzzle._id, grade: g, reviewedAt: Date.now(), durationMs: attempt.ms,
      mistakes: attempt.mistakes, hints: attempt.hints, revealed: attempt.revealed, expectedReps: puzzle.card.reps,
    });
    onGraded?.(opId, puzzle);
  }, [attempt, graded, onGraded, puzzle]);

  const retry = () => { setFeedback("none"); solver.current?.retry(); };

  // Keyboard: H hint, S solution, R retry, 1–4 grade, Space/Enter accept suggestion, U undo.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.metaKey || e.ctrlKey) return;
      const k = e.key.toLowerCase();
      if (k === "h") hint();
      else if (k === "s") solver.current?.reveal();
      else if (k === "r" && done) retry();
      else if (k === "u" && onUndo) onUndo();
      else if (done && graded && ["1", "2", "3", "4"].includes(k)) grade(Number(k) as Grade);
      else if (done && graded && (k === " " || k === "enter") && suggested) {
        if ((e.target as Element | null)?.closest?.("button, a, select")) return; // let focused controls act
        e.preventDefault();
        grade(suggested);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });

  const game = puzzle.game;
  const prompt = (() => {
    if (status === "revealed") return { text: "Here's the line.", tone: "text-dim" };
    if (status === "solved") return feedback === "alt" ? { text: "Checkmate. That works too.", tone: "text-good" } : { text: attempt && attempt.mistakes > 0 ? "Solved, after a miss." : "Solved.", tone: "text-good" };
    if (feedback === "wrong") return { text: "Not that one. Try again.", tone: "text-blunder" };
    if (feedback === "wrong-again") return { text: "Still not it. Take a hint, or look at the solution and come back to it.", tone: "text-blunder" };
    if (feedback === "correct") return { text: "Right. Keep going.", tone: "text-good" };
    if (status === "intro") return { text: game ? `Your game vs ${opponentOf(puzzle)}.` : "Watch the move.", tone: "text-dim" };
    return { text: game ? `Find the move you missed.` : `${sideName(puzzle.solver)} to play.`, tone: "text-ink" };
  })();

  const details = done && (
    <div className="pop border-t border-line px-1 pt-4 text-sm leading-relaxed md:border-0 md:pt-0">
      <p className="figurine prose-serif text-ink">
        {formatLine(puzzle.fen, san.map(figurine))}
      </p>
      {game && (
        <div className="prose-serif mt-3 space-y-2 text-dim">
          <p>
            In the game you played <span className="figurine mv-bad">{figurine(game.playedSan)}</span> ({formatEval(game.evalPlayed)}) and
            the only good move was <span className="figurine mv-good">{figurine(game.bestSan)}</span> ({formatEval(game.evalBest, game.mate)}).
          </p>
          <p>{[`${game.white} vs ${game.black}`, game.timeClass, game.playedAt ? new Date(game.playedAt).toLocaleDateString() : ""].filter(Boolean).join(", ")}</p>
        </div>
      )}
      {puzzle.notes && <p className="prose-serif mt-3 whitespace-pre-wrap italic text-dim">{puzzle.notes}</p>}
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {game?.url && <a className="link inline-flex items-center gap-1" href={game.url} target="_blank" rel="noreferrer">Open game <ExternalLink size={13} /></a>}
        <a className="link inline-flex items-center gap-1" href={lichessAnalysisUrl(puzzle)} target="_blank" rel="noreferrer">Analyse on Lichess <ExternalLink size={13} /></a>
        <a className="text-dim underline-offset-[3px] hover:text-ink hover:underline" href={`#/puzzle/${puzzle._id}`}>Edit notes</a>
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl md:flex md:flex-row md:items-start md:gap-8 md:px-6 md:pb-6 md:pt-6">
      {/* On a phone the first screen holds the stats, the board and the controls, with the board
          centred in whatever height is left; the line and game details scroll in below it. */}
      <div className="flex min-h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))] flex-col gap-3 py-3 md:contents">
        {header && <div className="px-4 md:hidden">{header}</div>}
        <div className="flex w-full flex-1 items-center md:block md:w-auto md:flex-1">
          <div className="mx-auto w-full max-w-[min(100%,max(260px,calc(100dvh-22.5rem-env(safe-area-inset-bottom)-env(safe-area-inset-top))))] md:max-w-[min(100%,calc(100dvh-3rem))]">
            <Solver ref={solver} puzzle={line} onStatus={onStatus} onFinish={onFinish} />
          </div>
        </div>

        <aside className="flex w-full flex-col gap-3 px-3 md:w-[340px] md:shrink-0 md:gap-4 md:px-0">
          {header && <div className="hidden px-1 md:block">{header}</div>}

          <div className="panel flex min-h-[14rem] flex-col p-4 md:block md:min-h-0 md:p-5">
            <div className="flex items-center gap-3">
              <span className={`h-3.5 w-3.5 shrink-0 rounded-[3px] border border-dim ${puzzle.solver === "w" ? "bg-[#f7efdd]" : "bg-[#17120e]"}`} aria-hidden />
              <p className={`font-serif text-[1.3rem] leading-snug md:text-[1.45rem] ${prompt.tone}`} aria-live="polite">{prompt.text}</p>
            </div>
            {!done && userMoveIdx.length > 1 && (
              <p className="mt-1 text-sm text-dim md:mt-2">{sideName(puzzle.solver)} to play, move {Math.min(userStep, userMoveIdx.length)} of {userMoveIdx.length}</p>
            )}
            {!done && userMoveIdx.length === 1 && status !== "intro" && <p className="mt-1 text-sm text-dim md:mt-2">{sideName(puzzle.solver)} to play</p>}

            {!done && (
              <div className="mt-auto flex gap-2 pt-3 md:mt-5 md:pt-0">
                <button className="btn btn-quiet flex-1" onClick={hint} disabled={status !== "user"}><Lightbulb size={16} /> Hint <span className="kbd hidden md:inline">H</span></button>
                <button className="btn btn-quiet flex-1" onClick={() => solver.current?.reveal()} disabled={status === "intro"}><Eye size={16} /> Solution <span className="kbd hidden md:inline">S</span></button>
              </div>
            )}

            {done && graded && previews && suggested && (
              <div className="pop mt-3 md:mt-5">
                <div className="grid grid-cols-4 gap-2">
                  {([1, 2, 3, 4] as Grade[]).map((g) => (
                    <button key={g} onClick={() => grade(g)}
                      className={`flex flex-col items-center rounded-md px-1 py-2.5 transition-colors ${g === suggested ? "bg-ink text-paper hover:bg-ink-2" : "bg-paper-3 text-ink hover:bg-line"}`}>
                      <span className="text-sm font-semibold">{GRADE_NAMES[g]}</span>
                      <span className={`text-xs ${g === suggested ? "opacity-75" : "text-dim"}`}>{formatInterval(previews[g] - Date.now())}</span>
                    </button>
                  ))}
                </div>
                <p className="mt-2.5 text-xs text-dim">{gradeReason(attempt!)} <span className="hidden md:inline">Space accepts, 1–4 to choose.</span></p>
              </div>
            )}
            {done && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <button className="btn btn-ghost !py-1.5 text-sm" onClick={retry}><RotateCcw size={15} /> Play again</button>
                {attempt && status === "solved" && attempt.mistakes === 0 && !attempt.revealed && attempt.hints === 0 && <SolveTime ms={attempt.ms} last={lastSolve.current?.ms ?? null} />}
              </div>
            )}
          </div>

          {details && <div className="hidden md:block">{details}</div>}
        </aside>
      </div>
      {details && <div className="px-3 pb-4 md:hidden">{details}</div>}
    </div>
  );
}

function SolveTime({ ms, last }: { ms: number; last: number | null }) {
  const s = (x: number) => (x < 10_000 ? (x / 1000).toFixed(1) : Math.round(x / 1000)) + " s";
  const faster = last !== null && ms < last;
  return (
    <p className="text-sm text-dim">
      Solved in <span className="font-semibold text-ink tabular-nums">{s(ms)}</span>
      {last !== null && <>, <span className={faster ? "text-good" : ""}>{s(last)} last time</span></>}
    </p>
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

