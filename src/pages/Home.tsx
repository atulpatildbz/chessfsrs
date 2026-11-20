import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { MiniBoard } from "../components/Board";
import { Heatmap } from "../components/Heatmap";
import { startOfToday, useNow } from "../lib/time";
import { sideName } from "../lib/notation";

export function Home() {
  const now = useNow(30_000);
  const dayStart = useMemo(() => startOfToday(), [now]); // eslint-disable-line react-hooks/exhaustive-deps
  const tz = new Date().getTimezoneOffset();
  const d = useQuery(api.stats.dashboard, { now, dayStart, tzOffsetMin: tz });
  const q = useQuery(api.practice.queue, { now, dayStart, limit: 1 });

  if (!d || !q) return null;
  const next = q.due[0] ?? q.fresh[0];
  const dueTotal = d.counts.dueNow;
  const newToday = q.newLeft > 0 ? Math.min(q.newLeft, d.counts.new) : 0;
  const empty = d.counts.total === 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-6 md:px-10 md:py-10">
      <header className="mb-8 flex items-center justify-between md:hidden">
        <span className="font-serif text-2xl">chessfsrs</span>
        <a href="#/settings" className="text-sm text-sage">Settings</a>
      </header>

      {empty ? (
        <section className="grid items-center gap-8 md:grid-cols-[minmax(0,420px)_1fr]">
          <MiniBoard fen="3r2k1/ppp2pp1/2nn3p/1B2P3/8/5b2/PPP2PPP/3R1RK1 w - - 0 17" orientation="white" lastMove={["g4", "f3"]} />
          <div>
            <h1 className="font-serif text-4xl leading-tight">Train on the moves you missed.</h1>
            <p className="mt-4 max-w-md text-sage">
              Scan your chess.com and lichess games for moments where only one move worked and you played something else. Each one becomes a puzzle, and FSRS schedules it to come back right before you'd forget it.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a className="btn btn-primary" href="#/import">Scan my games</a>
              <a className="btn btn-ghost" href="#/add">Paste a puzzle</a>
            </div>
          </div>
        </section>
      ) : (
        <section className="grid items-center gap-8 md:grid-cols-[minmax(0,400px)_1fr]">
          <a href="#/practice" className="block transition-transform hover:scale-[1.01]" aria-label="Start practice">
            {next ? (
              <MiniBoard fen={next.fen} orientation={next.solver === "w" ? "white" : "black"} />
            ) : d.soonest ? (
              <div className="opacity-60 saturate-50">
                <MiniBoard fen={d.soonest.fen} orientation={d.soonest.solver === "w" ? "white" : "black"} />
              </div>
            ) : (
              <MiniBoard fen="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" orientation="white" />
            )}
          </a>
          <div>
            {next ? (
              <>
                <h1 className="font-serif text-4xl leading-tight">
                  {dueTotal + newToday} puzzle{dueTotal + newToday === 1 ? "" : "s"} for today
                </h1>
                <p className="mt-3 text-sage">
                  {dueTotal} to review{newToday ? `, ${newToday} new` : ""}. The first is {next.game ? `from your game vs ${next.solver === "w" ? next.game.black : next.game.white}` : `${sideName(next.solver)} to play`}.
                </p>
                <a className="btn btn-primary mt-6 !px-6 !py-3 text-base" href="#/practice">Start practice</a>
              </>
            ) : (
              <>
                <h1 className="font-serif text-4xl leading-tight">All caught up</h1>
                <p className="mt-3 text-sage">
                  {d.soonest ? `Next review ${relTime(d.soonest.dueAt, now)}.` : nextLabel(d)} Scan more games to keep the queue full of your own mistakes.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <a className="btn btn-primary" href="#/import">Scan new games</a>
                  <a className="btn btn-ghost" href="#/library">Browse library</a>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {!empty && (
        <section className="mt-12 grid gap-10 md:grid-cols-[1fr_260px]">
          <div>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="font-serif text-xl">Last year</h2>
              <span className="text-sm text-sage">{d.totalReviews} review{d.totalReviews === 1 ? "" : "s"}</span>
            </div>
            <Heatmap perDay={d.perDay} todayIndex={d.todayIndex} />
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 self-start md:grid-cols-1">
            <Stat label="Streak" value={`${d.streak} day${d.streak === 1 ? "" : "s"}`} />
            <Stat label="Today" value={`${d.today.reviews} done`} sub={d.today.reviews ? `${Math.round((d.today.correct / d.today.reviews) * 100)}% right · ${Math.round(d.today.timeMs / 60000)} min` : undefined} />
            <Stat label="Recall, 30 days" value={d.retention === null ? "–" : `${Math.round(d.retention * 100)}%`} sub={d.retention === null ? "after your first reviews" : `${d.retentionSample} reviews`} />
            <Stat label="Puzzles" value={String(d.counts.total)} sub={`${d.counts.new} new · ${d.counts.learning} learning · ${d.counts.review} known`} />
          </dl>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <dt className="text-sm text-sage">{label}</dt>
      <dd className="font-serif text-2xl">{value}</dd>
      {sub && <dd className="text-xs text-sage">{sub}</dd>}
    </div>
  );
}

function relTime(t: number, now: number) {
  const m = Math.round((t - now) / 60000);
  if (m < 60) return `in ${Math.max(1, m)} min`;
  if (t - now < 86_400_000) return `at ${new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  return `on ${new Date(t).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" })}`;
}

function nextLabel(d: { counts: { dueToday: number } }) {
  return d.counts.dueToday ? "More later today." : "Nothing else today.";
}

