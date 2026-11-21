import { describe, expect, it } from "vitest";
import { applyOutbox, buildQueue, confirmed, mergePull, type LocalPuzzle, type Op, type ReviewOp } from "../lib/offline";
import { newCard, review } from "../lib/fsrs";

const T0 = Date.UTC(2026, 0, 10, 12);
const MIN = 60_000, DAY = 86_400_000;

function puzzle(id: string, over: Partial<LocalPuzzle> = {}): LocalPuzzle {
  return {
    _id: id, fen: "8/8/8/8/8/8/8/K6k w - - 0 1", moves: ["a1a2"], solver: "w", source: "manual", tags: [],
    suspended: false, createdAt: T0, card: newCard(T0), introducedAt: null, updatedAt: T0, ...over,
  };
}
const map = (...ps: LocalPuzzle[]) => new Map(ps.map((p) => [p._id, p]));
const op = (puzzleId: string, over: Partial<ReviewOp> = {}): ReviewOp => ({
  kind: "review", opId: `op-${puzzleId}-${Math.random()}`, puzzleId, grade: 3, reviewedAt: T0 + MIN, durationMs: 5000,
  mistakes: 0, hints: 0, revealed: false, expectedReps: 0, ...over,
});

describe("applyOutbox", () => {
  it("applies a pending grade to the local card", () => {
    const out = applyOutbox(map(puzzle("a")), [op("a")], 0.9);
    const c = out.get("a")!.card;
    expect(c.reps).toBe(1);
    expect(c.state).not.toBe(0);
    expect(out.get("a")!.introducedAt).toBe(T0 + MIN);
  });

  it("chains two offline grades of the same puzzle", () => {
    const a = op("a", { grade: 1 });
    const b = op("a", { expectedReps: 1, reviewedAt: T0 + 2 * MIN });
    expect(applyOutbox(map(puzzle("a")), [a, b], 0.9).get("a")!.card.reps).toBe(2);
  });

  it("doesn't apply a grade twice once the server's result has arrived", () => {
    const o = op("a");
    const server = review(newCard(T0), "a", 3, T0 + MIN);
    const pulled = puzzle("a", { card: server, updatedAt: T0 + 2 * MIN });
    const out = applyOutbox(map(pulled), [{ ...o, ack: T0 + 2 * MIN }], 0.9);
    expect(out.get("a")!.card.reps).toBe(1);
  });

  it("keeps applying an accepted grade until a pull at least that new arrives", () => {
    const o = { ...op("a"), ack: T0 + 5 * MIN };
    // Pull still has the old row (updatedAt before the ack).
    expect(applyOutbox(map(puzzle("a")), [o], 0.9).get("a")!.card.reps).toBe(1);
    expect(confirmed(o, map(puzzle("a")))).toBe(false);
    expect(confirmed(o, map(puzzle("a", { updatedAt: T0 + 5 * MIN })))).toBe(true);
  });

  it("an accepted grade stops applying after a later reset brings reps back", () => {
    const o = { ...op("a"), ack: T0 + 5 * MIN };
    const reset = puzzle("a", { updatedAt: T0 + 9 * MIN }); // reps 0 again
    expect(applyOutbox(map(reset), [o], 0.9).get("a")!.card.reps).toBe(0);
  });

  it("skips a grade given on a card another device has moved on", () => {
    const moved = puzzle("a", { card: review(newCard(T0), "a", 3, T0) });
    expect(applyOutbox(map(moved), [op("a")], 0.9).get("a")!.card.reps).toBe(1);
  });

  it("undo restores the card before the grade", () => {
    const graded = puzzle("a", { card: review(newCard(T0), "a", 3, T0 + MIN), introducedAt: T0 + MIN, updatedAt: T0 + 2 * MIN });
    const undo: Op = { kind: "undo", opId: "u", targetOpId: "x", puzzleId: "a", cardBefore: newCard(T0), introducedBefore: null };
    const out = applyOutbox(map(graded), [undo], 0.9).get("a")!;
    expect(out.card.reps).toBe(0);
    expect(out.introducedAt).toBeNull();
  });

  it("ignores ops for puzzles that no longer exist", () => {
    expect(applyOutbox(map(puzzle("a")), [op("gone")], 0.9).size).toBe(1);
    expect(confirmed({ ...op("gone"), ack: 1 }, map(puzzle("a")))).toBe(true);
  });
});

describe("buildQueue", () => {
  const learning = (id: string, dueAt: number) => puzzle(id, { card: { ...newCard(T0), state: 1, reps: 1, dueAt } });
  const known = (id: string, dueAt: number) => puzzle(id, { card: { ...newCard(T0), state: 2, reps: 3, dueAt } });

  it("orders learning first, then reviews, by due time", () => {
    const q = buildQueue([known("r2", T0 - 2 * DAY), learning("l1", T0 - MIN), known("r1", T0 - 3 * DAY)], { now: T0, dayStart: T0 - DAY / 2, newPerDay: 0 });
    expect(q.due.map((p) => p._id)).toEqual(["l1", "r1", "r2"]);
  });

  it("limits new puzzles by what was introduced today", () => {
    const ps = [puzzle("n1", { createdAt: T0 }), puzzle("n2", { createdAt: T0 + 1, card: { ...newCard(T0 + 1) } }), known("k", T0 + DAY)];
    ps[2].introducedAt = T0 - MIN; // introduced today
    const q = buildQueue(ps, { now: T0, dayStart: T0 - 2 * MIN, newPerDay: 2 });
    expect(q.introducedToday).toBe(1);
    expect(q.fresh.map((p) => p._id)).toEqual(["n1"]);
  });

  it("skips suspended puzzles and reports the next learning card", () => {
    const q = buildQueue([learning("l", T0 + 5 * MIN), puzzle("s", { suspended: true })], { now: T0, dayStart: T0 - DAY, newPerDay: 10 });
    expect(q.due).toEqual([]);
    expect(q.fresh).toEqual([]);
    expect(q.nextAt).toBe(T0 + 5 * MIN);
  });
});

describe("mergePull", () => {
  it("adds, updates and deletes rows and advances the cursor", () => {
    const local = map(puzzle("a"), puzzle("b"));
    const r = mergePull(local, { puzzles: [puzzle("a", { notes: "x", updatedAt: T0 + 10 }), puzzle("c", { updatedAt: T0 + 20 })], deleted: [{ id: "b", at: T0 + 30 }] }, T0);
    expect([...r.puzzles.keys()].sort()).toEqual(["a", "c"]);
    expect(r.puzzles.get("a")!.notes).toBe("x");
    expect(r.cursor).toBe(T0 + 30);
    expect(r.changed).toBe(true);
  });

  it("ignores an older copy and reports no change for a repeat", () => {
    const local = map(puzzle("a", { notes: "new", updatedAt: T0 + 10 }));
    const r = mergePull(local, { puzzles: [puzzle("a", { notes: "old", updatedAt: T0 })], deleted: [] }, T0 + 10);
    expect(r.puzzles.get("a")!.notes).toBe("new");
    expect(r.changed).toBe(false);
    expect(r.puzzles).toBe(local);
  });
});
