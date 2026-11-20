import { describe, expect, it } from "vitest";
import { motifTags, phaseOf, withAutoTags } from "../lib/motifs";

describe("motif tags", () => {
  it("knight fork of king and rook", () => {
    expect(motifTags("r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", ["b5c7"], "w")).toEqual(expect.arrayContaining(["fork", "endgame"]));
  });
  it("back-rank mate in one", () => {
    const t = motifTags("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", ["a1a8"], "w");
    expect(t).toEqual(expect.arrayContaining(["mate", "mate-in-1", "back-rank-mate"]));
    expect(t).not.toContain("quiet-move");
  });
  it("taking an undefended queen is a hanging piece", () => {
    expect(motifTags("4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1", ["d1d5"], "w")).toContain("hanging-piece");
  });
  it("the README example: quiet first move, three-move line, no sacrifice", () => {
    const t = motifTags("r2q1rk1/ppp2p2/3pnn2/2b1p3/4P2B/2NP4/PPP2PPP/R2Q1RK1 b - - 0 1", ["g8g7", "c3d5", "f8h8", "h4f6", "d8f6", "d5f6"], "w");
    expect(t).toEqual(expect.arrayContaining(["quiet-move", "long-line"]));
    expect(t).not.toContain("sacrifice");
    expect(t).not.toContain("mate");
  });
  it("Greek gift: bishop sacrifice that ends in mate", () => {
    // 1. Bxh7+ Kxh7 2. Ng5+ Kg8 3. Qh5 a6 4. Qh7#
    const t = motifTags("rnbq1rk1/ppp1bppp/4p3/3pP3/3P4/3B1N2/PPP2PPP/RNBQK2R w KQ - 0 8", ["d3h7", "g8h7", "f3g5", "h7g8", "d1h5", "a7a6", "h5h7"], "w");
    expect(t).toEqual(expect.arrayContaining(["mate", "mate-in-3+", "sacrifice", "opening"]));
  });
  it("a trade isn't a sacrifice, and a capturable checker isn't a fork", () => {
    const t = motifTags("3r2k1/5ppp/8/8/8/8/4R3/4R1K1 w - - 0 1", ["e2e8", "d8e8", "e1e8"], "w");
    expect(t).toContain("back-rank-mate");
    expect(t).not.toContain("sacrifice");
    expect(t).not.toContain("fork");
  });
  it("a mate that takes a piece is just a mate", () => {
    const t = motifTags("n2r2k1/5ppp/8/8/8/8/8/3R2K1 w - - 0 1", ["d1d8"], "w");
    expect(t).toEqual(expect.arrayContaining(["mate-in-1", "back-rank-mate"]));
    expect(t).not.toContain("fork");
    expect(t).not.toContain("hanging-piece");
  });
  it("promotions are judged as the new piece", () => {
    expect(motifTags("6k1/4Pppp/8/8/8/8/8/4K3 w - - 0 1", ["e7e8q"], "w")).toEqual(expect.arrayContaining(["back-rank-mate", "promotion"]));
    // A new queen hitting two defended knights is no fork (it would be, judged as a pawn).
    expect(motifTags("8/kp2P2p/2n3n1/8/8/8/8/4K3 w - - 0 1", ["e7e8q"], "w")).not.toContain("fork");
  });
  it("a checking knight that can just be taken is no fork; one taken only by a pinned pawn is", () => {
    // Ne6+ hits Kg7 and Qd8, but f7xe6 answers both.
    expect(motifTags("3q4/5pk1/8/2N5/8/8/8/4K3 w - - 0 1", ["c5e6"], "w")).not.toContain("fork");
    // King on f8 instead: the f7 pawn is pinned by the rook on f1 and can't take.
    expect(motifTags("3q1k2/5p2/8/2N5/8/8/8/4KR2 w - - 0 1", ["c5e6"], "w")).toContain("fork");
  });
  it("phases", () => {
    expect(phaseOf("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1")).toBe("opening");
    expect(phaseOf("r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 15")).toBe("middlegame");
    expect(phaseOf("8/5pk1/6p1/8/8/6P1/r4PK1/2R5 w - - 0 40")).toBe("endgame");
  });
  it("recomputing replaces old automatic tags but keeps the user's and time-trouble", () => {
    expect(withAutoTags(["fork", "my-games", "time-trouble", "endgame"], ["quiet-move", "middlegame"]).sort()).toEqual(["middlegame", "my-games", "quiet-move", "time-trouble"]);
  });
});
