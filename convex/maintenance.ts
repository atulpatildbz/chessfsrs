// One-off data jobs, run from the CLI:
//   npx convex run --prod maintenance:retag '{}'   (repeat with the returned cursor until done)
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
        await ctx.db.patch(p._id, { tags });
        changed++;
      }
    }
    return { changed, scanned: page.page.length, cursor: page.isDone ? null : page.continueCursor };
  },
});
