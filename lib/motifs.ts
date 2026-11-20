// Automatic tags: what kind of puzzle this is (motif, game phase), worked out from the position and
// the solution line alone, so every puzzle gets them, whatever its source. Heuristics, not a full
// tactic classifier: they aim to be right when they fire, and stay quiet when unsure.
import { Chess, type Square } from "chess.js";
import { parseUci, type Color } from "./puzzle";

const VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Every tag this module can produce, in the order the Patterns page lists them. */
export const MOTIFS = [
  "mate-in-1", "mate-in-2", "mate-in-3+", "back-rank-mate",
  "fork", "hanging-piece", "sacrifice", "promotion", "quiet-move", "long-line",
] as const;
export const PHASES = ["opening", "middlegame", "endgame"] as const;
export const TIME_TROUBLE = "time-trouble";
export const AUTO_TAGS: readonly string[] = [...MOTIFS, ...PHASES, TIME_TROUBLE, "mate"];

function material(c: Chess, color: Color) {
  let sum = 0;
  for (const row of c.board()) for (const sq of row) if (sq && sq.color === color) sum += VALUE[sq.type];
  return sum;
}

function nonPawnMaterial(c: Chess) {
  let sum = 0;
  for (const row of c.board()) for (const sq of row) if (sq && sq.type !== "p") sum += VALUE[sq.type];
  return sum;
}

export function phaseOf(fen: string): (typeof PHASES)[number] {
  const c = new Chess(fen);
  if (nonPawnMaterial(c) <= 20) return "endgame"; // e.g. rook and minor piece each, or less
  return Number(fen.split(" ")[5]) <= 12 ? "opening" : "middlegame";
}

export function motifTags(fen: string, moves: string[], solver: Color): string[] {
  const opp: Color = solver === "w" ? "b" : "w";
  const c = new Chess(fen);
  const tags = new Set<string>();
  const userMoves: { san: string; captured?: string; promotion?: string; to: Square; piece: string; check: boolean }[] = [];
  let startDiff: number | null = null;
  let down = false; // the opponent just won material back off us
  let dipped = false; // ...and our next move didn't simply take it back: material was given up
  const diff = () => material(c, solver) - material(c, opp);
  for (const uci of moves) {
    const mover = c.turn();
    if (mover === solver && startDiff === null) {
      startDiff = diff();
      tags.add(phaseOf(c.fen()));
    }
    const m = c.move(parseUci(uci));
    if (mover === solver) {
      const piece = m.promotion ?? m.piece; // judge a promotion by the new piece
      userMoves.push({ san: m.san, captured: m.captured, promotion: m.promotion, to: m.to, piece, check: c.inCheck() });
      if (down && diff() <= startDiff! - 2) dipped = true;
      down = false;
      if (userMoves.length === 1 && !c.isCheckmate()) firstMoveTags(c, m.to, piece, m.captured, solver, opp, moves.length, tags);
    } else if (startDiff !== null && diff() <= startDiff - 2) {
      down = true;
    }
  }
  if (!userMoves.length || startDiff === null) return [];
  const first = userMoves[0];
  const mate = c.isCheckmate() && c.turn() === opp;
  if (mate) {
    tags.add("mate");
    tags.add(userMoves.length === 1 ? "mate-in-1" : userMoves.length === 2 ? "mate-in-2" : "mate-in-3+");
    const king = c.findPiece({ type: "k", color: opp })[0];
    const last = userMoves[userMoves.length - 1];
    if (king && (last.piece === "r" || last.piece === "q") && king[1] === (opp === "w" ? "1" : "8") && last.to[1] === king[1]) tags.add("back-rank-mate");
  }
  if (userMoves.some((m) => m.promotion)) tags.add("promotion");
  if (!first.captured && !first.check && !first.promotion) tags.add("quiet-move");
  if (userMoves.length >= 3) tags.add("long-line");
  if (dipped && (mate || diff() >= startDiff)) tags.add("sacrifice");
  return [...tags];
}

/** Fork and hanging piece: judged right after the first user move. */
function firstMoveTags(c: Chess, to: Square, piece: string, captured: string | undefined, solver: Color, opp: Color, lineLength: number, tags: Set<string>) {
  // Fork: the moved piece attacks two targets that matter: the king, something worth more than
  // itself, or something undefended (pawns don't count). A target that can simply take the piece
  // doesn't count, and the piece must be safe where it stands: nothing can take it, or it is
  // defended and only something worth as much or more can. Captures are legal replies, so pinned
  // pieces and checks are accounted for.
  const capturers = new Set(c.moves({ verbose: true }).filter((m) => m.to === to).map((m) => m.from));
  let targets = 0;
  for (const row of c.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== opp || sq.type === "p") continue;
      if (!c.attackers(sq.square, solver).includes(to)) continue;
      if (capturers.has(sq.square)) continue;
      const defended = c.attackers(sq.square, opp).length > 0;
      if (sq.type === "k" || VALUE[sq.type] > VALUE[piece] || !defended) targets++;
    }
  }
  const defended = c.attackers(to, solver).length > 0;
  const safe = capturers.size === 0 || (defended && [...capturers].every((s) => VALUE[c.get(s)!.type] >= VALUE[piece]));
  if (targets >= 2 && safe) tags.add("fork");
  // Hanging piece: a one-move puzzle that just takes a piece the opponent can't take back.
  if (captured && VALUE[captured] >= 3 && lineLength <= 2 && !c.isAttacked(to, opp)) tags.add("hanging-piece");
}

const RECOMPUTED: readonly string[] = [...MOTIFS, ...PHASES, "mate"];

/**
 * Merge freshly computed tags into a puzzle's tags: earlier computed ones are replaced; the user's
 * own tags and "time-trouble" (known only when mining the game) are kept.
 */
export function withAutoTags(tags: string[], auto: string[]) {
  return [...new Set([...tags.filter((t) => !RECOMPUTED.includes(t)), ...auto])];
}
