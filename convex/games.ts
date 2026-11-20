import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser, currentUser } from "./auth";
import { puzzleInput, insertPuzzle } from "./puzzles";

const site = v.union(v.literal("chesscom"), v.literal("lichess"));

/** Ids of games already analysed, so a scan only looks at new ones. */
export const analyzedIds = query({
  args: { site },
  handler: async (ctx, { site }) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const rows = await ctx.db.query("analyzedGames").withIndex("by_user_site", (q) => q.eq("userId", user._id).eq("site", site)).collect();
    return rows.map((r) => r.gameId);
  },
});

/** Save one analysed game and the puzzles found in it, atomically. */
export const saveAnalysis = mutation({
  args: { site, gameId: v.string(), puzzles: v.array(puzzleInput) },
  handler: async (ctx, { site, gameId, puzzles }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db
      .query("analyzedGames")
      .withIndex("by_user_site", (q) => q.eq("userId", user._id).eq("site", site).eq("gameId", gameId))
      .first();
    const now = Date.now();
    let added = 0;
    for (const [i, p] of puzzles.entries()) if (await insertPuzzle(ctx, user._id, p, now + i)) added++;
    if (existing) await ctx.db.patch(existing._id, { analyzedAt: now, puzzlesFound: existing.puzzlesFound + added });
    else await ctx.db.insert("analyzedGames", { userId: user._id, site, gameId, analyzedAt: now, puzzlesFound: added });
    return { added };
  },
});

export const forgetAnalyzed = mutation({
  args: { site },
  handler: async (ctx, { site }) => {
    const user = await requireUser(ctx);
    const rows = await ctx.db.query("analyzedGames").withIndex("by_user_site", (q) => q.eq("userId", user._id).eq("site", site)).collect();
    for (const r of rows) await ctx.db.delete(r._id);
    return rows.length;
  },
});
