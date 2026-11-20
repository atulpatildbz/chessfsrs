// Minimal UCI client over any line transport (a Web Worker in the browser, a child process in tests).
import { MATE, type Engine, type EngineLine } from "./mining";

export type Transport = { send(cmd: string): void; onLine(cb: (line: string) => void): void; close?(): void };

export class UciEngine implements Engine {
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  private ready: Promise<void>;

  constructor(private t: Transport, hashMb = 32) {
    t.onLine((line) => this.listener?.(line));
    this.ready = this.exchange("uci", (l) => l === "uciok").then(async () => {
      t.send(`setoption name Hash value ${hashMb}`);
      await this.exchange("isready", (l) => l === "readyok");
    });
  }

  private exchange(cmd: string, done: (line: string) => boolean, onLine?: (line: string) => void): Promise<void> {
    return new Promise((resolve) => {
      this.listener = (line) => {
        onLine?.(line);
        if (done(line)) {
          this.listener = null;
          resolve();
        }
      };
      this.t.send(cmd);
    });
  }

  analyse(fen: string, opts: { depth: number; multipv: number; signal?: AbortSignal }): Promise<EngineLine[]> {
    const run = async () => {
      await this.ready;
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      this.t.send(`setoption name MultiPV value ${opts.multipv}`);
      this.t.send("ucinewgame");
      this.t.send(`position fen ${fen}`);
      const lines = new Map<number, EngineLine>();
      const onAbort = () => this.t.send("stop");
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      await this.exchange(`go depth ${opts.depth}`, (l) => l.startsWith("bestmove"), (l) => {
        const parsed = parseInfo(l);
        if (parsed) lines.set(parsed.multipv, parsed.line);
      });
      opts.signal?.removeEventListener("abort", onAbort);
      if (opts.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  close() {
    this.t.send("quit");
    this.t.close?.();
  }
}

/** Parse a UCI `info` line with a score and PV. Ignores bound (lowerbound/upperbound) updates. */
export function parseInfo(l: string): { multipv: number; line: EngineLine } | null {
  if (!l.startsWith("info") || !l.includes(" pv ") || !l.includes(" score ")) return null;
  if (l.includes(" lowerbound") || l.includes(" upperbound")) return null;
  const tok = l.split(" ");
  const at = (k: string) => tok.indexOf(k);
  const multipv = at("multipv") >= 0 ? Number(tok[at("multipv") + 1]) : 1;
  const s = at("score");
  const kind = tok[s + 1];
  const val = Number(tok[s + 2]);
  const pv = tok.slice(at("pv") + 1).filter(Boolean);
  if (!pv.length) return null;
  const mate = kind === "mate" ? val : null;
  const cp = kind === "mate" ? (val > 0 ? MATE : -MATE) : val;
  return { multipv, line: { uci: pv[0], cp, mate, pv } };
}
