// Interactive puzzle solving on a chessground board.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Chess } from "chess.js";
import type { Api } from "@lichess-org/chessground/api";
import type { Key } from "@lichess-org/chessground/types";
import { Board, legalDests } from "./Board";
import { judgeMove, moverAt, parseUci, type PuzzleLine } from "../../lib/puzzle";
import { sounds } from "../lib/sound";

export type Attempt = { mistakes: number; hints: number; revealed: boolean; ms: number; userMoves: number };
export type SolverStatus = "intro" | "user" | "opponent" | "solved" | "revealed";
export type SolverHandle = { hint(): void; reveal(): void; retry(): void };

type Props = {
  puzzle: PuzzleLine;
  onStatus?: (s: SolverStatus, ply: number, feedback: Feedback) => void;
  onFinish?: (a: Attempt) => void;
};
export type Feedback = "none" | "correct" | "wrong" | "wrong-again" | "alt";

const colorName = (c: "w" | "b") => (c === "w" ? "white" : "black");
const PROMO = ["q", "n", "r", "b"] as const;

export const Solver = forwardRef<SolverHandle, Props>(function Solver({ puzzle, onStatus, onFinish }, ref) {
  const cg = useRef<Api | null>(null);
  const chess = useRef(new Chess(puzzle.fen));
  const ply = useRef(0);
  const status = useRef<SolverStatus>("intro");
  const stats = useRef({ mistakes: 0, hints: 0, revealed: false, started: 0, userMoves: 0 });
  const hintLevel = useRef(0);
  const timers = useRef<number[]>([]);
  const [shake, setShake] = useState(false);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const finished = useRef(false);
  const resetPending = useRef(false); // a wrong move's red square is still showing

  const userTotal = useMemo(() => puzzle.moves.filter((_, i) => moverAt(puzzle.fen, i) === puzzle.solver).length, [puzzle]);

  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)); };
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const emit = useCallback((s: SolverStatus, fb: Feedback = "none") => {
    status.current = s;
    onStatus?.(s, ply.current, fb);
  }, [onStatus]);

  const sync = useCallback((lastMove?: [string, string], custom?: Map<Key, string>) => {
    const c = chess.current;
    const userTurn = status.current === "user";
    cg.current?.set({
      fen: c.fen(),
      turnColor: colorName(c.turn()),
      check: c.inCheck(),
      lastMove: lastMove as Key[] | undefined,
      movable: { free: false, color: userTurn ? colorName(puzzle.solver) : undefined, dests: userTurn ? legalDests(c) : new Map(), showDests: true },
      highlight: { lastMove: true, check: true, custom: custom ?? new Map() },
      drawable: { autoShapes: [] },
    });
  }, [puzzle.solver]);

  const finish = useCallback((revealed: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const s = stats.current;
    // Once the solution was shown, the attempt counts as revealed even if replayed afterwards.
    onFinish?.({ mistakes: s.mistakes, hints: s.hints, revealed: revealed || s.revealed, ms: Date.now() - (s.started || Date.now()), userMoves: userTotal });
  }, [onFinish, userTotal]);

  /** Play the move at the current ply (auto move) with sound. */
  const playAuto = useCallback(() => {
    const m = chess.current.move(parseUci(puzzle.moves[ply.current]));
    ply.current++;
    (m.captured ? sounds.capture : sounds.move)();
    return m;
  }, [puzzle.moves]);

  const toUserTurn = useCallback((last?: [string, string], custom?: Map<Key, string>, fb: Feedback = "none") => {
    hintLevel.current = 0;
    status.current = "user";
    if (!stats.current.started) stats.current.started = Date.now();
    sync(last, custom);
    emit("user", fb);
  }, [emit, sync]);

  const start = useCallback(() => {
    clearTimers();
    setPromo(null);
    chess.current = new Chess(puzzle.fen);
    ply.current = 0;
    finished.current = false;
    hintLevel.current = 0;
    status.current = "intro";
    sync();
    emit("intro");
    if (moverAt(puzzle.fen, 0) !== puzzle.solver) {
      later(() => {
        const m = playAuto();
        toUserTurn([m.from, m.to]);
      }, 400); // long enough to take in the position before the move you answer
    } else toUserTurn();
  }, [emit, playAuto, puzzle, sync, toUserTurn]);

  const applyUserMove = useCallback((uci: string) => {
    if (status.current !== "user") return;
    const verdict = judgeMove(puzzle, ply.current, uci);
    const { from, to } = parseUci(uci);
    if (verdict === "wrong") {
      stats.current.mistakes++;
      sounds.wrong();
      setShake(true);
      emit("user", stats.current.mistakes >= 2 ? "wrong-again" : "wrong");
      cg.current?.set({ highlight: { custom: new Map([[to as Key, "wrong-sq"]]) }, movable: { color: undefined } });
      resetPending.current = true;
      later(() => { resetPending.current = false; if (status.current === "user") sync(ply.current > 0 ? lastOf() : undefined); }, 550);
      return;
    }
    const m = chess.current.move(parseUci(uci));
    ply.current++;
    stats.current.userMoves++;
    (m.captured ? sounds.capture : sounds.move)();
    const ok = new Map([[to as Key, "right-sq"]]);
    if (verdict === "alt-mate" || ply.current >= puzzle.moves.length) {
      status.current = "solved";
      sync([from, to], ok);
      sounds.solved();
      emit("solved", verdict === "alt-mate" ? "alt" : "correct");
      finish(false);
      return;
    }
    status.current = "opponent";
    sync([from, to], ok);
    emit("opponent", "correct");
    later(() => {
      const r = playAuto();
      if (ply.current >= puzzle.moves.length) {
        status.current = "solved";
        sync([r.from, r.to]);
        emit("solved", "correct");
        finish(false);
      } else toUserTurn([r.from, r.to], undefined, "correct");
    }, 420);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emit, finish, playAuto, puzzle, sync, toUserTurn]);

  const lastOf = (): [string, string] | undefined => {
    const h = chess.current.history({ verbose: true });
    const l = h[h.length - 1];
    if (l) return [l.from, l.to];
    if (ply.current > 0) { const u = parseUci(puzzle.moves[ply.current - 1]); return [u.from, u.to]; }
    return undefined;
  };

  const onUserMove = useCallback((from: string, to: string) => {
    if (status.current !== "user") return;
    const piece = chess.current.get(from as never);
    const promoting = piece?.type === "p" && (to[1] === "8" || to[1] === "1");
    if (promoting) {
      const expected = puzzle.moves[ply.current];
      if (expected.startsWith(from + to) && expected.length === 5) {
        // Ask anyway only if the expected piece isn't a queen (underpromotion puzzles).
        if (expected[4] === "q") return applyUserMove(expected);
      }
      setPromo({ from, to });
      return;
    }
    applyUserMove(from + to);
  }, [applyUserMove, puzzle.moves]);

  // chessground calls a stale closure; route through a ref.
  const moveRef = useRef(onUserMove);
  moveRef.current = onUserMove;

  const initialConfig = useMemo(() => ({
    fen: puzzle.fen,
    orientation: colorName(puzzle.solver),
    coordinates: true,
    movable: { free: false, events: { after: (o: Key, d: Key) => moveRef.current(o, d) } },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    highlight: { lastMove: true, check: true },
  }) as const, [puzzle]);

  const startRef = useRef(start);
  startRef.current = start;
  useEffect(() => {
    if (!cg.current) return;
    cg.current.set({ orientation: colorName(puzzle.solver) });
    stats.current = { mistakes: 0, hints: 0, revealed: false, started: 0, userMoves: 0 };
    startRef.current();
    return clearTimers;
  }, [puzzle]);

  useImperativeHandle(ref, () => ({
    hint() {
      if (status.current !== "user") return;
      // Clear a wrong move's red square now, or its pending reset would wipe the hint a moment later.
      if (resetPending.current) {
        clearTimers();
        resetPending.current = false;
        sync(ply.current > 0 ? lastOf() : undefined);
      }
      const { from, to } = parseUci(puzzle.moves[ply.current]);
      if (hintLevel.current === 0) {
        hintLevel.current = 1;
        stats.current.hints++;
        cg.current?.set({ highlight: { custom: new Map([[from as Key, "hint-sq"]]) } });
      } else {
        hintLevel.current = 2;
        cg.current?.setAutoShapes([{ orig: from as Key, dest: to as Key, brush: "yellow" }]);
      }
    },
    reveal() {
      if (status.current === "solved" || status.current === "revealed") return;
      clearTimers();
      setPromo(null);
      stats.current.revealed = true;
      status.current = "revealed";
      emit("revealed");
      finish(true); // grade right away; the line keeps playing out
      const step = () => {
        if (ply.current >= puzzle.moves.length) return;
        const isUser = moverAt(puzzle.fen, ply.current) === puzzle.solver;
        const m = playAuto();
        sync([m.from, m.to], isUser ? new Map([[m.to as Key, "hint-sq"]]) : undefined);
        emit("revealed");
        later(step, 750);
      };
      later(step, 200);
    },
    retry() {
      clearTimers();
      startRef.current();
    },
  }), [emit, finish, playAuto, puzzle, sync]);

  return (
    <div className={shake ? "shake" : ""} onAnimationEnd={() => setShake(false)}>
      <div className="relative">
        <Board config={initialConfig} onReady={(api) => { cg.current = api; }} />
        {promo && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50" onClick={() => { setPromo(null); sync(lastOf()); }}>
            <div className="pop flex gap-2 rounded-xl bg-paper-2 p-3" onClick={(e) => e.stopPropagation()}>
              {PROMO.map((p) => (
                <button key={p} aria-label={`Promote to ${p}`} className="cg-wrap h-16 w-16 rounded-lg bg-[var(--sq-light)] hover:bg-[#f7efdd]"
                  onClick={() => { const pr = promo; setPromo(null); applyUserMove(pr.from + pr.to + p); }}>
                  <piece className={`${colorName(puzzle.solver)} ${({ q: "queen", n: "knight", r: "rook", b: "bishop" })[p]}`} style={{ position: "relative", display: "block", width: "100%", height: "100%" }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements { piece: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> }
  }
}
