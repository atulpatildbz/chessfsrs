// Fetch a player's recent games from chess.com and lichess (both public APIs send CORS headers).
export type Site = "chesscom" | "lichess";
export type TimeClass = "bullet" | "blitz" | "rapid" | "classical" | "daily";

export type GameRecord = {
  site: Site;
  id: string;
  url: string;
  pgn: string;
  white: string;
  black: string;
  /** Which colour the user played. */
  userColor: "w" | "b";
  timeClass: TimeClass;
  playedAt: number;
  /** Lichess server analysis, if the game was analysed: eval after each ply, White's view, cp (mate = ±10000). */
  evals?: (number | null)[];
};

/** chess.com asks for serial requests and answers 429 when pushed: wait and retry. */
async function politeFetch(url: string, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { signal });
    if (r.status !== 429 || attempt >= 3) return r;
    await new Promise((ok) => setTimeout(ok, 1500 * 2 ** attempt));
  }
}

const CHESSCOM_TC: Record<string, TimeClass> = { bullet: "bullet", blitz: "blitz", rapid: "rapid", daily: "daily" };

export async function fetchChesscomGames(
  username: string,
  opts: { max: number; timeClasses: TimeClass[]; skip?: (id: string) => boolean; signal?: AbortSignal },
): Promise<GameRecord[]> {
  const u = username.trim().toLowerCase();
  const res = await politeFetch(`https://api.chess.com/pub/player/${encodeURIComponent(u)}/games/archives`, opts.signal);
  if (res.status === 404) throw new Error(`chess.com user "${username}" not found`);
  if (!res.ok) throw new Error(`chess.com: ${res.status} ${res.statusText}`);
  const archives: string[] = (await res.json()).archives ?? [];
  const out: GameRecord[] = [];
  // Look back at most 24 months for enough games.
  for (const url of archives.slice().reverse().slice(0, 24)) {
    if (out.length >= opts.max) break;
    const r = await politeFetch(url, opts.signal);
    if (!r.ok) continue;
    const games: Record<string, any>[] = (await r.json()).games ?? [];
    for (const g of games.reverse()) {
      if (out.length >= opts.max) break;
      if (g.rules !== "chess" || !g.pgn) continue;
      const tc = CHESSCOM_TC[g.time_class];
      if (!tc || !opts.timeClasses.includes(tc)) continue;
      const id = String(g.uuid ?? g.url);
      if (opts.skip?.(id)) continue;
      const white = g.white?.username ?? "?";
      const black = g.black?.username ?? "?";
      out.push({
        site: "chesscom",
        id,
        url: g.url,
        pgn: g.pgn,
        white,
        black,
        userColor: white.toLowerCase() === u ? "w" : "b",
        timeClass: tc,
        playedAt: (g.end_time ?? 0) * 1000,
      });
    }
  }
  return out;
}

export async function fetchLichessGames(
  username: string,
  opts: { max: number; timeClasses: TimeClass[]; skip?: (id: string) => boolean; signal?: AbortSignal },
): Promise<GameRecord[]> {
  const u = username.trim();
  const perf: string[] = opts.timeClasses.map((t) => (t === "daily" ? "correspondence" : t));
  // Ask for extra games so that skipping already-analysed ones still leaves `max` new ones.
  const params = new URLSearchParams({
    max: String(Math.min(300, opts.max * 3)),
    perfType: perf.join(","),
    evals: "true",
    pgnInJson: "true",
    clocks: "true",
    opening: "false",
  });
  const res = await fetch(`https://lichess.org/api/games/user/${encodeURIComponent(u)}?${params}`, {
    headers: { Accept: "application/x-ndjson" },
    signal: opts.signal,
  });
  if (res.status === 404) throw new Error(`lichess user "${username}" not found`);
  if (!res.ok) throw new Error(`lichess: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const out: GameRecord[] = [];
  for (const line of text.split("\n")) {
    if (out.length >= opts.max) break;
    if (!line.trim()) continue;
    const g = JSON.parse(line);
    if (g.variant !== "standard" || !g.pgn) continue;
    if (opts.skip?.(g.id)) continue;
    const white = g.players?.white?.user?.name ?? "?";
    const black = g.players?.black?.user?.name ?? "?";
    const speed: string = g.speed;
    out.push({
      site: "lichess",
      id: g.id,
      url: `https://lichess.org/${g.id}`,
      pgn: g.pgn,
      white,
      black,
      userColor: white.toLowerCase() === u.toLowerCase() ? "w" : "b",
      timeClass: (speed === "correspondence" ? "daily" : speed) as TimeClass,
      playedAt: g.createdAt ?? 0,
      evals: Array.isArray(g.analysis)
        ? g.analysis.map((a: { eval?: number; mate?: number }) =>
            typeof a.mate === "number" ? (a.mate > 0 ? 10000 : -10000) : typeof a.eval === "number" ? a.eval : null,
          )
        : undefined,
    });
  }
  return out;
}
