import { query } from "./_generated/server";
import { v } from "convex/values";
import { currentUser } from "./auth";

const DAY = 86_400_000;

/** Home-screen numbers. `tzOffsetMin` is `new Date().getTimezoneOffset()`. */
export const dashboard = query({
  args: { now: v.number(), dayStart: v.number(), tzOffsetMin: v.number() },
  handler: async (ctx, { now, dayStart, tzOffsetMin }) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const puzzles = await ctx.db.query("puzzles").withIndex("by_user_created", (q) => q.eq("userId", user._id)).collect();
    const counts = { total: puzzles.length, new: 0, learning: 0, review: 0, suspended: 0, dueNow: 0, dueToday: 0, mature: 0 };
    const bySource = { manual: 0, chesscom: 0, lichess: 0 };
    let soonest: (typeof puzzles)[number] | null = null;
    for (const p of puzzles) {
      bySource[p.source]++;
      if (p.suspended) { counts.suspended++; continue; }
      if (p.state === 0) counts.new++;
      else if (p.state === 2) counts.review++;
      else counts.learning++;
      if (p.state !== 0 && p.dueAt <= now) counts.dueNow++;
      if (p.state !== 0 && p.dueAt < dayStart + DAY) counts.dueToday++;
      if (p.state === 2 && p.card.scheduledDays >= 21) counts.mature++;
      if (p.state !== 0 && (!soonest || p.dueAt < soonest.dueAt)) soonest = p;
    }
    const since = dayStart - 7 * 52 * DAY;
    const reviews = await ctx.db.query("reviews").withIndex("by_user_time", (q) => q.eq("userId", user._id).gte("reviewedAt", since)).collect();
    // Bucket by local day index (days since epoch in local time).
    // Study days roll over at 4 am local, like the practice queue.
    const localDay = (t: number) => Math.floor((t - tzOffsetMin * 60_000 - 4 * 3_600_000) / DAY);
    const perDay: Record<number, number> = {};
    for (const r of reviews) perDay[localDay(r.reviewedAt)] = (perDay[localDay(r.reviewedAt)] ?? 0) + 1;
    const today = localDay(now);
    let streak = 0;
    for (let d = perDay[today] ? today : today - 1; perDay[d]; d--) streak++;
    const month = reviews.filter((r) => r.reviewedAt >= now - 30 * DAY && r.stateBefore === 2);
    const retention = month.length ? month.filter((r) => r.grade > 1).length / month.length : null;
    const todays = reviews.filter((r) => localDay(r.reviewedAt) === today);
    return {
      counts,
      soonest: soonest ? { fen: soonest.fen, solver: soonest.solver, dueAt: soonest.dueAt } : null,
      bySource,
      streak,
      retention,
      retentionSample: month.length,
      today: { reviews: todays.length, timeMs: todays.reduce((s, r) => s + r.durationMs, 0), correct: todays.filter((r) => r.grade > 1).length },
      perDay: Object.entries(perDay).map(([d, n]) => ({ day: Number(d), n })),
      todayIndex: today,
      totalReviews: reviews.length,
    };
  },
});

/**
 * What kinds of puzzles you miss. Recall counts only reviews of cards that were due for review
 * (not learning steps), over your most recent reviews.
 */
export const patterns = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const puzzles = await ctx.db.query("puzzles").withIndex("by_user_created", (q) => q.eq("userId", user._id)).collect();
    const reviews = await ctx.db.query("reviews").withIndex("by_user_time", (q) => q.eq("userId", user._id)).order("desc").take(5000);
    const byPuzzle = new Map(puzzles.map((p) => [p._id, p]));
    const groupsOf = (p: (typeof puzzles)[number]) => [...p.tags, `source:${p.source === "manual" ? "manual" : "games"}`];

    type Group = { puzzles: number; reviews: number; misses: number; solveMs: number; solves: number };
    const groups = new Map<string, Group>();
    const group = (k: string) => groups.get(k) ?? (groups.set(k, { puzzles: 0, reviews: 0, misses: 0, solveMs: 0, solves: 0 }), groups.get(k)!);
    for (const p of puzzles) for (const k of groupsOf(p)) group(k).puzzles++;
    let counted = 0, missed = 0;
    for (const r of reviews) {
      const p = byPuzzle.get(r.puzzleId);
      if (!p || r.stateBefore !== 2) continue;
      counted++;
      if (r.grade === 1) missed++;
      for (const k of groupsOf(p)) {
        const g = group(k);
        g.reviews++;
        if (r.grade === 1) g.misses++;
        else if (!r.revealed && r.durationMs > 0) { g.solveMs += r.durationMs; g.solves++; }
      }
    }

    // Where mistakes in your own games happen.
    const mined = puzzles.filter((p) => p.game);
    const count = (f: (p: (typeof mined)[number]) => string) =>
      Object.entries(mined.reduce<Record<string, number>>((m, p) => ((m[f(p)] = (m[f(p)] ?? 0) + 1), m), {})).map(([key, n]) => ({ key, n }));

    const leeches = puzzles
      .filter((p) => !p.suspended && p.card.lapses >= 3)
      .sort((a, b) => b.card.lapses - a.card.lapses)
      .slice(0, 8)
      .map((p) => ({ _id: p._id, fen: p.fen, solver: p.solver, lapses: p.card.lapses, label: p.game ? `vs ${p.solver === "w" ? p.game.black : p.game.white}, ${p.game.moveLabel}` : p.title ?? null }));

    return {
      reviews: counted,
      recall: counted ? 1 - missed / counted : null,
      groups: [...groups.entries()].map(([key, g]) => ({ key, ...g, avgSolveMs: g.solves ? g.solveMs / g.solves : null })),
      games: {
        total: mined.length,
        byPhase: count((p) => p.tags.find((t) => ["opening", "middlegame", "endgame"].includes(t)) ?? "unknown"),
        byTimeClass: count((p) => p.game!.timeClass || "unknown"),
        timeTrouble: mined.filter((p) => p.tags.includes("time-trouble")).length,
      },
      leeches,
    };
  },
});

/** The last clean solve of a puzzle (no miss, hint or peeking), for "faster than last time". */
export const lastSolve = query({
  args: { puzzleId: v.id("puzzles") },
  handler: async (ctx, { puzzleId }) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const recent = await ctx.db.query("reviews").withIndex("by_puzzle", (q) => q.eq("puzzleId", puzzleId)).order("desc").take(20);
    const r = recent.find((x) => x.userId === user._id && x.grade > 1 && !x.revealed && x.mistakes === 0 && x.hints === 0 && x.durationMs > 0);
    return r ? { ms: r.durationMs, at: r.reviewedAt } : null;
  },
});
