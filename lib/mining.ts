// Turn a played game into puzzles: positions where the user had exactly one good move and missed it.
import { Chess } from "chess.js";
import type { GameRecord } from "./games";
import { type Color, parseUci, uciOf } from "./puzzle";

/** One engine line. `cp` is from the side to move's view; mates are ±MATE. */
export type EngineLine = { uci: string; cp: number; mate: number | null; pv: string[] };
export interface Engine {
  analyse(fen: string, opts: { depth: number; multipv: number; signal?: AbortSignal }): Promise<EngineLine[]>;
}

export const MATE = 10000;

/** Lichess' win-probability curve, 0..1 for the side whose view `cp` is in. */
export const winProb = (cp: number) => 1 / (1 + Math.exp(-0.00368208 * Math.max(-MATE, Math.min(MATE, cp))));

export type Strength = "fast" | "normal" | "deep";
export const STRENGTH: Record<Strength, { scan: number; verify: number }> = {
  fast: { scan: 8, verify: 12 },
  normal: { scan: 10, verify: 16 },
  deep: { scan: 12, verify: 20 },
};

export const THRESHOLDS = {
  /** Pass 1: the played move must cost at least this much win probability to be looked at closely. */
  candidateDrop: 0.12,
  /** Best move must beat the second best by this much ("only move"). */
  onlyMoveGap: 0.15,
  /** Played move must be this much worse than the best move. */
  missDrop: 0.2,
  /** Longest line (counting user moves) we extend to. */
  maxUserMoves: 3,
  /** Mates up to this length get their full line. */
  maxMateLine: 5,
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
  if (plies.length < 4) return [];
  const { scan, verify } = STRENGTH[strength];
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
        const [l] = await engine.analyse(finalFen.fen(), { depth: scan, multipv: 1, signal: opts.signal });
        evalWhite[i] = l ? l.cp * sign(finalFen.fen()) : 0;
      }
    } else {
      const fen = plies[i].fenBefore;
      const [l] = await engine.analyse(fen, { depth: scan, multipv: 1, signal: opts.signal });
      evalWhite[i] = l ? l.cp * sign(fen) : 0;
    }
    opts.onProgress?.(++done, total);
    await wait();
  }

  const us = game.userColor === "w" ? 1 : -1;
  const candidates = userIdx.filter((i) => {
    const before = evalWhite[i], after = evalWhite[i + 1];
    if (before === null || after === null) return false;
    return winProb(before * us) - winProb(after * us) >= THRESHOLDS.candidateDrop;
  });

  // Pass 2.
  const out: MinedPuzzle[] = [];
  for (const i of candidates) {
    if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const p = plies[i];
    const lines = await engine.analyse(p.fenBefore, { depth: verify, multipv: 2, signal: opts.signal });
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
      const [l] = after.isGameOver() ? [{ cp: 0 } as EngineLine] : await engine.analyse(after.fen(), { depth: verify, multipv: 1, signal: opts.signal });
      played = -(l?.cp ?? 0);
    }
    const v = judgeCandidate({ best: best.cp, second: second?.cp ?? null, played, playedIsBest: best.uci === p.uci });
    if (!v.keep) continue;

    const solutionMoves = await extendLine(p.fenBefore, best, engine, verify, opts.signal);
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
    });
  }
  return out;
}

/**
 * The solution line from `fen` starting with `best`: the full PV for short mates, otherwise keep
 * going while the user's next move is again the only good one.
 */
async function extendLine(fen: string, best: EngineLine, engine: Engine, depth: number, signal?: AbortSignal): Promise<string[]> {
  if (best.mate !== null && best.mate > 0 && best.mate <= THRESHOLDS.maxMateLine && best.pv.length >= 1) {
    const pv = best.pv.slice(0, best.mate * 2 - 1);
    // Must end with the mating move by the solver (odd length) and be legal.
    if (pv.length % 2 === 1 && legal(fen, pv) && endsInMate(fen, pv)) return pv;
  }
  const line = [best.uci];
  let pv = best.pv;
  const c = new Chess(fen);
  c.move(parseUci(best.uci));
  let userMoves = 1;
  while (userMoves < THRESHOLDS.maxUserMoves && pv.length >= 2 && !c.isGameOver()) {
    const reply = pv[1];
    try {
      c.move(parseUci(reply));
    } catch {
      break;
    }
    if (c.isGameOver()) break;
    const lines = await engine.analyse(c.fen(), { depth, multipv: 2, signal });
    if (lines.length < 2) break;
    const [b, s] = lines;
    // Continue only for a forced follow-up that keeps (or wins) the advantage.
    if (winProb(b.cp) - winProb(s.cp) < THRESHOLDS.onlyMoveGap || winProb(b.cp) < 0.5) break;
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

function legal(fen: string, moves: string[]) {
  try {
    const c = new Chess(fen);
    for (const m of moves) c.move(parseUci(m));
    return true;
  } catch {
    return false;
  }
}

function endsInMate(fen: string, moves: string[]) {
  const c = new Chess(fen);
  for (const m of moves) c.move(parseUci(m));
  return c.isCheckmate();
}

