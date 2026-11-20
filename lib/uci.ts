// Minimal UCI client over any line transport (a Web Worker in the browser, a child process in tests).
import { MATE, type Engine, type EngineLine } from "./mining";

export type Transport = { send(cmd: string): void; onLine(cb: (line: string) => void): void; close?(): void };

const aborted = () => new DOMException("Aborted", "AbortError");

export class UciEngine implements Engine {
  private queue: Promise<unknown> = Promise.resolve();
  private listener: ((line: string) => void) | null = null;
  private pending: ((e: Error) => void) | null = null;
  private failure: Error | null = null;
  private ready: Promise<void>;
  private fresh = true;

  constructor(private t: Transport, hashMb = 32) {
    t.onLine((line) => this.listener?.(line));
    this.ready = this.exchange("uci", (l) => l === "uciok").then(async () => {
      t.send(`setoption name Hash value ${hashMb}`);
      await this.exchange("isready", (l) => l === "readyok");
    });
    this.ready.catch(() => undefined);
  }

  /** The engine died (e.g. the WASM failed to load): fail the current and all later calls. */
  fail(e: Error) {
    this.failure = e;
    this.listener = null;
    this.pending?.(e);
    this.pending = null;
  }

  private exchange(cmd: string, done: (line: string) => boolean, onLine?: (line: string) => void): Promise<void> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.pending = reject;
      this.listener = (line) => {
        onLine?.(line);
        if (done(line)) {
          this.listener = null;
          this.pending = null;
          resolve();
        }
      };
      this.t.send(cmd);
    });
  }

  /** Clear the hash before the next search (once per game). */
  newGame() {
    this.fresh = true;
  }

  analyse(fen: string, opts: { depth: number; nodes?: number; multipv: number; signal?: AbortSignal }): Promise<EngineLine[]> {
    const { signal } = opts;
    const run = async () => {
      await abortable(this.ready, signal);
      if (signal?.aborted) throw aborted();
      this.t.send(`setoption name MultiPV value ${opts.multipv}`);
      if (this.fresh) {
        this.t.send("ucinewgame");
        await this.exchange("isready", (l) => l === "readyok");
        this.fresh = false;
      }
      if (signal?.aborted) throw aborted();
      this.t.send(`position fen ${fen}`);
      // Lines per depth: a node limit can stop the search halfway through a depth's MultiPV lines,
      // and mixing lines from different depths gives bogus best-vs-second gaps.
      const byDepth = new Map<number, Map<number, EngineLine>>();
      const onAbort = () => this.t.send("stop");
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        await this.exchange(`go depth ${opts.depth}${opts.nodes ? ` nodes ${opts.nodes}` : ""}`, (l) => l.startsWith("bestmove"), (l) => {
          const parsed = parseInfo(l);
          if (!parsed) return;
          let d = byDepth.get(parsed.depth);
          if (!d) byDepth.set(parsed.depth, (d = new Map()));
          d.set(parsed.multipv, parsed.line);
        });
      } finally {
        signal?.removeEventListener("abort", onAbort);
      }
      if (signal?.aborted) throw aborted();
      return completeLines(byDepth, opts.multipv);
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  close() {
    this.fail(new Error("Engine closed"));
    this.t.send("quit");
    this.t.close?.();
  }
}

/** Lines of the deepest depth that reported all of its MultiPV lines (fewer when there are fewer legal moves). */
export function completeLines(byDepth: Map<number, Map<number, EngineLine>>, multipv: number): EngineLine[] {
  const want = Math.min(multipv, Math.max(0, ...[...byDepth.values()].map((d) => d.size)));
  const depths = [...byDepth.keys()].sort((a, b) => b - a);
  for (const depth of depths) {
    const lines = byDepth.get(depth)!;
    if (lines.size >= want) {
      const sorted = [...lines.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
      return sorted.filter((l, i) => sorted.findIndex((x) => x.uci === l.uci) === i);
    }
  }
  return [];
}

function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const on = () => reject(aborted());
    signal.addEventListener("abort", on, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", on));
  });
}

/** Parse a UCI `info` line with a score and PV. Ignores bound (lowerbound/upperbound) updates. */
export function parseInfo(l: string): { depth: number; multipv: number; line: EngineLine } | null {
  if (!l.startsWith("info") || !l.includes(" pv ") || !l.includes(" score ")) return null;
  if (l.includes(" lowerbound") || l.includes(" upperbound")) return null;
  const tok = l.split(" ");
  const at = (k: string) => tok.indexOf(k);
  const depth = at("depth") >= 0 ? Number(tok[at("depth") + 1]) : 0;
  const multipv = at("multipv") >= 0 ? Number(tok[at("multipv") + 1]) : 1;
  const s = at("score");
  const kind = tok[s + 1];
  const val = Number(tok[s + 2]);
  const pv = tok.slice(at("pv") + 1).filter(Boolean);
  if (!pv.length) return null;
  const mate = kind === "mate" ? val : null;
  const cp = kind === "mate" ? (val > 0 ? MATE : -MATE) : val;
  return { depth, multipv, line: { uci: pv[0], cp, mate, pv } };
}
