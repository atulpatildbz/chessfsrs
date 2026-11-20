// Turn Anki chess notes (any note type with a "PGN" field: "Chess 2.0", AnkiChess) into puzzles,
// and their Anki review history into an FSRS card, by replaying it through our scheduler.
import { MATE } from "./mining";
import { newCard, review, type Grade, type StoredCard } from "./fsrs";
import { parsePuzzle, validateLine, type Color } from "./puzzle";

export type AnkiReview = { id: number; ease: number; type: number; ivl: number; time: number };
export type GameInfo = {
  url: string; white: string; black: string; timeClass: string; playedAt: number; moveLabel: string;
  playedSan: string; bestSan: string; evalBefore: number; evalBest: number; evalPlayed: number; mate: number | null;
};
export type PuzzleInput = {
  fen: string; moves: string[]; solver: Color; source: "manual" | "chesscom" | "lichess";
  pgn: string; title?: string; tags: string[]; game?: GameInfo;
};
export type ImportedReview = {
  grade: number; reviewedAt: number; durationMs: number; mistakes: number;
  stateBefore: number; cardBefore: StoredCard; scheduledDays: number;
};

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>|<\/div>|<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCharCode(Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m))
    .replace(/\r/g, "")
    .trim();
}

/** "+1.62" → 162, "-M" / "-M3" → −MATE (user's view, as AnkiChess writes them). */
function evalCp(s: string): number {
  const m = /^([+-]?)M(\d*)$/.exec(s);
  if (m) return m[1] === "-" ? -MATE : MATE;
  return Math.round(Number(s) * 100);
}

/** "Chess::puzzle" → "puzzle"; AnkiChess' per-note hash tags are dropped. */
function tagsFrom(tags: string[]) {
  const out = tags.filter((t) => !/^chess-puzzle-[0-9a-f]+$/i.test(t)).map((t) => t.split("::").pop()!.toLowerCase());
  return [...new Set(["anki", ...out.map((t) => (t === "mygames" ? "my-games" : t))])];
}

export function noteToPuzzle(fields: string[], tags: string[]): { ok: true; puzzle: PuzzleInput } | { ok: false; error: string } {
  const text = htmlToText(fields[0] ?? "");
  const parsed = parsePuzzle(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const p = parsed.puzzle;
  const err = validateLine(p);
  if (err) return { ok: false, error: err };
  const site = p.site ?? "";
  const source = /chess\.com\/game/.test(site) ? "chesscom" : /lichess\.org/.test(site) ? "lichess" : "manual";
  const puzzle: PuzzleInput = { fen: p.fen, moves: p.moves, solver: p.solver, source, pgn: text, title: p.title, tags: tagsFrom(tags) };
  const game = source === "manual" ? null : gameFrom(text, htmlToText(fields[1] ?? ""), site);
  if (game) puzzle.game = game;
  return { ok: true, puzzle };
}

/** AnkiChess' mistake cards: "{… You played Nxe5 instead … Best: Nd4 → +4.48}" plus an info field. */
function gameFrom(pgn: string, info: string, url: string): GameInfo | null {
  const comment = /You played (\S+) instead.*?Best: (\S+) → ([+-]?(?:M\d*|[\d.]+))/.exec(pgn);
  const evals = /Eval before: (\S+).*?After best: (\S+).*?After played: (\S+)/s.exec(info);
  const move = /Move: (\d+\.(?:\.\.)? \S+)/.exec(info);
  const header = (k: string) => new RegExp(`\\[${k} "([^"]*)"\\]`).exec(pgn)?.[1] ?? "";
  if (!comment || !evals || !move) return null;
  const [y, m, d] = header("Date").split(".").map(Number);
  const best = /^[+-]?M(\d+)$/.exec(evals[2]);
  return {
    url, white: header("White"), black: header("Black"), timeClass: "",
    playedAt: y && m && d ? Date.UTC(y, m - 1, d) : 0,
    moveLabel: move[1], playedSan: comment[1], bestSan: comment[2],
    evalBefore: evalCp(evals[1]), evalBest: evalCp(evals[2]), evalPlayed: evalCp(evals[3]),
    mate: best && !evals[2].startsWith("-") ? Number(best[1]) : null,
  };
}

/**
 * FSRS state from the review log, the way Anki derives its own FSRS memory state. Learning,
 * review, relearning and filtered-deck reviews count; a manual "Forget" (type 4/5 with ivl 0)
 * starts the card over.
 */
export function replay(revlog: AnkiReview[], cardId: string, createdAt: number) {
  let card = newCard(createdAt);
  const log: ImportedReview[] = [];
  for (const r of [...revlog].sort((a, b) => a.id - b.id)) {
    if (r.type >= 4) {
      if (r.ivl === 0 && r.ease === 0) card = newCard(r.id);
      continue;
    }
    if (r.ease < 1 || r.ease > 4) continue;
    const before = card;
    card = review(card, cardId, r.ease as Grade, r.id);
    log.push({
      grade: r.ease, reviewedAt: r.id, durationMs: Math.max(0, Math.min(r.time, 3_600_000)),
      mistakes: r.ease === 1 ? 1 : 0, stateBefore: before.state, cardBefore: before, scheduledDays: card.scheduledDays,
    });
  }
  return { card, log };
}

export type AnkiCard = { type: number; queue: number; due: number; ivl: number; data: string };

/**
 * Keep Anki's own memory state and due date for review cards: Anki computed them with its
 * parameters, and the replay with our defaults lands on shorter intervals. `crt` is the
 * collection's day zero (epoch seconds); review due dates count days from it.
 */
export function withAnkiSchedule(card: StoredCard, anki: AnkiCard, crt: number): StoredCard {
  let mem: { s?: number; d?: number } = {};
  try {
    mem = JSON.parse(anki.data || "{}");
  } catch { /* no FSRS state */ }
  if (anki.type !== 2 || card.state !== 2 || !mem.s || !mem.d) return card;
  const dueAt = anki.due > 1e9 ? anki.due * 1000 : (crt + anki.due * 86400) * 1000;
  return {
    ...card,
    stability: mem.s,
    stabilityFast: card.stabilityFast * (mem.s / card.stability),
    difficulty: mem.d,
    dueAt,
    scheduledDays: anki.ivl,
  };
}
