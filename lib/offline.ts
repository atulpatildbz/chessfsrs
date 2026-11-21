// Pure parts of offline practice, shared by the app and the tests: the local copy of the library, the
// outbox of grades not yet confirmed by the server, and the practice queue built from both.
import { review as fsrsReview, type Grade, type StoredCard } from "./fsrs";

export type LocalPuzzle = {
  _id: string;
  fen: string;
  moves: string[];
  solver: "w" | "b";
  source: "manual" | "chesscom" | "lichess";
  title?: string;
  notes?: string;
  tags: string[];
  game?: {
    url: string;
    white: string;
    black: string;
    timeClass: string;
    playedAt: number;
    moveLabel: string;
    playedSan: string;
    bestSan: string;
    evalBefore: number;
    evalBest: number;
    evalPlayed: number;
    mate: number | null;
  };
  suspended: boolean;
  createdAt: number;
  card: StoredCard;
  introducedAt: number | null;
  updatedAt: number;
};

export type ReviewOp = {
  kind: "review";
  opId: string;
  puzzleId: string;
  grade: Grade;
  reviewedAt: number;
  durationMs: number;
  mistakes: number;
  hints: number;
  revealed: boolean;
  /** reps of the card the grade was given on. */
  expectedReps: number;
  /**
   * Set when the server accepted it: the puzzle's updatedAt after that write. The op stays (and keeps
   * applying) until a pull brings a row at least that new, so the screen never flips back.
   */
  ack?: number;
};
export type UndoOp = {
  kind: "undo";
  opId: string;
  /** opId of the grade being undone (already sent to the server). */
  targetOpId: string;
  puzzleId: string;
  cardBefore: StoredCard;
  introducedBefore: number | null;
  ack?: number;
};
export type Op = ReviewOp | UndoOp;

/**
 * The library as this device should show it: the server's rows with the outbox laid on top, in order.
 * A grade applies only to the card it was given on (same reps), so a puzzle graded meanwhile on
 * another device isn't graded twice on screen; the server still records both.
 */
export function applyOutbox(puzzles: Map<string, LocalPuzzle>, ops: Op[], desiredRetention: number): Map<string, LocalPuzzle> {
  if (ops.length === 0) return puzzles;
  const out = new Map(puzzles);
  for (const op of ops) {
    const p = out.get(op.puzzleId);
    if (!p || confirmed(op, puzzles)) continue;
    if (op.kind === "review") {
      // Compare with the *current* overlaid card so two offline grades of one puzzle chain.
      if (p.card.reps !== op.expectedReps) continue;
      const card = fsrsReview(p.card, p._id, op.grade, op.reviewedAt, desiredRetention);
      out.set(p._id, { ...p, card, introducedAt: p.card.state === 0 ? op.reviewedAt : p.introducedAt });
    } else {
      if (p.card.reps !== op.cardBefore.reps + 1) continue;
      out.set(p._id, { ...p, card: op.cardBefore, introducedAt: op.introducedBefore });
    }
  }
  return out;
}

/** Ops the server has applied and a pull has reflected: safe to forget. */
export function confirmed(op: Op, puzzles: Map<string, LocalPuzzle>): boolean {
  if (op.ack === undefined) return false;
  const p = puzzles.get(op.puzzleId);
  return !p || p.updatedAt >= op.ack;
}

/** Learning cards due within this window keep the session open with a countdown (Anki's learn-ahead). */
export const LEARN_AHEAD = 20 * 60_000;

export type Queue = {
  due: LocalPuzzle[];
  fresh: LocalPuzzle[];
  newLeft: number;
  introducedToday: number;
  nextAt: number | null;
};

/**
 * What to practise now, the same rules the server used:
 * - due: learning/relearning first, then reviews, both oldest-due first
 * - fresh: new puzzles in the order they were added, within what's left of today's allowance
 * - nextAt: when the next not-yet-due learning card comes due (for the countdown)
 */
export function buildQueue(puzzles: Iterable<LocalPuzzle>, o: { now: number; dayStart: number; newPerDay: number }): Queue {
  const learning: LocalPuzzle[] = [], reviews: LocalPuzzle[] = [], fresh: LocalPuzzle[] = [];
  let introducedToday = 0;
  let nextAt: number | null = null;
  for (const p of puzzles) {
    if (p.introducedAt !== null && p.introducedAt >= o.dayStart) introducedToday++;
    if (p.suspended) continue;
    const { state, dueAt } = p.card;
    if (state === 0) fresh.push(p);
    else if (dueAt <= o.now) (state === 2 ? reviews : learning).push(p);
    else if (dueAt < o.now + LEARN_AHEAD && (nextAt === null || dueAt < nextAt)) nextAt = dueAt;
  }
  const byDue = (a: LocalPuzzle, b: LocalPuzzle) => a.card.dueAt - b.card.dueAt;
  const newLeft = Math.max(0, o.newPerDay - introducedToday);
  return {
    due: [...learning.sort(byDue), ...reviews.sort(byDue)],
    fresh: fresh.sort(byDue).slice(0, newLeft),
    newLeft,
    introducedToday,
    nextAt,
  };
}

/** Put a pull's rows into the local copy. Returns the new cursor (latest updatedAt seen). */
export function mergePull(
  puzzles: Map<string, LocalPuzzle>,
  pull: { puzzles: LocalPuzzle[]; deleted: { id: string; at: number }[] },
  cursor: number,
): { puzzles: Map<string, LocalPuzzle>; cursor: number; changed: boolean } {
  let changed = false;
  const out = new Map(puzzles);
  for (const p of pull.puzzles) {
    const old = out.get(p._id);
    if (!old || old.updatedAt <= p.updatedAt) {
      if (!old || JSON.stringify(old) !== JSON.stringify(p)) changed = true;
      out.set(p._id, p);
    }
    if (p.updatedAt > cursor) cursor = p.updatedAt;
  }
  for (const d of pull.deleted) {
    if (out.delete(d.id)) changed = true;
    if (d.at > cursor) cursor = d.at;
  }
  return { puzzles: changed ? out : puzzles, cursor, changed };
}
