import { useEffect, useRef, useState } from "react";
import { useConvex, useConvexAuth, useMutation } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { useLocal } from "../lib/local/store";
import { useOffline } from "../lib/local/sync";
import { useHoldUpdates } from "../lib/pwa";
import { fetchChesscomGames, fetchLichessGames, type GameRecord, type Site, type TimeClass } from "../../lib/games";
import { minePuzzles, toPuzzleInput, type MinedPuzzle, type Strength } from "../../lib/mining";
import { createEngine } from "../lib/engine";
import { MiniBoard } from "../components/Board";
import { figurine } from "../lib/notation";

const TCS: [TimeClass, string][] = [["bullet", "Bullet"], ["blitz", "Blitz"], ["rapid", "Rapid"], ["classical", "Classical"], ["daily", "Daily"]];
const STRENGTHS: [Strength, string, string][] = [
  ["fast", "Quick", "about 1–3 s a game"],
  ["normal", "Normal", "about 2–6 s a game"],
  ["deep", "Deep", "slower, finds subtler moves"],
];

type Log = { game: GameRecord; found: number; error?: string };

export function ImportGames() {
  const settings = useLocal().settings;
  const { isAuthenticated } = useConvexAuth();
  const offline = useOffline() || !isAuthenticated;
  const updateSettings = useMutation(api.settings.update);
  const saveAnalysis = useMutation(api.games.saveAnalysis);
  const convex = useConvex();

  const [chesscom, setChesscom] = useState("");
  const [lichess, setLichess] = useState("");
  const [count, setCount] = useState(20);
  const [tcs, setTcs] = useState<TimeClass[]>(["blitz", "rapid", "classical"]);
  const [strength, setStrength] = useState<Strength>("normal");
  const [running, setRunning] = useState(false);
  useHoldUpdates(running); // a scan in progress
  const [phase, setPhase] = useState("");
  const [progress, setProgress] = useState<{ game: number; games: number; pos: number; positions: number } | null>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [found, setFound] = useState<MinedPuzzle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const inited = useRef(false);

  useEffect(() => {
    if (settings && !inited.current) {
      inited.current = true;
      setChesscom(settings.chesscomUsername ?? "");
      setLichess(settings.lichessUsername ?? "");
    }
  }, [settings]);

  useEffect(() => () => abort.current?.abort(), []);

  // On a phone the status panel sits below the form, behind the tab bar: bring it into view.
  const status = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (running) status.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [running]);

  async function run() {
    setError(null);
    setLogs([]);
    setFound([]);
    if (!chesscom.trim() && !lichess.trim()) return setError("Enter a chess.com or lichess username.");
    if (!tcs.length) return setError("Pick at least one time control.");
    await updateSettings({ chesscomUsername: chesscom.trim(), lichessUsername: lichess.trim() });
    const ctrl = new AbortController();
    abort.current = ctrl;
    setRunning(true);
    let wake: WakeLockSentinel | null = null;
    try { wake = await navigator.wakeLock?.request("screen"); } catch { /* not supported */ }
    const engine = createEngine();
    try {
      const games: GameRecord[] = [];
      for (const [site, user] of [["chesscom", chesscom], ["lichess", lichess]] as [Site, string][]) {
        if (!user.trim()) continue;
        setPhase(`Fetching games from ${site === "chesscom" ? "chess.com" : "lichess"}…`);
        const seen = new Set(await convex.query(api.games.analyzedIds, { site }));
        const opts = { max: count, timeClasses: tcs, skip: (id: string) => seen.has(id), signal: ctrl.signal };
        try {
          games.push(...(site === "chesscom" ? await fetchChesscomGames(user, opts) : await fetchLichessGames(user, opts)));
        } catch (e) {
          if (ctrl.signal.aborted) throw e;
          setError((e as Error).message);
        }
      }
      if (!games.length) {
        setPhase("No new games to analyse. Games you've scanned before are skipped.");
        return;
      }
      for (const [gi, game] of games.entries()) {
        if (ctrl.signal.aborted) break;
        setPhase(`Analysing ${game.white} vs ${game.black}`);
        setProgress({ game: gi + 1, games: games.length, pos: 0, positions: 1 });
        try {
          const ps = await minePuzzles(game, engine, strength, {
            signal: ctrl.signal,
            onProgress: (pos, positions) => setProgress({ game: gi + 1, games: games.length, pos, positions }),
          });
          const r = await saveAnalysis({
            site: game.site,
            gameId: game.id,
            puzzles: ps.map(toPuzzleInput),
          });
          setLogs((l) => [...l, { game, found: r.added }]);
          if (ps.length) setFound((f) => [...f, ...ps]);
        } catch (e) {
          if (ctrl.signal.aborted) break;
          setLogs((l) => [...l, { game, found: 0, error: (e as Error).message }]);
        }
      }
      setPhase(ctrl.signal.aborted ? "Stopped. Finished games are saved." : "Done.");
    } catch (e) {
      if (!ctrl.signal.aborted) setError((e as Error).message);
      else setPhase("Stopped. Finished games are saved.");
    } finally {
      engine.close();
      void wake?.release();
      setRunning(false);
      setProgress(null);
    }
  }

  const totalFound = logs.reduce((s, l) => s + l.found, 0);

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-[2.1rem] leading-tight">Puzzles from your games</h1>
      <p className="prose-serif mt-3 max-w-2xl text-dim">
        Stockfish goes through your recent games on this device and looks for positions where only one move held and you played something else. Each becomes a puzzle starting just before your opponent's move. Games already scanned are skipped.
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,360px)_1fr]">
        <div className="flex flex-col gap-8">
        <fieldset disabled={running} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-dim">chess.com username
            <input className="field text-ink" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder="Leave empty to skip" autoCapitalize="none" autoCorrect="off" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-dim">lichess username
            <input className="field text-ink" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder="Leave empty to skip" autoCapitalize="none" autoCorrect="off" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-dim">New games to scan, per site
            <select className="field text-ink" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="text-sm text-dim">Time controls
            <div className="mt-1.5 flex flex-wrap gap-2">
              {TCS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setTcs(tcs.includes(v) ? tcs.filter((t) => t !== v) : [...tcs, v])}
                  aria-pressed={tcs.includes(v)} className={`rounded-md border px-3 py-1 text-sm ${tcs.includes(v) ? "border-ink bg-ink text-paper" : "border-line text-dim"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="text-sm text-dim">Depth
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {STRENGTHS.map(([v, l, d]) => (
                <button key={v} type="button" onClick={() => setStrength(v)} title={d}
                  aria-pressed={strength === v} className={`rounded-md border px-2 py-2 text-sm ${strength === v ? "border-ink bg-ink text-paper" : "border-line text-dim"}`}>{l}</button>
              ))}
            </div>
            <p className="mt-1.5 text-xs">{STRENGTHS.find((s) => s[0] === strength)![2]}</p>
          </div>
        </fieldset>
          {/* Outside the fieldset: a disabled fieldset disables every button in it, Stop included. */}
          <div className="-mt-4 flex flex-col gap-3">
            {running ? (
              <button type="button" className="btn btn-ghost" onClick={() => abort.current?.abort()}><X size={16} /> Stop</button>
            ) : (
              <button type="button" className="btn btn-primary" onClick={run} disabled={offline}>Scan games</button>
            )}
            {offline && !running && <p className="text-sm text-dim">Scanning needs a connection to fetch your games.</p>}
            {error && <p className="text-sm text-blunder">{error}</p>}
          </div>
        </div>

        <div className="min-w-0">
          {(running || phase) && (
            <div ref={status} className="panel scroll-mt-4 p-5">
              <div className="flex items-center gap-2">
                {running ? <Loader2 size={16} className="shrink-0 animate-spin text-ink" /> : <Check size={16} className="shrink-0 text-good" />}
                <p className="min-w-0 flex-1 truncate">{phase}</p>
                {running && <button type="button" className="-my-2 -mr-2 shrink-0 px-3 py-2 text-sm text-dim underline-offset-4 hover:underline md:hidden" onClick={() => abort.current?.abort()}>Stop</button>}
              </div>
              {progress && (
                <>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper-3">
                    <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${((progress.game - 1 + progress.pos / Math.max(1, progress.positions)) / progress.games) * 100}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-dim">Game {progress.game} of {progress.games}</p>
                </>
              )}
              {logs.length > 0 && <p className="mt-3 text-sm">{totalFound} new puzzle{totalFound === 1 ? "" : "s"} from {logs.length} game{logs.length === 1 ? "" : "s"}.{!running && totalFound > 0 && <a className="link ml-2" href="#/practice">Practise them</a>}</p>}
            </div>
          )}

          {found.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {found.map((p, i) => (
                <div key={i} className="pop">
                  <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
                  <p className="figurine mt-1.5 truncate text-sm">{p.moveLabel.replace(p.playedSan, figurine(p.playedSan))}</p>
                  <p className="text-xs text-dim">vs {p.solver === "w" ? p.black : p.white}</p>
                </div>
              ))}
            </div>
          )}

          {logs.some((l) => l.error) && (
            <ul className="mt-6 space-y-1 text-sm text-blunder">
              {logs.filter((l) => l.error).map((l, i) => <li key={i}>{l.game.url}: {l.error}</li>)}
            </ul>
          )}

          {!running && !phase && (
            <div className="text-sm text-dim">
              <p>What makes a good puzzle here:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Only one move kept your position; the second-best was clearly worse.</li>
                <li>You played something else and it cost real winning chances.</li>
                <li>You weren't already completely winning or completely lost.</li>
              </ul>
              <p className="mt-3">Short mates are shown in full, and lines continue while the follow-up is also forced.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
