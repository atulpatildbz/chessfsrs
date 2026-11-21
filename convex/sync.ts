// Offline sync: the client keeps a copy of the library and pulls the rows changed since its cursor.
import { query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { currentUser } from "./auth";

/**
 * Mutations can commit in a different order than their Date.now() stamps, so each pull re-reads this
 * much before the cursor. Merging is idempotent, and the result stays the same while nothing changes,
 * so the subscription doesn't churn.
 */
export const OVERLAP = 60_000;

const lean = (p: Doc<"puzzles">) => ({
  _id: p._id,
  fen: p.fen,
  moves: p.moves,
  solver: p.solver,
  source: p.source,
  title: p.title,
  notes: p.notes,
  tags: p.tags,
  game: p.game,
  suspended: p.suspended,
  createdAt: p.createdAt,
  card: p.card,
  introducedAt: p.introducedAt ?? null,
  updatedAt: p.updatedAt ?? 0,
});
export type SyncedPuzzle = ReturnType<typeof lean>;

export const pull = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    // First sync: every row, including any not yet given an updatedAt.
    const from = since - OVERLAP;
    const puzzles = await ctx.db
      .query("puzzles")
      .withIndex("by_user_updated", (q) => (since > 0 ? q.eq("userId", user._id).gt("updatedAt", from) : q.eq("userId", user._id)))
      .collect();
    const deleted = since > 0
      ? await ctx.db.query("tombstones").withIndex("by_user_time", (q) => q.eq("userId", user._id).gt("deletedAt", from)).collect()
      : [];
    return {
      userId: user._id,
      puzzles: puzzles.map(lean),
      deleted: deleted.map((d) => ({ id: d.puzzleId, at: d.deletedAt })),
    };
  },
});
