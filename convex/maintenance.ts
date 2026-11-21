// One-off data jobs, run from the CLI:
//   npx convex run --prod maintenance:retag '{}'   (repeat with the returned cursor until done)
//   npx convex run --prod maintenance:backfillSync '{}'   (same)
import { internalMutation } from "./_generated/server";
import { v } from "convex/values";
import { motifTags, withAutoTags } from "../lib/motifs";

/** Recompute the automatic motif and phase tags of every puzzle, a page at a time. */
export const retag = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("puzzles").paginate({ cursor: cursor ?? null, numItems: 200 });
    let changed = 0;
    for (const p of page.page) {
      const tags = [...new Set(withAutoTags(p.tags, motifTags(p.fen, p.moves, p.solver)).map((t) => t.toLowerCase()))].slice(0, 20);
      if (tags.join() !== p.tags.join()) {
        await ctx.db.patch(p._id, { tags, updatedAt: Date.now() });
        changed++;
      }
    }
    return { changed, scanned: page.page.length, cursor: page.isDone ? null : page.continueCursor };
  },
});

/**
 * Fill updatedAt and introducedAt on rows written before offline sync existed (repeat with the
 * returned cursor until it is null). introducedAt is the latest review that took the puzzle out of New.
 */
export const backfillSync = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db.query("puzzles").paginate({ cursor: cursor ?? null, numItems: 100 });
    let changed = 0;
    for (const p of page.page) {
      if (p.updatedAt !== undefined && p.introducedAt !== undefined) continue;
      const reviews = await ctx.db.query("reviews").withIndex("by_puzzle", (q) => q.eq("puzzleId", p._id)).order("desc").collect();
      const intro = p.card.state === 0 ? null : (reviews.find((r) => r.stateBefore === 0)?.reviewedAt ?? p.card.lastReviewAt ?? null);
      await ctx.db.patch(p._id, { updatedAt: p.updatedAt ?? Date.now(), introducedAt: p.introducedAt ?? intro });
      changed++;
    }
    return { changed, scanned: page.page.length, cursor: page.isDone ? null : page.continueCursor };
  },
});
