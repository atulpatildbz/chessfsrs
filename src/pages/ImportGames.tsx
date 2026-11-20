import { useEffect, useRef, useState } from "react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import { api } from "../../convex/_generated/api";
import { fetchChesscomGames, fetchLichessGames, type GameRecord, type Site, type TimeClass } from "../../lib/games";
import { minePuzzles, type MinedPuzzle, type Strength } from "../../lib/mining";
import { toPgn } from "../../lib/puzzle";
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
  const settings = useQuery(api.settings.get);
  const updateSettings = useMutation(api.settings.update);
  const saveAnalysis = useMutation(api.games.saveAnalysis);
  const convex = useConvex();

  const [chesscom, setChesscom] = useState("");
  const [lichess, setLichess] = useState("");
  const [count, setCount] = useState(20);
  const [tcs, setTcs] = useState<TimeClass[]>(["blitz", "rapid", "classical"]);
  const [strength, setStrength] = useState<Strength>("normal");
  const [running, setRunning] = useState(false);
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
            puzzles: ps.map((p) => ({
              fen: p.fen,
              moves: p.moves,
              solver: p.solver,
              source: p.site,
              pgn: toPgn(p, { Site: p.url, White: p.white, Black: p.black }),
              tags: [],
              game: { url: p.url, white: p.white, black: p.black, timeClass: p.timeClass, playedAt: p.playedAt, moveLabel: p.moveLabel, playedSan: p.playedSan, bestSan: p.bestSan, evalBefore: p.evalBefore, evalBest: p.evalBest, evalPlayed: p.evalPlayed, mate: p.mate },
            })),
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
      <h1 className="font-serif text-3xl">Puzzles from your games</h1>
      <p className="mt-2 max-w-2xl text-sage">
        Stockfish goes through your recent games on this device and looks for positions where only one move held and you played something else. Each becomes a puzzle starting just before your opponent's move. Games already scanned are skipped.
      </p>

      <div className="mt-8 grid gap-8 md:grid-cols-[minmax(0,360px)_1fr]">
        <fieldset disabled={running} className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm text-sage">chess.com username
            <input className="field text-bone" value={chesscom} onChange={(e) => setChesscom(e.target.value)} placeholder="Leave empty to skip" autoCapitalize="none" autoCorrect="off" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-sage">lichess username
            <input className="field text-bone" value={lichess} onChange={(e) => setLichess(e.target.value)} placeholder="Leave empty to skip" autoCapitalize="none" autoCorrect="off" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-sage">New games to scan, per site
            <select className="field text-bone" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[5, 10, 20, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <div className="text-sm text-sage">Time controls
            <div className="mt-1.5 flex flex-wrap gap-2">
              {TCS.map(([v, l]) => (
                <button key={v} type="button" onClick={() => setTcs(tcs.includes(v) ? tcs.filter((t) => t !== v) : [...tcs, v])}
                  className={`rounded-full px-3 py-1 text-sm ${tcs.includes(v) ? "bg-bone text-felt" : "bg-felt-2 text-sage"}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="text-sm text-sage">Depth
            <div className="mt-1.5 grid grid-cols-3 gap-2">
              {STRENGTHS.map(([v, l, d]) => (
                <button key={v} type="button" onClick={() => setStrength(v)} title={d}
                  className={`rounded-lg px-2 py-2 text-sm ${strength === v ? "bg-bone text-felt" : "bg-felt-2 text-sage"}`}>{l}</button>
              ))}
            </div>
            <p className="mt-1.5 text-xs">{STRENGTHS.find((s) => s[0] === strength)![2]}</p>
          </div>
          {running ? (
            <button type="button" className="btn btn-ghost" disabled={false} onClick={() => abort.current?.abort()} style={{ pointerEvents: "auto" }}><X size={16} /> Stop</button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={run}>Scan games</button>
          )}
          {error && <p className="text-sm text-claret">{error}</p>}
        </fieldset>

        <div className="min-w-0">
          {(running || phase) && (
            <div className="panel p-5">
              <div className="flex items-center gap-2">
                {running ? <Loader2 size={16} className="animate-spin text-brass" /> : <Check size={16} className="text-moss" />}
                <p className="truncate">{phase}</p>
              </div>
              {progress && (
                <>
                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-felt-3">
                    <div className="h-full bg-brass transition-[width] duration-300" style={{ width: `${((progress.game - 1 + progress.pos / Math.max(1, progress.positions)) / progress.games) * 100}%` }} />
                  </div>
                  <p className="mt-2 text-sm text-sage">Game {progress.game} of {progress.games}</p>
                </>
              )}
              {logs.length > 0 && <p className="mt-3 text-sm">{totalFound} new puzzle{totalFound === 1 ? "" : "s"} from {logs.length} game{logs.length === 1 ? "" : "s"}.{!running && totalFound > 0 && <a className="ml-2 text-brass hover:underline" href="#/practice">Practise them</a>}</p>}
            </div>
          )}

          {found.length > 0 && (
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
              {found.map((p, i) => (
                <div key={i} className="pop">
                  <MiniBoard fen={p.fen} orientation={p.solver === "w" ? "white" : "black"} />
                  <p className="figurine mt-1.5 truncate text-sm">{p.moveLabel.replace(p.playedSan, figurine(p.playedSan))}</p>
                  <p className="text-xs text-sage">vs {p.solver === "w" ? p.black : p.white}</p>
                </div>
              ))}
            </div>
          )}

          {logs.some((l) => l.error) && (
            <ul className="mt-6 space-y-1 text-sm text-claret">
              {logs.filter((l) => l.error).map((l, i) => <li key={i}>{l.game.url}: {l.error}</li>)}
            </ul>
          )}

          {!running && !phase && (
            <div className="text-sm text-sage">
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
