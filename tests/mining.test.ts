import { describe, expect, it } from "vitest";
import { judgeCandidate, minePuzzles, winProb, MATE, type Engine, type EngineLine } from "../lib/mining";
import { parseInfo } from "../lib/uci";
import type { GameRecord } from "../lib/games";

describe("winProb", () => {
  it("is 50% at equality and saturates for mates", () => {
    expect(winProb(0)).toBeCloseTo(0.5);
    expect(winProb(MATE)).toBeGreaterThan(0.999);
    expect(winProb(-MATE)).toBeLessThan(0.001);
  });
});

describe("judgeCandidate", () => {
  it("keeps a missed only-move", () => expect(judgeCandidate({ best: 200, second: -150, played: -300, playedIsBest: false }).keep).toBe(true));
  it("rejects when several moves are good", () => expect(judgeCandidate({ best: 200, second: 150, played: -300, playedIsBest: false }).reason).toBe("several good moves"));
  it("rejects when the best move was played", () => expect(judgeCandidate({ best: 200, second: -150, played: 200, playedIsBest: true }).keep).toBe(false));
  // On the win-probability scale a decided position can't lose 20 points: +M1 vs +7 is "fine".
  it("ignores misses in already-decided positions", () => expect(judgeCandidate({ best: MATE, second: 100, played: 700, playedIsBest: false }).reason).toBe("played move was fine"));
  it("rejects a single legal move", () => expect(judgeCandidate({ best: 0, second: null, played: -500, playedIsBest: false }).keep).toBe(false));
  it("keeps a missed mate", () => expect(judgeCandidate({ best: MATE, second: 0, played: -50, playedIsBest: false }).keep).toBe(true));
});

describe("parseInfo", () => {
  it("parses cp and multipv", () => {
    const r = parseInfo("info depth 12 seldepth 18 multipv 2 score cp -35 nodes 1000 nps 1 time 5 pv e7e5 g1f3 b8c6");
    expect(r).toEqual({ multipv: 2, line: { uci: "e7e5", cp: -35, mate: null, pv: ["e7e5", "g1f3", "b8c6"] } });
  });
  it("parses mates", () => {
    expect(parseInfo("info depth 5 score mate 2 pv a1a8 g8h7 h1h8")!.line).toMatchObject({ cp: MATE, mate: 2 });
    expect(parseInfo("info depth 5 score mate -1 pv g8h8")!.line).toMatchObject({ cp: -MATE, mate: -1 });
  });
  it("ignores bounds and non-pv lines", () => {
    expect(parseInfo("info depth 10 score cp 20 lowerbound pv e2e4")).toBeNull();
    expect(parseInfo("info string NNUE enabled")).toBeNull();
    expect(parseInfo("bestmove e2e4")).toBeNull();
  });
});

describe("minePuzzles with a scripted engine", () => {
  // White plays 1.e4 e5 2.Qh5 Nc6 3.Bc4 Nf6?? 4.Qxf7#. The user is Black and missed 3...g6.
  const game: GameRecord = {
    site: "lichess", id: "g1", url: "https://lichess.org/g1", white: "opp", black: "me", userColor: "b",
    timeClass: "blitz", playedAt: 0, pgn: "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0",
  };
  const BEFORE_BLUNDER = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
  const engine: Engine = {
    async analyse(fen, { multipv }): Promise<EngineLine[]> {
      if (fen === BEFORE_BLUNDER) {
        const lines: EngineLine[] = [
          { uci: "g7g6", cp: -30, mate: null, pv: ["g7g6", "h5f3", "g8f6"] },
          { uci: "d8e7", cp: -320, mate: null, pv: ["d8e7"] },
        ];
        return lines.slice(0, multipv);
      }
      if (fen.startsWith("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w")) return [{ uci: "h5f7", cp: MATE, mate: 1, pv: ["h5f7"] }];
      // Everything else: roughly equal, from the side to move.
      return [{ uci: "a2a3", cp: 0, mate: null, pv: ["a2a3"] }, { uci: "h2h3", cp: -400, mate: null, pv: ["h2h3"] }].slice(0, multipv);
    },
  };
  it("finds the missed defence and starts from the opponent's move", async () => {
    const ps = await minePuzzles(game, engine, "fast");
    expect(ps).toHaveLength(1);
    const p = ps[0];
    expect(p.solver).toBe("b");
    expect(p.moves[0]).toBe("f1c4"); // opponent's 3.Bc4, played for the user
    expect(p.moves[1]).toBe("g7g6");
    expect(p.playedSan).toBe("Nf6");
    expect(p.evalPlayed).toBe(-MATE);
  });
});
