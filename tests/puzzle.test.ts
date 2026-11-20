import { describe, expect, it } from "vitest";
import { dedupeKey, formatLine, judgeMove, parsePuzzle, splitPgns, userPlies, validateLine } from "../lib/puzzle";

const EXAMPLE = `[Site "Chess.com"]
[Result "*"]
[SetUp "1"]
[FEN "r2q1rk1/ppp2p2/3pnn2/2b1p3/4P2B/2NP4/PPP2PPP/R2Q1RK1 b - - 0 1"]
1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6 *`;

describe("parsePuzzle", () => {
  it("parses the user's chess.com format and detects White as solver", () => {
    const r = parsePuzzle(EXAMPLE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.puzzle.moves).toEqual(["g8g7", "c3d5", "f8h8", "h4f6", "d8f6", "d5f6"]);
    expect(r.puzzle.solver).toBe("w");
    expect(r.puzzle.site).toBe("Chess.com");
    expect(userPlies(r.puzzle)).toEqual([1, 3, 5]);
    expect(validateLine(r.puzzle)).toBeNull();
    expect(formatLine(r.puzzle.fen, r.puzzle.san)).toBe("1... Kg7 2. Nd5 Rh8 3. Bxf6+ Qxf6 4. Nxf6");
  });

  it("solver moves first when the line has an odd number of plies", () => {
    const r = parsePuzzle(`[FEN "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"]\n1. Ra8# *`);
    expect(r.ok && r.puzzle.solver).toBe("w");
    expect(r.ok && userPlies(r.puzzle)).toEqual([0]);
  });

  it("accepts a bare FEN line followed by moves", () => {
    const r = parsePuzzle(`6k1/5ppp/8/8/8/8/5PPP/R5K1 w - -\nRa8#`);
    expect(r.ok && r.puzzle.moves).toEqual(["a1a8"]);
  });

  it("strips comments and follows the mainline", () => {
    const r = parsePuzzle(`[FEN "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"]\n1. Ra8# {mate} (1. Rb1 h6) *`);
    expect(r.ok && r.puzzle.moves).toEqual(["a1a8"]);
  });

  it("reports illegal moves", () => {
    const r = parsePuzzle(`[FEN "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"]\n1. Qh5 *`);
    expect(r.ok).toBe(false);
  });

  it("reports a missing solution line", () => {
    const r = parsePuzzle(`[FEN "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"]\n*`);
    expect(r.ok).toBe(false);
  });
});

describe("splitPgns", () => {
  it("splits several pasted PGNs", () => {
    const two = `${EXAMPLE}\n\n[FEN "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1"]\n1. Ra8# *`;
    expect(splitPgns(two)).toHaveLength(2);
    expect(splitPgns(EXAMPLE)).toHaveLength(1);
    expect(splitPgns("  ")).toHaveLength(0);
  });
});

describe("judgeMove", () => {
  const line = { fen: "6k1/5ppp/8/8/8/8/5PPP/R4RK1 w - - 0 1", moves: ["a1a8"], solver: "w" as const };
  it("accepts the expected move", () => expect(judgeMove(line, 0, "a1a8")).toBe("correct"));
  it("rejects a check that isn't mate", () => expect(judgeMove(line, 0, "f1f8")).toBe("wrong"));
  it("rejects a non-mating move", () => expect(judgeMove(line, 0, "a1a7")).toBe("wrong"));
  it("rejects illegal moves", () => expect(judgeMove(line, 0, "a1h8")).toBe("wrong"));
  it("accepts an alternative mate", () => {
    const two = { fen: "k7/8/1K6/8/8/8/8/2R4R w - - 0 1", moves: ["c1a1"], solver: "w" as const };
    expect(judgeMove(two, 0, "h1h8")).toBe("alt-mate");
  });
});

describe("dedupeKey", () => {
  it("ignores move clocks", () => {
    const a = { fen: "8/8/8/8/8/8/8/K6k w - - 0 1", moves: ["a1a2"], solver: "w" as const };
    const b = { ...a, fen: "8/8/8/8/8/8/8/K6k w - - 12 40" };
    expect(dedupeKey(a)).toBe(dedupeKey(b));
  });
});
