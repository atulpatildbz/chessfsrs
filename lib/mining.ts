// Turn a played game into puzzles: positions where the user had exactly one good move and missed it.
import { Chess } from "chess.js";
import type { GameRecord } from "./games";
import { type Color, parseUci, toPgn, uciOf } from "./puzzle";
import { TIME_TROUBLE } from "./motifs";

/** One engine line. `cp` is from the side to move's view; mates are ±MATE. */
export type EngineLine = { uci: string; cp: number; mate: number | null; pv: string[] };
export interface Engine {
  analyse(fen: string, opts: { depth: number; nodes?: number; multipv: number; signal?: AbortSignal }): Promise<EngineLine[]>;
  /** Clear the engine's hash between games (not between moves of one game). */
  newGame?(): void;
}

export const MATE = 10000;

/** Lichess' win-probability curve, 0..1 for the side whose view `cp` is in. */
export const winProb = (cp: number) => 1 / (1 + Math.exp(-0.00368208 * Math.max(-MATE, Math.min(MATE, cp))));

export type Strength = "fast" | "normal" | "deep";
/** Searches stop at whichever comes first, depth or nodes, so phones and laptops find the same puzzles. */
export const STRENGTH: Record<Strength, { scan: number; scanNodes: number; verify: number; verifyNodes: number }> = {
  fast: { scan: 10, scanNodes: 60_000, verify: 14, verifyNodes: 250_000 },
  normal: { scan: 12, scanNodes: 120_000, verify: 16, verifyNodes: 800_000 },
  deep: { scan: 14, scanNodes: 300_000, verify: 18, verifyNodes: 2_500_000 },
};

export const THRESHOLDS = {
  /** Pass 1: the played move must cost at least this much win probability to be looked at closely. */
  candidateDrop: 0.12,
  /** Best move must beat the second best by this much ("only move"). */
  onlyMoveGap: 0.15,
  /** Played move must be this much worse than the best move. */
  missDrop: 0.2,
  /** Even the best move must leave this much winning chance (≈ −300 cp): no "lose more slowly" puzzles. */
  minBest: 0.25,
  /** Moves made with less than this many seconds left are time-scramble slips, not lessons. */
  minClock: 5,
  /** Keep only the costliest few mistakes of one game. */
  maxPerGame: 3,
  /** Longest line (counting user moves) we extend to; mates up to `maxMate` get their full length. */
  maxUserMoves: 3,
  maxMate: 5,
  /** Skip games too short to be real games (aborts), but keep quick mates like Scholar's Mate. */
  minPlies: 6,
};

export type Verdict = { keep: boolean; reason: string };

/** The core test on verified (deep) numbers, all from the user's view. */
export function judgeCandidate(x: { best: number; second: number | null; played: number; playedIsBest: boolean }): Verdict {
  if (x.playedIsBest) return { keep: false, reason: "played the best move" };
  if (x.second === null) return { keep: false, reason: "only one legal move" };
  const wb = winProb(x.best);
  const gap = wb - winProb(x.second);
  if (gap < THRESHOLDS.onlyMoveGap) return { keep: false, reason: "several good moves" };
  const drop = wb - winProb(x.played);
  if (drop < THRESHOLDS.missDrop) return { keep: false, reason: "played move was fine" };
  if (wb < THRESHOLDS.minBest) return { keep: false, reason: "lost anyway" };
  return { keep: true, reason: "only move missed" };
}

export type MinedPuzzle = {
  fen: string;
  moves: string[];
  solver: Color;
  gameId: string;
  site: GameRecord["site"];
  url: string;
  white: string;
  black: string;
  timeClass: string;
  playedAt: number;
  ply: number; // ply index in the game of the user's mistake
  moveLabel: string; // "20... Bxa1"
  playedSan: string;
  bestSan: string;
  evalBefore: number; // user's view, cp
  evalBest: number;
  evalPlayed: number;
  mate: number | null; // mate-in-n after the best move, if any
  /** Seconds left after the mistake, and at the start of the game, from the PGN clock; null without clocks. */
  clock: number | null;
  clockStart: number | null;
};

type Ply = { fenBefore: string; uci: string; san: string; color: Color; moveNumber: number };

export function gamePlies(pgn: string): Ply[] {
  const c = new Chess();
  c.loadPgn(pgn.replace(/\{[^}]*\}/g, " "), { strict: false });
  const hist = c.history({ verbose: true });
  return hist.map((m) => ({
    fenBefore: m.before,
    uci: uciOf(m),
    san: m.san,
    color: m.color as Color,
    moveNumber: Number(m.before.split(" ")[5]),
  }));
}

/** Clock left after each ply, in seconds, from [%clk] comments; null if the PGN has none. */
export function gameClocks(pgn: string, plies: number): number[] | null {
  const m = [...pgn.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)];
  if (m.length !== plies) return null;
  return m.map((x) => Number(x[1]) * 3600 + Number(x[2]) * 60 + Number(x[3]));
}

const wait = () => new Promise((r) => setTimeout(r, 0));

/**
 * Two passes: a cheap scan finds moves that lost a lot, then each is verified with MultiPV 2 at depth.
 * `onProgress(done, total)` reports scanned positions.
 */
export async function minePuzzles(
  game: GameRecord,
  engine: Engine,
  strength: Strength,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<MinedPuzzle[]> {
  const plies = gamePlies(game.pgn);
  if (plies.length < THRESHOLDS.minPlies) return [];
  const { scan, scanNodes, verify, verifyNodes } = STRENGTH[strength];
  const clocks = gameClocks(game.pgn, plies.length);
  engine.newGame?.();
  const sign = (fen: string) => (fen.split(" ")[1] === "w" ? 1 : -1);

  // Pass 1: eval (White's view) of every position, from lichess analysis if present.
  const evalWhite: (number | null)[] = new Array(plies.length + 1).fill(null);
  const userIdx = plies.map((p, i) => (p.color === game.userColor ? i : -1)).filter((i) => i >= 0);
  if (game.evals && game.evals.length >= plies.length - 1) {
    evalWhite[0] = 20;
    game.evals.forEach((e, i) => (evalWhite[i + 1] = e));
  }
  const needed = new Set<number>();
  for (const i of userIdx) {
    if (evalWhite[i] === null) needed.add(i);
    if (i + 1 <= plies.length && evalWhite[i + 1] === null) needed.add(i + 1);
  }
  const finalFen = (() => {
    const c = new Chess(plies[plies.length - 1].fenBefore);
    c.move(parseUci(plies[plies.length - 1].uci));
    return c;
  })();
  const total = needed.size;
  let done = 0;
  for (const i of [...needed].sort((a, b) => a - b)) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (i === plies.length) {
      evalWhite[i] = finalFen.isCheckmate() ? (finalFen.turn() === "w" ? -MATE : MATE) : finalFen.isDraw() || finalFen.isStalemate() ? 0 : null;
      if (evalWhite[i] === null) {
        const [l] = await engine.analyse(finalFen.fen(), { depth: scan, nodes: scanNodes, multipv: 1, signal: opts.signal });
        evalWhite[i] = l ? l.cp * sign(finalFen.fen()) : 0;
      }
    } else {
      const fen = plies[i].fenBefore;
      const [l] = await engine.analyse(fen, { depth: scan, nodes: scanNodes, multipv: 1, signal: opts.signal });
      evalWhite[i] = l ? l.cp * sign(fen) : 0;
    }
    opts.onProgress?.(++done, total);
    await wait();
  }

  const us = game.userColor === "w" ? 1 : -1;
  const candidates = userIdx.filter((i) => {
    const before = evalWhite[i], after = evalWhite[i + 1];
    if (before === null || after === null) return false;
    if (clocks && clocks[i] < THRESHOLDS.minClock) return false;
    return winProb(before * us) - winProb(after * us) >= THRESHOLDS.candidateDrop;
  });

  // Pass 2.
  const out: MinedPuzzle[] = [];
  for (const i of candidates) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const p = plies[i];
    const lines = await engine.analyse(p.fenBefore, { depth: verify, nodes: verifyNodes, multipv: 2, signal: opts.signal });
    if (!lines.length) continue;
    const best = lines[0];
    const second = lines[1] ?? null;
    let played: number;
    if (best.uci === p.uci) played = best.cp;
    else if (second && second.uci === p.uci) played = second.cp;
    else {
      const after = new Chess(p.fenBefore);
      after.move(parseUci(p.uci));
      if (after.isCheckmate()) continue; // played a mate: not a mistake
      const [l] = after.isGameOver() ? [{ cp: 0 } as EngineLine] : await engine.analyse(after.fen(), { depth: verify, nodes: verifyNodes, multipv: 1, signal: opts.signal });
      played = -(l?.cp ?? 0);
    }
    const v = judgeCandidate({ best: best.cp, second: second?.cp ?? null, played, playedIsBest: best.uci === p.uci });
    if (!v.keep) continue;

    const solutionMoves = await extendLine(p.fenBefore, best, engine, { depth: verify, nodes: verifyNodes }, opts.signal);
    const prev = i > 0 ? plies[i - 1] : null;
    const bestSan = new Chess(p.fenBefore).move(parseUci(best.uci)).san;
    out.push({
      fen: prev ? prev.fenBefore : p.fenBefore,
      moves: prev ? [prev.uci, ...solutionMoves] : solutionMoves,
      solver: p.color,
      gameId: game.id,
      site: game.site,
      url: game.url,
      white: game.white,
      black: game.black,
      timeClass: game.timeClass,
      playedAt: game.playedAt,
      ply: i,
      moveLabel: `${p.moveNumber}${p.color === "w" ? "." : "..."} ${p.san}`,
      playedSan: p.san,
      bestSan,
      evalBefore: (evalWhite[i] ?? best.cp * us) * us,
      evalBest: best.cp,
      evalPlayed: played,
      mate: best.mate,
      clock: clocks ? clocks[i] : null,
      clockStart: clocks ? clocks[game.userColor === "w" ? 0 : 1] ?? null : null,
    });
  }
  // The costliest mistakes first, at most a few per game.
  return out
    .sort((a, b) => winProb(a.evalPlayed) - winProb(a.evalBest) - (winProb(b.evalPlayed) - winProb(b.evalBest)))
    .slice(0, THRESHOLDS.maxPerGame)
    .sort((a, b) => a.ply - b.ply);
}

/**
 * The solution line from `fen` starting with `best`: keep going while the user's next move is again
 * the only good one (Lichess' puzzle rule). Mates run to their end, except where two moves mate
 * equally fast; the final mating move may be any mate (the solver accepts all).
 */
async function extendLine(fen: string, best: EngineLine, engine: Engine, limit: { depth: number; nodes: number }, signal?: AbortSignal): Promise<string[]> {
  const mating = best.mate !== null && best.mate > 0;
  const maxUser = mating ? Math.min(best.mate!, THRESHOLDS.maxMate) : THRESHOLDS.maxUserMoves;
  const line = [best.uci];
  let pv = best.pv;
  const c = new Chess(fen);
  c.move(parseUci(best.uci));
  let userMoves = 1;
  while (userMoves < maxUser && pv.length >= 2 && !c.isGameOver()) {
    const reply = pv[1];
    try {
      c.move(parseUci(reply));
    } catch {
      break;
    }
    if (c.isGameOver()) break;
    const lines = await engine.analyse(c.fen(), { ...limit, multipv: 2, signal });
    if (!lines.length) break;
    const [b, s] = lines;
    const mateNow = b.mate === 1;
    const forced = s ? winProb(b.cp) - winProb(s.cp) >= THRESHOLDS.onlyMoveGap : false;
    // Continue for a forced follow-up that keeps the advantage, or the final mating blow.
    if (!mateNow && (!forced || winProb(b.cp) < THRESHOLDS.minBest)) break;
    try {
      c.move(parseUci(b.uci));
    } catch {
      break;
    }
    line.push(reply, b.uci);
    pv = b.pv;
    userMoves++;
  }
  return line;
}

/** A mistake made with under a tenth of the starting clock left (at least 10 s) counts as time trouble. */
export const inTimeTrouble = (p: Pick<MinedPuzzle, "clock" | "clockStart">) =>
  p.clock !== null && p.clockStart !== null && p.clock < Math.max(10, p.clockStart * 0.1);

/** What gets saved for a mined puzzle (the server adds the motif tags). */
export function toPuzzleInput(p: MinedPuzzle) {
  return {
    fen: p.fen,
    moves: p.moves,
    solver: p.solver,
    source: p.site,
    pgn: toPgn(p, { Site: p.url, White: p.white, Black: p.black }),
    tags: inTimeTrouble(p) ? [TIME_TROUBLE] : [],
    game: {
      url: p.url, white: p.white, black: p.black, timeClass: p.timeClass, playedAt: p.playedAt, moveLabel: p.moveLabel,
      playedSan: p.playedSan, bestSan: p.bestSan, evalBefore: p.evalBefore, evalBest: p.evalBest, evalPlayed: p.evalPlayed, mate: p.mate,
    },
  };
}
