// Bulk import from Anki (scripts/import-anki.ts). Internal: run from the CLI with the deploy key.
import { internalMutation } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { card } from "./schema";
import { emailAllowed, normalizeEmail } from "./allowlist";
import { insertPuzzle, puzzleInput } from "./puzzles";

const review = v.object({
  grade: v.number(),
  reviewedAt: v.number(),
  durationMs: v.number(),
  mistakes: v.number(),
  stateBefore: v.number(),
  cardBefore: card,
  scheduledDays: v.number(),
});

export const importBatch = internalMutation({
  args: {
    email: v.string(),
    items: v.array(v.object({ input: puzzleInput, createdAt: v.number(), suspended: v.boolean(), card, reviews: v.array(review) })),
  },
  handler: async (ctx, { email, items }) => {
    email = normalizeEmail(email);
    if (!(await emailAllowed(ctx, email))) throw new ConvexError(`${email} is not on the allowlist`);
    // The user may not have signed in yet; Google sign-in later links to this row by email.
    const user = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).first();
    const userId = user?._id ?? (await ctx.db.insert("users", { email }));
    let added = 0, duplicates = 0;
    for (const it of items) {
      const puzzleId = await insertPuzzle(ctx, userId, it.input, it.createdAt, {
        card: it.card,
        suspended: it.suspended,
        introducedAt: it.card.state === 0 ? null : (it.reviews.filter((r) => r.stateBefore === 0).at(-1)?.reviewedAt ?? it.card.lastReviewAt),
      });
      if (!puzzleId) {
        duplicates++;
        continue;
      }
      added++;
      for (const r of it.reviews) await ctx.db.insert("reviews", { ...r, userId, puzzleId, hints: 0, revealed: false });
    }
    return { added, duplicates };
  },
});
