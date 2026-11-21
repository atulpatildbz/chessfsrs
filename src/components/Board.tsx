// React wrapper around Lichess' chessground board.
import { useEffect, useMemo, useRef } from "react";
import { Chessground } from "@lichess-org/chessground";
import type { Api } from "@lichess-org/chessground/api";
import type { Config } from "@lichess-org/chessground/config";
import type { Key } from "@lichess-org/chessground/types";
import { Chess } from "chess.js";

export type BoardApi = Api;

export function legalDests(chess: Chess): Map<Key, Key[]> {
  // One move generation for the whole position (asking square by square repeats it 64 times).
  const dests = new Map<Key, Key[]>();
  for (const m of chess.moves({ verbose: true })) {
    const list = dests.get(m.from as Key);
    if (list) { if (!list.includes(m.to as Key)) list.push(m.to as Key); } else dests.set(m.from as Key, [m.to as Key]);
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

const PIECE: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };

/**
 * Static thumbnail of a position: plain elements styled by chessground's CSS, no board instance,
 * so a library page of dozens stays light on phones.
 */
export function MiniBoard({ fen, orientation, lastMove }: { fen: string; orientation: "white" | "black"; lastMove?: [Key, Key] }) {
  // Markup as a string: chessground's CSS targets <piece>/<square> elements, which React warns about.
  const html = useMemo(() => {
    const flip = orientation === "black";
    const at = (file: number, rank: number) => `transform:translate(${(flip ? 7 - file : file) * 100}%,${(flip ? rank : 7 - rank) * 100}%)`;
    let out = (lastMove ?? []).map((k) => `<square class="last-move" style="${at(k.charCodeAt(0) - 97, Number(k[1]) - 1)}"></square>`).join("");
    fen.split(" ")[0].split("/").forEach((row, r) => {
      let file = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { file += Number(ch); continue; }
        const color = ch === ch.toUpperCase() ? "white" : "black";
        const name = PIECE[ch.toLowerCase()];
        if (name) out += `<piece class="${color} ${name}" style="${at(file, 7 - r)}"></piece>`;
        file++;
      }
    });
    return `<cg-container><cg-board>${out}</cg-board></cg-container>`;
  }, [fen, orientation, lastMove]);
  return (
    <div className="board-frame board-mini">
      <div className="cg-wrap" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
