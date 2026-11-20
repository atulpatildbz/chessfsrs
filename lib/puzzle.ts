// Puzzle model: a start position, a forced line in UCI, and which side the solver plays.
// Every ply played by the solver's colour is the user's to find; the other plies are auto-played.
import { Chess, DEFAULT_POSITION, type Move } from "chess.js";

export type Color = "w" | "b";

export type PuzzleLine = {
  fen: string;
  moves: string[]; // UCI, e.g. "e2e4", "e7e8q"
  solver: Color;
};

export type ParsedPuzzle = PuzzleLine & {
  pgn: string;
  san: string[];
  site?: string;
  /** Header-derived title, e.g. "White vs Black". */
  title?: string;
};

export type ParseResult = { ok: true; puzzle: ParsedPuzzle } | { ok: false; error: string; pgn: string };

export const uciOf = (m: Pick<Move, "from" | "to" | "promotion">) => `${m.from}${m.to}${m.promotion ?? ""}`;

export const turnOf = (fen: string): Color => (fen.split(" ")[1] === "b" ? "b" : "w");
export const other = (c: Color): Color => (c === "w" ? "b" : "w");

/** Side that moves at ply `i` of a line starting from `fen`. */
export const moverAt = (fen: string, i: number): Color => (i % 2 === 0 ? turnOf(fen) : other(turnOf(fen)));

/**
 * Default solver: the side that plays the last move (puzzles end on the solver's move).
 * `1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6` from a black-to-move FEN -> White solves.
 */
export const defaultSolver = (fen: string, plies: number): Color => moverAt(fen, Math.max(0, plies - 1));

/** Indexes of the plies the user must find. */
export const userPlies = (p: PuzzleLine) => p.moves.map((_, i) => i).filter((i) => moverAt(p.fen, i) === p.solver);

/** Stable identity for duplicate detection: position (no clocks) + line. */
export function dedupeKey(p: PuzzleLine): string {
  const pos = p.fen.split(" ").slice(0, 4).join(" ");
  return `${pos}|${p.moves.join(" ")}`;
}

/** Split a paste that may contain several PGNs. */
export function splitPgns(text: string): string[] {
  const norm = text.replace(/\r\n?/g, "\n").trim();
  if (!norm) return [];
  const chunks: string[] = [];
  let cur: string[] = [];
  let seenMoves = false;
  for (const line of norm.split("\n")) {
    const t = line.trim();
    const isHeader = /^\[\w+\s+".*"\]$/.test(t);
    if (isHeader && seenMoves) {
      chunks.push(cur.join("\n"));
      cur = [];
      seenMoves = false;
    }
    if (t && !isHeader) seenMoves = true;
    cur.push(line);
  }
  if (cur.join("").trim()) chunks.push(cur.join("\n"));
  return chunks.map((c) => c.trim()).filter(Boolean);
}

const FEN_RE = /^\s*([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s+[wb]\s+(-|[KQkq]+)\s+(-|[a-h][36])(\s+\d+\s+\d+)?\s*$/;

/** Parse one puzzle: a PGN (optionally with [FEN]) or a bare FEN line followed by moves. */
export function parsePuzzle(raw: string): ParseResult {
  const pgn = raw.trim();
  try {
    const lines = pgn.split("\n");
    // Bare "FEN \n moves" form.
    if (FEN_RE.test(lines[0])) {
      const fen = normalizeFen(lines[0].trim());
      return fromPgnText(`[SetUp "1"]\n[FEN "${fen}"]\n\n${lines.slice(1).join(" ")}`, pgn);
    }
    return fromPgnText(pgn, pgn);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), pgn };
  }
}

function normalizeFen(fen: string) {
  const parts = fen.split(/\s+/);
  while (parts.length < 6) parts.push(parts.length === 4 ? "0" : "1");
  return parts.join(" ");
}

function fromPgnText(text: string, original: string): ParseResult {
  // chess.js only follows the mainline; strip things it chokes on: NAGs like $1 are fine, but
  // clock/eval comments are noise. "1..." move-number forms are accepted. chess.js also rejects
  // header names with underscores ([Puzzle_Length "3"]), which PGN allows.
  const cleaned = text
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ")
    .replace(/^\[(\w+)/gm, (_, name: string) => `[${name.replace(/_/g, "")}`);
  const chess = new Chess();
  chess.loadPgn(cleaned, { strict: false });
  const headers = chess.getHeaders();
  const fen = headers.FEN ? normalizeFen(headers.FEN) : DEFAULT_POSITION;
  const history = chess.history({ verbose: true });
  if (history.length === 0) return { ok: false, error: "No moves found: add the solution line after the headers.", pgn: original };
  const moves = history.map(uciOf);
  const title = headers.White && headers.Black && headers.White !== "?" ? `${headers.White} vs ${headers.Black}` : undefined;
  return {
    ok: true,
    puzzle: {
      fen,
      moves,
      solver: defaultSolver(fen, moves.length),
      pgn: original,
      san: history.map((m) => m.san),
      site: headers.Site && headers.Site !== "?" ? headers.Site : undefined,
      title,
    },
  };
}

/** SAN for a UCI line from a position. */
export function sanLine(fen: string, moves: string[]): string[] {
  const c = new Chess(fen);
  return moves.map((u) => c.move(parseUci(u)).san);
}

export function parseUci(u: string) {
  return { from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u[4] : undefined };
}

/** "1... Kg7 2. Nd5 Rh8" style text. */
export function formatLine(fen: string, san: string[]): string {
  const parts = fen.split(" ");
  let n = Number(parts[5] ?? 1) || 1;
  let side: Color = turnOf(fen);
  const out: string[] = [];
  san.forEach((m, i) => {
    if (side === "w") out.push(`${n}. ${m}`);
    else out.push(i === 0 ? `${n}... ${m}` : m);
    if (side === "b") n++;
    side = other(side);
  });
  return out.join(" ");
}

/** Build a PGN for export / storage. */
export function toPgn(p: PuzzleLine, headers: Record<string, string> = {}): string {
  const h = { ...headers, SetUp: "1", FEN: p.fen };
  const head = Object.entries(h)
    .map(([k, v]) => `[${k} "${v.replace(/"/g, "'")}"]`)
    .join("\n");
  return `${head}\n\n${formatLine(p.fen, sanLine(p.fen, p.moves))} *`;
}

export type MoveVerdict = "correct" | "alt-mate" | "wrong";

/**
 * Judge the user's move at ply `i`. Besides the expected move, any move that mates on the spot is
 * accepted (the puzzle is then complete). Promotions to a different piece are wrong only if they
 * actually change the outcome: we require the exact expected promotion piece unless the move mates.
 */
export function judgeMove(p: PuzzleLine, i: number, uci: string): MoveVerdict {
  const expected = p.moves[i];
  if (uci === expected) return "correct";
  const c = positionAt(p, i);
  let m: Move;
  try {
    m = c.move(parseUci(uci));
  } catch {
    return "wrong";
  }
  if (m && c.isCheckmate()) return "alt-mate";
  return "wrong";
}

/** chess.js instance at ply `i` (before move i is played). */
export function positionAt(p: PuzzleLine, i: number): Chess {
  const c = new Chess(p.fen);
  for (let k = 0; k < i; k++) c.move(parseUci(p.moves[k]));
  return c;
}

/** Validate that a line is legal from its FEN; returns an error message or null. */
export function validateLine(p: PuzzleLine): string | null {
  try {
    const c = new Chess(p.fen);
    for (const u of p.moves) c.move(parseUci(u));
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  if (!p.moves.some((_, i) => moverAt(p.fen, i) === p.solver)) return "The solver has no moves to find in this line.";
  return null;
}
