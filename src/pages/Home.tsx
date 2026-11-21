import { useMemo } from "react";
import { api } from "../../convex/_generated/api";
import { MiniBoard } from "../components/Board";
import { Heatmap } from "../components/Heatmap";
import { Logo } from "../components/Logo";
import { startOfToday, useNow } from "../lib/time";
import { figurine, sideName } from "../lib/notation";
import { buildQueue, type LocalPuzzle } from "../../lib/offline";
import { useLocal, usePuzzles } from "../lib/local/store";
import { useCachedQuery } from "../lib/local/sync";

export function Home() {
  const now = useNow(30_000);
  const dayStart = useMemo(() => startOfToday(), [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const tz = new Date().getTimezoneOffset();
  // Streak, heatmap and recall come from the server's review log; offline they show the last copy.
  const d = useCachedQuery(api.stats.dashboard, { now, dayStart, tzOffsetMin: tz }, "dashboard");
  const puzzles = usePuzzles();
  const { settings, ops } = useLocal();
  const q = useMemo(() => buildQueue(puzzles.values(), { now, dayStart, newPerDay: settings?.newPerDay ?? 15 }), [puzzles, now, dayStart, settings?.newPerDay]);

  const all = [...puzzles.values()];
  const active = all.filter((p) => !p.suspended);
  const counts = {
    total: all.length,
    new: active.filter((p) => p.card.state === 0).length,
    learning: active.filter((p) => p.card.state === 1 || p.card.state === 3).length,
    known: active.filter((p) => p.card.state === 2).length,
  };
  const soonest = active.filter((p) => p.card.state !== 0 && p.card.dueAt > now).sort((a, b) => a.card.dueAt - b.card.dueAt)[0];
  const next = q.due[0] ?? q.fresh[0];
  const total = q.due.length + q.fresh.length;
  // Grades made offline aren't in the server's log yet.
  const unsynced = ops.filter((o) => o.kind === "review" && o.ack === undefined && o.reviewedAt >= dayStart).length;

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-12">
      <header className="mb-8 flex items-center justify-between md:hidden">
        <span className="flex items-center gap-2 font-semibold tracking-tight"><Logo className="h-5 w-5 text-boxwood" />chessfsrs</span>
        <a href="#/settings" className="text-sm text-dim">Settings</a>
      </header>

      {counts.total === 0 ? (
        <section className="grid items-center gap-8 md:grid-cols-[minmax(0,420px)_1fr] md:gap-12">
          <div className="order-2 md:order-none">
            <MiniBoard fen="3r2k1/ppp2pp1/2nn3p/1B2P3/8/5b2/PPP2PPP/3R1RK1 w - - 0 17" orientation="white" lastMove={["g4", "f3"]} />
          </div>
          <div className="order-1 md:order-none">
            <h1 className="font-serif text-[2.4rem] leading-[1.05] tracking-tight md:text-5xl">Train on the moves you missed.</h1>
            <p className="prose-serif mt-4 max-w-md text-dim">
              Scan your chess.com and lichess games for moments where only one move worked and you played something else. Each one becomes a puzzle, and it comes back right before you'd forget it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a className="btn btn-primary" href="#/import">Scan my games</a>
              <a className="btn btn-ghost" href="#/add">Paste a puzzle</a>
            </div>
          </div>
        </section>
      ) : (
        <section className="grid items-start gap-8 md:grid-cols-[minmax(0,380px)_1fr] md:gap-12">
          <a href="#/practice" tabIndex={-1} aria-hidden="true" className="order-2 mx-auto block w-full max-w-[min(100%,max(220px,calc(100dvh-26rem)))] md:order-none md:max-w-none">
            {next ? (
              <MiniBoard fen={next.fen} orientation={next.solver === "w" ? "white" : "black"} />
            ) : soonest ? (
              <div className="opacity-50 saturate-50"><MiniBoard fen={soonest.fen} orientation={soonest.solver === "w" ? "white" : "black"} /></div>
            ) : (
              <MiniBoard fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" orientation="white" />
            )}
          </a>
          <div className="order-1 md:order-none">
            {next ? (
              <>
                <h1 className="font-serif text-[2.4rem] leading-[1.05] tracking-tight md:text-[3.2rem]">
                  {total} position{total === 1 ? "" : "s"}
                  <span className="block text-dim">to look at again.</span>
                </h1>
                <p className="prose-serif mt-5 max-w-md text-[#cdbf9f]"><FirstUp p={next} /></p>
                <a className="btn btn-primary mt-6 flex w-full !justify-between !px-5 !py-3.5 text-base md:max-w-md" href="#/practice">
                  Start practice
                  <span className="text-sm font-medium opacity-60">{[q.due.length && `${q.due.length} review${q.due.length === 1 ? "" : "s"}`, q.fresh.length && `${q.fresh.length} new`].filter(Boolean).join(", ")}</span>
                </a>
              </>
            ) : (
              <>
                <h1 className="font-serif text-[2.4rem] leading-[1.05] tracking-tight md:text-[3.2rem]">
                  All caught up.
                  {soonest && <span className="block text-dim">Next one {relTime(soonest.card.dueAt, now)}.</span>}
                </h1>
                <p className="prose-serif mt-5 max-w-md text-dim">Scan more games to keep the queue full of your own mistakes.</p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a className="btn btn-primary" href="#/import">Scan new games</a>
                  <a className="btn btn-ghost" href="#/library">Browse library</a>
                </div>
              </>
            )}

            <dl className="mt-8 max-w-md border-t border-line text-[0.95rem]">
              {d && <Row label="Streak" value={`${d.streak} day${d.streak === 1 ? "" : "s"}`} />}
              {d && <Row label="Today" value={todayLabel(d.today, unsynced)} />}
              {d && <Row label="Recall, last 30 days" value={d.retention === null ? "after your first reviews" : `${Math.round(d.retention * 100)}%`} />}
              <Row label="Library" value={`${counts.total} puzzle${counts.total === 1 ? "" : "s"}`} href="#/library" />
              <Row label="Being learned" value={`${counts.new} new, ${counts.learning} learning, ${counts.known} known`} />
            </dl>
          </div>
        </section>
      )}

      {d && counts.total > 0 && (
        <section className="mt-14 min-w-0">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-serif text-2xl">Last year</h2>
            <span className="text-sm text-dim">{d.totalReviews} review{d.totalReviews === 1 ? "" : "s"}</span>
          </div>
          <Heatmap perDay={d.perDay} todayIndex={d.todayIndex} />
        </section>
      )}
    </div>
  );
}

/** "First, your game vs X. On move 28 you played ♝d6? and the only move was ♘d6!" */
function FirstUp({ p }: { p: LocalPuzzle }) {
  if (!p.game) return <>First up: {p.title ?? `${sideName(p.solver)} to play`}.</>;
  const opp = p.solver === "w" ? p.game.black : p.game.white;
  const moveNo = p.game.moveLabel.match(/^\d+/)?.[0];
  return (
    <>
      First, your game vs {opp}.{moveNo ? ` On move ${moveNo}` : ""} you played <span className="figurine mv-bad">{figurine(p.game.playedSan)}</span>. Find what
      worked instead.
    </>
  );
}

function Row({ label, value, href }: { label: string; value: string; href?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-2.5">
      <dt className="text-dim">{label}</dt>
      <dd className="text-right">{href ? <a className="link" href={href}>{value}</a> : value}</dd>
    </div>
  );
}

function todayLabel(t: { reviews: number; correct: number }, unsynced: number) {
  const n = t.reviews + unsynced;
  if (!n) return "nothing yet";
  return t.reviews ? `${n} done, ${Math.round((t.correct / t.reviews) * 100)}% right` : `${n} done`;
}

function relTime(t: number, now: number) {
  const m = Math.round((t - now) / 60000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  if (t - now < 86_400_000) return `at ${new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return `on ${new Date(t).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`;
}
