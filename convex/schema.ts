import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";

export const card = v.object({
  stability: v.number(),
  stabilityFast: v.number(),
  difficulty: v.number(),
  state: v.number(),
  dueAt: v.number(),
  lastReviewAt: v.union(v.number(), v.null()),
  reps: v.number(),
  lapses: v.number(),
  scheduledDays: v.number(),
  learningStep: v.number(),
});

export const source = v.union(v.literal("manual"), v.literal("chesscom"), v.literal("lichess"));
export const color = v.union(v.literal("w"), v.literal("b"));

export const gameInfo = v.object({
  url: v.string(),
  white: v.string(),
  black: v.string(),
  timeClass: v.string(),
  playedAt: v.number(),
  moveLabel: v.string(),
  playedSan: v.string(),
  bestSan: v.string(),
  evalBefore: v.number(),
  evalBest: v.number(),
  evalPlayed: v.number(),
  mate: v.union(v.number(), v.null()),
});

export default defineSchema({
  ...authTables,

  allowedEmails: defineTable({ email: v.string(), createdAt: v.number() }).index("by_email", ["email"]),

  settings: defineTable({
    userId: v.id("users"),
    chesscomUsername: v.optional(v.string()),
    lichessUsername: v.optional(v.string()),
    desiredRetention: v.number(),
    newPerDay: v.number(),
    boardTheme: v.string(),
    pieceSet: v.string(),
    sound: v.boolean(),
    autoNext: v.boolean(),
  }).index("by_user", ["userId"]),

  puzzles: defineTable({
    userId: v.id("users"),
    fen: v.string(),
    moves: v.array(v.string()),
    solver: color,
    source,
    pgn: v.string(),
    title: v.optional(v.string()),
    notes: v.optional(v.string()),
    tags: v.array(v.string()),
    game: v.optional(gameInfo),
    dedupeKey: v.string(),
    suspended: v.boolean(),
    createdAt: v.number(),
    card,
    // Copies of card.state / card.dueAt for indexes.
    state: v.number(),
    dueAt: v.number(),
  })
    .index("by_user_queue", ["userId", "suspended", "state", "dueAt"])
    .index("by_user_due", ["userId", "suspended", "dueAt"])
    .index("by_user_key", ["userId", "dedupeKey"])
    .index("by_user_created", ["userId", "createdAt"]),

  reviews: defineTable({
    userId: v.id("users"),
    puzzleId: v.id("puzzles"),
    grade: v.number(),
    reviewedAt: v.number(),
    durationMs: v.number(),
    mistakes: v.number(),
    hints: v.number(),
    revealed: v.boolean(),
    stateBefore: v.number(),
    cardBefore: card,
    scheduledDays: v.number(),
  })
    .index("by_user_time", ["userId", "reviewedAt"])
    .index("by_puzzle", ["puzzleId", "reviewedAt"]),

  analyzedGames: defineTable({
    userId: v.id("users"),
    site: v.union(v.literal("chesscom"), v.literal("lichess")),
    gameId: v.string(),
    analyzedAt: v.number(),
    puzzlesFound: v.number(),
  }).index("by_user_site", ["userId", "site", "gameId"]),
});
