import { convexAuth, getAuthUserId } from "@convex-dev/auth/server";
import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { emailAllowed, normalizeEmail } from "./allowlist";

// The app build type-checks this file too (through the generated api) without Node types.
declare const process: { env: Record<string, string | undefined> };

export const NOT_ALLOWED = "not-allowed";
/** The Android app's deep link; `android/app/src/main/AndroidManifest.xml` routes it back to the app. */
const MOBILE_REDIRECT = "chessfsrs://auth";
/**
 * Password sign-in exists only for the browser tests on the dev deployment
 * (`npx convex env set ENABLE_PASSWORD_LOGIN true`), and only for test addresses, so nobody can
 * claim a real email with a password there.
 */
const PASSWORD_DOMAIN = "@chessfsrs.local";
const passwordLogin = process.env.ENABLE_PASSWORD_LOGIN === "true";

function siteUrl() {
  const url = process.env.SITE_URL?.replace(/\/$/, "");
  if (!url) throw new Error("Missing environment variable SITE_URL");
  return url;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Google,
    ...(passwordLogin
      ? [Password({ profile: (params) => ({ email: normalizeEmail(String(params.email ?? "")) }) })]
      : []),
  ],
  callbacks: {
    async redirect({ redirectTo }) {
      const site = siteUrl();
      if (redirectTo.startsWith("?") || redirectTo.startsWith("/")) return `${site}${redirectTo}`;
      if (redirectTo.startsWith(site) && [undefined, "?", "/", "#"].includes(redirectTo[site.length])) return redirectTo;
      if (redirectTo === MOBILE_REDIRECT || redirectTo.startsWith(`${MOBILE_REDIRECT}?`)) return redirectTo;
      throw new Error(`Invalid redirectTo ${redirectTo} for SITE_URL ${site}`);
    },
    // Google accounts are created for anyone (throwing here would only bounce them back to the
    // sign-in page with no explanation); the allowlist is enforced when a session is created.
    async createOrUpdateUser(ctx, { existingUserId, profile, provider }) {
      if (existingUserId) return existingUserId;
      const email = normalizeEmail(String(profile.email ?? ""));
      const qctx = ctx as unknown as QueryCtx;
      if (provider.id === "password" && !(email.endsWith(PASSWORD_DOMAIN) && (await emailAllowed(qctx, email))))
        throw new ConvexError(NOT_ALLOWED);
      const existing = email ? await qctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first() : null;
      if (existing) return existing._id;
      const name = typeof profile.name === "string" ? profile.name : undefined;
      const image = typeof profile.image === "string" ? profile.image : undefined;
      return await (ctx as unknown as MutationCtx).db.insert("users", { email, name, image });
    },
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
