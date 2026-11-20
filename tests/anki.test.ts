import { describe, expect, it } from "vitest";
import { htmlToText, noteToPuzzle, replay, withAnkiSchedule } from "../lib/anki";

const gameNote = [
  `[Event "Puzzle: chriguioktar vs atulpatildbz"]\n[Site "https://www.chess.com/game/live/166624926702"]\n[Date "2026.04.11"]\n[White "chriguioktar"]\n[Black "atulpatildbz"]\n[FEN "r1br2k1/1p1qbppp/1pn1p3/1N2P3/5P2/1P1P4/P1Q1B1PP/RN3RK1 w - - 0 17"]\n[SetUp "1"]\n[Result "*"]\n\n17. a3 17... Nd4!! {Find the best move! You played Nxe5 instead (eval drop: 3.44 pawns). Best: Nd4 → +4.48}`,
  `<b>chriguioktar vs atulpatildbz</b><br>Move: <b>17... Nxe5</b><br>Eval before: +4.21 &nbsp;|&nbsp; After best: <span style="color:green">+4.48</span> &nbsp;|&nbsp; After played: <span style="color:red">-M</span>`,
];

describe("anki import", () => {
  it("strips Anki's HTML", () => {
    expect(htmlToText("a<br>b&nbsp;&amp;<div>c</div>")).toBe("a\nb &c");
  });

  it("reads an AnkiChess mistake card with its game info", () => {
    const r = noteToPuzzle(gameNote, ["chess-mistakes", "chess-puzzle-35520324a1f2", "my-games"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.puzzle.solver).toBe("b");
    expect(r.puzzle.moves).toEqual(["a2a3", "c6d4"]);
    expect(r.puzzle.source).toBe("chesscom");
    expect(r.puzzle.tags).toEqual(["anki", "chess-mistakes", "my-games"]);
    expect(r.puzzle.game).toMatchObject({ playedSan: "Nxe5", bestSan: "Nd4", evalBest: 448, evalPlayed: -10000, moveLabel: "17... Nxe5" });
  });

  it("reads a Chess 2.0 card with underscore headers and <br> lines", () => {
    const pgn = `[SetUp "1"]<br>[FEN "r1b2rk1/p1pp1pb1/2nq2pp/1p1Np3/1PP1P2P/P2P2P1/5P2/R2QKBNR b KQ c3 0 11"]<br>[Puzzle_Length "3"]<br><br>11... a6 12. c5 Qe6 13. Nxc7 Qe7 14. Nxa8 *`;
    const r = noteToPuzzle([pgn], ["Chess::puzzle"]);
    if (!r.ok) throw new Error(r.error);
    expect(r.puzzle.solver).toBe("w");
    expect(r.puzzle.tags).toEqual(["anki", "puzzle"]);
    expect(r.puzzle.game).toBeUndefined();
  });

  it("replays the review log and restarts after Forget", () => {
    const day = 86_400_000, t0 = Date.UTC(2026, 0, 1);
    const log = [
      { id: t0, ease: 3, type: 0, ivl: 1, time: 9000 },
      { id: t0 + 2 * day, ease: 1, type: 1, ivl: 0, time: 12000 },
      { id: t0 + 3 * day, ease: 0, type: 4, ivl: 0, time: 0 }, // Forget
      { id: t0 + 4 * day, ease: 3, type: 0, ivl: 1, time: 5000 },
    ];
    const { card, log: reviews } = replay(log, "1", t0 - day);
    expect(reviews.map((r) => r.grade)).toEqual([3, 1, 3]);
    expect(reviews[2].stateBefore).toBe(0);
    expect(card.reps).toBe(1);
    const kept = withAnkiSchedule({ ...card, state: 2 }, { type: 2, queue: 2, due: 10, ivl: 30, data: '{"s":40,"d":6}' }, t0 / 1000);
    expect(kept).toMatchObject({ stability: 40, difficulty: 6, dueAt: t0 + 10 * day, scheduledDays: 30 });
  });
});
