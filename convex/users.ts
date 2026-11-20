import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { currentUser } from "./auth";

/** null = not signed in; { allowed: false } = signed in but not (or no longer) allowlisted. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const id = await getAuthUserId(ctx);
    if (!id) return null;
    const user = await currentUser(ctx);
    return user ? { allowed: true as const, id: user._id, email: user.email ?? "" } : { allowed: false as const };
  },
});

export const idByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) =>
    (await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first())?._id ?? null,
});
