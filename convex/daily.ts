// The daily mining job (scripts/mine-daily.ts, run by .github/workflows/mine.yml) talks to these
// with the deploy key. Internal only.
import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { allowedUserById } from "./auth";
import { puzzleInput } from "./puzzles";
import { recordAnalysis, site } from "./games";

/**
 * Everyone with a chess.com or lichess username in Settings, and the games they had scanned since
 * `since`: a game played after `since` can only have been scanned after it too, so older entries
 * can't matter and the list stays short.
 */
export const targets = internalQuery({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const out = [];
    for (const s of await ctx.db.query("settings").collect()) {
      if (!s.chesscomUsername && !s.lichessUsername) continue;
      if (!(await allowedUserById(ctx, s.userId))) continue;
      const analyzed = await ctx.db.query("analyzedGames").withIndex("by_user_site", (q) => q.eq("userId", s.userId)).collect();
      out.push({
        userId: s.userId,
        chesscom: s.chesscomUsername || null,
        lichess: s.lichessUsername || null,
        analyzed: analyzed.filter((a) => a.analyzedAt >= since).map((a) => `${a.site}:${a.gameId}`),
      });
    }
    return out;
  },
});

export const save = internalMutation({
  args: { userId: v.id("users"), games: v.array(v.object({ site, gameId: v.string(), puzzles: v.array(puzzleInput) })) },
  handler: async (ctx, { userId, games }) => {
    if (!(await allowedUserById(ctx, userId))) throw new Error("User is not allowlisted");
    let added = 0;
    for (const g of games) added += await recordAnalysis(ctx, userId, g.site, g.gameId, g.puzzles);
    return { added };
  },
});
