import { convexAuth, getAuthUserId, modifyAccountCredentials, invalidateSessions } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { emailAllowed, normalizeEmail } from "./allowlist";

export const NOT_ALLOWED = "not-allowed";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile: (params) => ({ email: normalizeEmail(String(params.email ?? "")) }),
      validatePasswordRequirements: (pw) => {
        if (pw.length < 8) throw new ConvexError("Use at least 8 characters.");
      },
    }),
  ],
  callbacks: {
    // Accounts are only created for allowlisted emails, so sign-up attempts leave nothing behind.
    async createOrUpdateUser(ctx, { existingUserId, profile }) {
      if (existingUserId) return existingUserId;
      const email = normalizeEmail(String(profile.email ?? ""));
      const qctx = ctx as unknown as QueryCtx;
      if (!(await emailAllowed(qctx, email))) throw new ConvexError(NOT_ALLOWED);
      const existing = await qctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
      if (existing) return existing._id;
      return await (ctx as unknown as MutationCtx).db.insert("users", { email });
    },
    // And sessions only for emails that are still allowlisted.
    async beforeSessionCreation(ctx, { userId }) {
      if (!(await allowedUserById(ctx as unknown as QueryCtx, userId))) throw new ConvexError(NOT_ALLOWED);
    },
  },
});

export async function allowedUserById(ctx: QueryCtx, userId: Id<"users">) {
  const user = await ctx.db.get(userId);
  return user && (await emailAllowed(ctx, user.email)) ? user : null;
}

/** The signed-in user if still allowlisted, else null. */
export async function currentUser(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx);
  return userId ? allowedUserById(ctx, userId) : null;
}

export async function requireUser(ctx: QueryCtx) {
  const user = await currentUser(ctx);
  if (!user) throw new ConvexError("not-signed-in");
  return user;
}

/**
 * Forgotten password (there is no email-based reset):
 *   npx convex run --prod auth:setPassword '{"email":"you@example.com","password":"new-password"}'
 */
export const setPassword = internalAction({
  args: { email: v.string(), password: v.string() },
  handler: async (ctx, { email, password }) => {
    if (password.length < 8) throw new Error("Use at least 8 characters.");
    const userId = await ctx.runQuery(internal.users.idByEmail, { email: normalizeEmail(email) });
    if (!userId) throw new Error("No account with that email");
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: normalizeEmail(email), secret: password } });
    await invalidateSessions(ctx, { userId });
    return "ok";
  },
});
