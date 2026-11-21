import { mutation, query, type MutationCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser, currentUser } from "./auth";
import { color, gameInfo, source } from "./schema";
import { dedupeKey, validateLine } from "../lib/puzzle";
import { motifTags, withAutoTags } from "../lib/motifs";
import { newCard, type StoredCard } from "../lib/fsrs";

export const puzzleInput = v.object({
  fen: v.string(),
  moves: v.array(v.string()),
  solver: color,
  source,
  pgn: v.string(),
  title: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  game: v.optional(gameInfo),
});

type Input = typeof puzzleInput.type;

/** Insert unless the same position + line already exists. Returns the new id or null for a duplicate. */
export async function insertPuzzle(ctx: MutationCtx, userId: Id<"users">, p: Input, now: number, keep?: { card: StoredCard; suspended: boolean; introducedAt: number | null }) {
  const err = validateLine(p);
  if (err) throw new ConvexError(`Invalid puzzle: ${err}`);
  const key = dedupeKey(p);
  const dup = await ctx.db.query("puzzles").withIndex("by_user_key", (q) => q.eq("userId", userId).eq("dedupeKey", key)).first();
  if (dup) return null;
  const card = keep?.card ?? newCard(now);
  return await ctx.db.insert("puzzles", {
    userId,
    fen: p.fen,
    moves: p.moves,
    solver: p.solver,
    source: p.source,
    pgn: p.pgn.slice(0, 20_000),
    title: p.title?.slice(0, 200),
    notes: p.notes?.slice(0, 5_000),
    tags: normTags(withAutoTags(p.tags ?? [], motifTags(p.fen, p.moves, p.solver))),
    game: p.game,
    dedupeKey: key,
    suspended: keep?.suspended ?? false,
    createdAt: now,
    card,
    state: card.state,
    dueAt: card.dueAt,
    updatedAt: Date.now(),
    introducedAt: keep?.introducedAt ?? null,
  });
}

const normTags = (tags: string[]) => [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);

export const add = mutation({
  args: { items: v.array(puzzleInput) },
  handler: async (ctx, { items }) => {
    const user = await requireUser(ctx);
    if (items.length > 200) throw new ConvexError("Add at most 200 puzzles at a time.");
    const now = Date.now();
    let added = 0, duplicates = 0;
    const ids: Id<"puzzles">[] = [];
    for (const [i, p] of items.entries()) {
      // Keep insertion order stable for new-card ordering.
      const id = await insertPuzzle(ctx, user._id, p, now + i);
      if (id) { added++; ids.push(id); } else duplicates++;
    }
    return { added, duplicates, ids };
  },
});

async function own(ctx: MutationCtx, id: Id<"puzzles">) {
  const user = await requireUser(ctx);
  const p = await ctx.db.get(id);
  if (!p || p.userId !== user._id) throw new ConvexError("Puzzle not found");
  return p;
}

export const get = query({
  args: { id: v.id("puzzles") },
  handler: async (ctx, { id }) => {
    const user = await currentUser(ctx);
    const p = await ctx.db.get(id);
    if (!user || !p || p.userId !== user._id) return null;
    const history = await ctx.db.query("reviews").withIndex("by_puzzle", (q) => q.eq("puzzleId", id)).order("desc").take(50);
    return { ...p, history: history.map((r) => ({ grade: r.grade, reviewedAt: r.reviewedAt, durationMs: r.durationMs, mistakes: r.mistakes })) };
  },
});

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    source: v.optional(source),
    state: v.optional(v.union(v.literal("new"), v.literal("learning"), v.literal("review"), v.literal("suspended"))),
    search: v.optional(v.string()),
  },
  handler: async (ctx, { paginationOpts, source, state, search }) => {
    const user = await currentUser(ctx);
    if (!user) return { page: [], isDone: true, continueCursor: "" };
    const needle = search?.trim().toLowerCase();
    let q = ctx.db.query("puzzles").withIndex("by_user_created", (q) => q.eq("userId", user._id)).order("desc");
    if (state && state !== "suspended") q = q.filter((f) => f.eq(f.field("suspended"), false));
    if (source) q = q.filter((f) => f.eq(f.field("source"), source));
    if (state === "suspended") q = q.filter((f) => f.eq(f.field("suspended"), true));
    else if (state === "new") q = q.filter((f) => f.eq(f.field("state"), 0));
    else if (state === "learning") q = q.filter((f) => f.or(f.eq(f.field("state"), 1), f.eq(f.field("state"), 3)));
    else if (state === "review") q = q.filter((f) => f.eq(f.field("state"), 2));
    if (needle) {
      // Search the whole library (a personal collection: hundreds to a few thousand rows), not one page.
      const all = await q.collect();
      const hits = all.filter((p) => [p.title, p.notes, p.tags.join(" "), p.game?.white, p.game?.black, p.game?.moveLabel].join(" ").toLowerCase().includes(needle));
      return { page: hits.slice(0, 200).map(summary), isDone: true, continueCursor: "" };
    }
    const res = await q.paginate(paginationOpts);
    return { ...res, page: res.page.map(summary) };
  },
});

const summary = (p: Doc<"puzzles">) => ({
  _id: p._id,
  fen: p.fen,
  moves: p.moves,
  solver: p.solver,
  source: p.source,
  title: p.title,
  tags: p.tags,
  suspended: p.suspended,
  state: p.state,
  dueAt: p.dueAt,
  lapses: p.card.lapses,
  reps: p.card.reps,
  createdAt: p.createdAt,
  game: p.game ? { moveLabel: p.game.moveLabel, white: p.game.white, black: p.game.black, playedAt: p.game.playedAt } : undefined,
});

export const update = mutation({
  args: {
    id: v.id("puzzles"),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    solver: v.optional(color),
    suspended: v.optional(v.boolean()),
  },
  handler: async (ctx, { id, ...patch }) => {
    const p = await own(ctx, id);
    if (patch.solver && patch.solver !== p.solver) {
      const err = validateLine({ fen: p.fen, moves: p.moves, solver: patch.solver });
      if (err) throw new ConvexError(err);
    }
    // Only send fields that were given: an explicit undefined would delete the field.
    const { tags, ...rest } = patch;
    await ctx.db.patch(id, { ...(tags !== undefined ? { ...rest, tags: normTags(tags) } : rest), updatedAt: Date.now() });
  },
});

export const reset = mutation({
  args: { id: v.id("puzzles") },
  handler: async (ctx, { id }) => {
    await own(ctx, id);
    const now = Date.now();
    const card = newCard(now);
    await ctx.db.patch(id, { card, state: card.state, dueAt: card.dueAt, introducedAt: null, updatedAt: now });
  },
});

export const remove = mutation({
  args: { id: v.id("puzzles") },
  handler: async (ctx, { id }) => {
    const p = await own(ctx, id);
    for (const r of await ctx.db.query("reviews").withIndex("by_puzzle", (q) => q.eq("puzzleId", id)).collect()) await ctx.db.delete(r._id);
    await ctx.db.delete(id);
    await ctx.db.insert("tombstones", { userId: p.userId, puzzleId: id, deletedAt: Date.now() });
  },
});
