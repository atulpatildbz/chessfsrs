import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { requireUser, currentUser } from "./auth";
import { settingsFor } from "./settings";
import { review as fsrsReview, type Grade } from "../lib/fsrs";

const DAY = 86_400_000;

const forPractice = (p: Doc<"puzzles">) => ({
  _id: p._id,
  fen: p.fen,
  moves: p.moves,
  solver: p.solver,
  source: p.source,
  title: p.title,
  notes: p.notes,
  tags: p.tags,
  game: p.game,
  card: p.card,
  state: p.state,
  dueAt: p.dueAt,
});
export type PracticePuzzle = ReturnType<typeof forPractice>;

/**
 * What to practise now. `now` and `dayStart` (local midnight) come from the client so the query
 * stays cacheable and "today" follows the user's timezone.
 * - due: learning/relearning first, then reviews, both oldest-due first
 * - fresh: new puzzles, within what's left of today's new-puzzle allowance
 * - nextAt: when the next not-yet-due learning card comes due today (to show a countdown)
 */
export const queue = query({
  args: { now: v.number(), dayStart: v.number(), limit: v.optional(v.number()) },
  handler: async (ctx, { now, dayStart, limit = 100 }) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const s = await settingsFor(ctx, user._id);
    const byState = (state: number) =>
      ctx.db.query("puzzles").withIndex("by_user_queue", (q) => q.eq("userId", user._id).eq("suspended", false).eq("state", state).lte("dueAt", now));
    const learning = [...(await byState(1).take(limit)), ...(await byState(3).take(limit))].sort((a, b) => a.dueAt - b.dueAt);
    const reviews = await byState(2).take(limit);
    const introducedToday = (
      await ctx.db.query("reviews").withIndex("by_user_time", (q) => q.eq("userId", user._id).gte("reviewedAt", dayStart)).collect()
    ).filter((r) => r.stateBefore === 0).length;
    const newLeft = Math.max(0, s.newPerDay - introducedToday);
    const fresh = newLeft ? await byState(0).take(Math.min(newLeft, limit)) : [];
    const upcoming = await ctx.db
      .query("puzzles")
      .withIndex("by_user_due", (q) => q.eq("userId", user._id).eq("suspended", false).gt("dueAt", now).lt("dueAt", dayStart + DAY))
      .filter((f) => f.neq(f.field("state"), 0))
      .first();
    return {
      due: [...learning, ...reviews].map(forPractice),
      fresh: fresh.map(forPractice),
      newLeft,
      introducedToday,
      nextAt: upcoming?.dueAt ?? null,
      desiredRetention: s.desiredRetention,
    };
  },
});

export const review = mutation({
  args: {
    id: v.id("puzzles"),
    grade: v.number(),
    durationMs: v.number(),
    mistakes: v.number(),
    hints: v.number(),
    revealed: v.boolean(),
  },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    const p = await ctx.db.get(a.id);
    if (!p || p.userId !== user._id) throw new ConvexError("Puzzle not found");
    if (![1, 2, 3, 4].includes(a.grade)) throw new ConvexError("Bad grade");
    const s = await settingsFor(ctx, user._id);
    const now = Date.now();
    const card = fsrsReview(p.card, p._id, a.grade as Grade, now, s.desiredRetention);
    await ctx.db.patch(p._id, { card, state: card.state, dueAt: card.dueAt });
    const reviewId = await ctx.db.insert("reviews", {
      userId: user._id,
      puzzleId: p._id,
      grade: a.grade,
      reviewedAt: now,
      durationMs: Math.max(0, Math.min(a.durationMs, 3_600_000)),
      mistakes: a.mistakes,
      hints: a.hints,
      revealed: a.revealed,
      stateBefore: p.card.state,
      cardBefore: p.card,
      scheduledDays: card.scheduledDays,
    });
    return { reviewId, dueAt: card.dueAt, state: card.state };
  },
});

/** Undo a review: restore the card and drop the log entry. */
export const undo = mutation({
  args: { reviewId: v.id("reviews") },
  handler: async (ctx, { reviewId }) => {
    const user = await requireUser(ctx);
    const r = await ctx.db.get(reviewId);
    if (!r || r.userId !== user._id) throw new ConvexError("Review not found");
    const p = await ctx.db.get(r.puzzleId);
    if (p) await ctx.db.patch(p._id, { card: r.cardBefore, state: r.cardBefore.state, dueAt: r.cardBefore.dueAt });
    await ctx.db.delete(reviewId);
    return r.puzzleId;
  },
});
