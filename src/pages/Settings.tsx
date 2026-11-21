import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { MiniBoard } from "../components/Board";

const BOARDS: [string, string][] = [["walnut", "Walnut"], ["felt", "Tournament"], ["slate", "Slate"]];

export function Settings({ email }: { email: string }) {
  const s = useQuery(api.settings.get);
  const update = useMutation(api.settings.update);
  const { signOut } = useAuthActions();
  const [retention, setRetention] = useState(90);
  const [newPerDay, setNewPerDay] = useState(15);

  useEffect(() => { if (s) { setRetention(Math.round(s.desiredRetention * 100)); setNewPerDay(s.newPerDay); } }, [s?.desiredRetention, s?.newPerDay]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-3xl">Settings</h1>

      <section className="mt-8 space-y-6">
        <h2 className="font-serif text-xl">Practice</h2>
        <label className="block">
          <div className="flex justify-between text-sm"><span>New puzzles per day</span><span className="text-sage">{newPerDay}</span></div>
          <input type="range" min={0} max={100} step={1} value={newPerDay} onChange={(e) => setNewPerDay(Number(e.target.value))} onPointerUp={() => update({ newPerDay })} onKeyUp={() => update({ newPerDay })} className="mt-2 w-full accent-[var(--color-brass)]" />
        </label>
        <label className="block">
          <div className="flex justify-between text-sm"><span>Target recall</span><span className="text-sage">{retention}%</span></div>
          <input type="range" min={75} max={97} step={1} value={retention} onChange={(e) => setRetention(Number(e.target.value))} onPointerUp={() => update({ desiredRetention: retention / 100 })} onKeyUp={() => update({ desiredRetention: retention / 100 })} className="mt-2 w-full accent-[var(--color-brass)]" />
          <p className="mt-1 text-xs text-sage">How likely you should be to solve a puzzle when it comes back. Higher means more reviews; 90% is a good balance.</p>
        </label>
        <Toggle label="Sounds" on={s.sound} onChange={(v) => update({ sound: v })} />
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-xl">Board</h2>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {BOARDS.map(([id, name]) => (
            <button key={id} onClick={() => { document.documentElement.dataset.board = id; void update({ boardTheme: id }); }} className={`rounded-xl p-2 text-sm ${s.boardTheme === id ? "bg-felt-2 ring-2 ring-brass" : "hover:bg-felt-2"}`}>
              <div data-board-preview={id} style={{ ["--sq-light" as string]: id === "felt" ? "#e9e4cf" : id === "slate" ? "#dee3e6" : "#e6cfa1", ["--sq-dark" as string]: id === "felt" ? "#6e9168" : id === "slate" ? "#8ca2ad" : "#a87a4f" }}>
                <MiniBoard fen="r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3" orientation="white" />
              </div>
              <span className="mt-2 block">{name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="font-serif text-xl">Accounts for game scans</h2>
        <UsernameField label="chess.com username" value={s.chesscomUsername ?? ""} onSave={(v) => update({ chesscomUsername: v })} />
        <UsernameField label="lichess username" value={s.lichessUsername ?? ""} onSave={(v) => update({ lichessUsername: v })} />
      </section>

      <section className="mt-10 border-t border-line/60 pt-6">
        <p className="text-sm text-sage">Signed in as {email}</p>
        <button className="btn btn-ghost mt-3" onClick={() => void signOut()}>Sign out</button>
      </section>
    </div>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={`relative h-6 w-11 rounded-full transition-colors ${on ? "bg-brass" : "bg-felt-3"}`}>
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-bone transition-transform ${on ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </label>
  );
}

function UsernameField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="flex flex-col gap-1.5 text-sm text-sage">{label}
      <input className="field text-bone" value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} autoCapitalize="none" autoCorrect="off" />
    </label>
  );
}
