import { mutation, query, type QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser, currentUser } from "./auth";

export const DEFAULTS = {
  desiredRetention: 0.9,
  newPerDay: 15,
  boardTheme: "walnut",
  pieceSet: "cburnett",
  sound: true,
  autoNext: false,
};

export type Settings = Omit<Doc<"settings">, "_id" | "_creationTime" | "userId">;

export async function settingsFor(ctx: QueryCtx, userId: Id<"users">): Promise<Settings> {
  const s = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", userId)).first();
  if (!s) return { ...DEFAULTS };
  const { _id, _creationTime, userId: _u, ...rest } = s;
  return { ...DEFAULTS, ...rest };
}

export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    return user ? settingsFor(ctx, user._id) : null;
  },
});

export const update = mutation({
  args: {
    chesscomUsername: v.optional(v.string()),
    lichessUsername: v.optional(v.string()),
    desiredRetention: v.optional(v.number()),
    newPerDay: v.optional(v.number()),
    boardTheme: v.optional(v.string()),
    pieceSet: v.optional(v.string()),
    sound: v.optional(v.boolean()),
    autoNext: v.optional(v.boolean()),
  },
  handler: async (ctx, patch) => {
    const user = await requireUser(ctx);
    if (patch.desiredRetention !== undefined) patch.desiredRetention = Math.min(0.97, Math.max(0.7, patch.desiredRetention));
    if (patch.newPerDay !== undefined) patch.newPerDay = Math.min(500, Math.max(0, Math.round(patch.newPerDay)));
    for (const k of ["chesscomUsername", "lichessUsername"] as const) if (patch[k] !== undefined) patch[k] = patch[k]!.trim();
    const existing = await ctx.db.query("settings").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    if (existing) await ctx.db.patch(existing._id, patch);
    else await ctx.db.insert("settings", { ...DEFAULTS, ...patch, userId: user._id });
  },
});
