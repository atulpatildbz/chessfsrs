import { describe, expect, it } from "vitest";
import { newCard, preview, review, suggestGrade, formatInterval, retrievability } from "../lib/fsrs";

const T0 = Date.UTC(2026, 0, 1);

describe("fsrs wrapper", () => {
  it("new card is due now and in state New", () => {
    const c = newCard(T0);
    expect(c.state).toBe(0);
    expect(c.dueAt).toBe(T0);
    expect(retrievability(c, T0)).toBeNull();
  });
  it("preview orders intervals Again <= Hard <= Good <= Easy", () => {
    const p = preview(newCard(T0), "id1", T0);
    expect(p[1]).toBeLessThanOrEqual(p[2]);
    expect(p[2]).toBeLessThanOrEqual(p[3]);
    expect(p[3]).toBeLessThanOrEqual(p[4]);
  });
  it("review round-trips through stored form and grows intervals", () => {
    let c = review(newCard(T0), "id1", 3, T0);
    let t = c.dueAt;
    const first = c.dueAt - T0;
    c = review(c, "id1", 3, t);
    expect(c.dueAt - t).toBeGreaterThan(first);
    expect(c.reps).toBe(2);
    t = c.dueAt;
    const r = retrievability(c, t)!;
    expect(r).toBeGreaterThan(0.8);
    expect(r).toBeLessThan(0.95);
    c = review(c, "id1", 1, t);
    expect(c.lapses).toBe(1);
    expect(c.state).toBe(3);
  });
  it("suggests grades from the attempt", () => {
    expect(suggestGrade({ mistakes: 1, hints: 0, revealed: false, ms: 1000, userMoves: 1 })).toBe(1);
    expect(suggestGrade({ mistakes: 0, hints: 0, revealed: true, ms: 1000, userMoves: 1 })).toBe(1);
    expect(suggestGrade({ mistakes: 0, hints: 1, revealed: false, ms: 1000, userMoves: 1 })).toBe(2);
    expect(suggestGrade({ mistakes: 0, hints: 0, revealed: false, ms: 60000, userMoves: 2 })).toBe(3);
    expect(suggestGrade({ mistakes: 0, hints: 0, revealed: false, ms: 1000, userMoves: 2 })).toBe(3);
  });
  it("formats intervals", () => {
    expect(formatInterval(30_000)).toBe("<1m");
    expect(formatInterval(10 * 60_000)).toBe("10m");
    expect(formatInterval(3 * 86_400_000)).toBe("3d");
  });
});
