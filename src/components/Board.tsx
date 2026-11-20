// React wrapper around Lichess' chessground board.
import { useEffect, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";
import { Chess, SQUARES } from "chess.js";

export type BoardApi = Api;

export function legalDests(chess: Chess): Map<Key, Key[]> {
  const dests = new Map<Key, Key[]>();
  for (const s of SQUARES) {
    const ms = chess.moves({ square: s, verbose: true });
    if (ms.length) dests.set(s as Key, ms.map((m) => m.to as Key));
  }
  return dests;
}

export function Board({ config, onReady, className = "" }: { config: Config; onReady?: (api: Api) => void; className?: string }) {
  const el = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);

  useEffect(() => {
    if (!el.current) return;
    api.current = Chessground(el.current, { animation: { duration: 220 }, ...config });
    onReady?.(api.current);
    return () => api.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api.current?.set(config);
  }, [config]);

  return (
    <div className={`board-frame ${className}`}>
      <div ref={el} />
    </div>
  );
}

/** Static thumbnail of a position. */
export function MiniBoard({ fen, orientation, lastMove }: { fen: string; orientation: "white" | "black"; lastMove?: [Key, Key] }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!el.current) return;
    const cg = Chessground(el.current, { fen, orientation, viewOnly: true, coordinates: false, lastMove, animation: { enabled: false }, drawable: { enabled: false } });
    return () => cg.destroy();
  }, [fen, orientation, lastMove]);
  return (
    <div className="board-frame board-mini">
      <div ref={el} />
    </div>
  );
}
