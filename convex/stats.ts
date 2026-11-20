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
    const localDay = (t: number) => Math.floor((t - tzOffsetMin * 60_000) / DAY);
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
