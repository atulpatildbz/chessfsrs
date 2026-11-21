import { useEffect, useState } from "react";
import { useConvexAuth, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { MiniBoard } from "../components/Board";
import { forgetLocal, useLocal } from "../lib/local/store";
import { useOffline } from "../lib/local/sync";
import { setThemePref, useThemePref, type ThemePref } from "../lib/theme";

const BOARDS: [string, string][] = [["walnut", "Walnut"], ["felt", "Tournament"], ["slate", "Slate"]];

export function Settings({ email }: { email: string }) {
  const { settings: s, ops } = useLocal();
  const save = useMutation(api.settings.update);
  const { isAuthenticated } = useConvexAuth();
  const offline = useOffline();
  const canEdit = isAuthenticated && !offline;
  const update = (patch: Parameters<typeof save>[0]) => { if (canEdit) void save(patch); };
  const { signOut } = useAuthActions();
  const unsynced = ops.filter((o) => o.ack === undefined).length;
  const doSignOut = () => {
    if (unsynced && !confirm(`${unsynced} grade${unsynced === 1 ? " hasn't" : "s haven't"} reached the server yet and will be lost. Sign out anyway?`)) return;
    forgetLocal();
    void signOut();
  };
  const [retention, setRetention] = useState(90);
  const [newPerDay, setNewPerDay] = useState(15);

  useEffect(() => { if (s) { setRetention(Math.round(s.desiredRetention * 100)); setNewPerDay(s.newPerDay); } }, [s?.desiredRetention, s?.newPerDay]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;

  return (
    <div className="mx-auto max-w-2xl px-5 py-6 md:px-10 md:py-10">
      <h1 className="font-serif text-[2.1rem] leading-none">Settings</h1>
      {!canEdit && <p className="mt-3 text-sm text-dim" role="status">Offline. Changes need a connection.</p>}

      <section className="mt-8 space-y-6">
        <h2 className="font-serif text-2xl">Practice</h2>
        <label className="block">
          <div className="flex justify-between text-sm"><span>New puzzles per day</span><span className="text-dim">{newPerDay}</span></div>
          <input type="range" disabled={!canEdit} min={0} max={100} step={1} value={newPerDay} onChange={(e) => setNewPerDay(Number(e.target.value))} onPointerUp={() => update({ newPerDay })} onKeyUp={() => update({ newPerDay })} className="mt-2 w-full accent-[var(--color-ink)]" />
        </label>
        <label className="block">
          <div className="flex justify-between text-sm"><span>Target recall</span><span className="text-dim">{retention}%</span></div>
          <input type="range" disabled={!canEdit} min={75} max={97} step={1} value={retention} onChange={(e) => setRetention(Number(e.target.value))} onPointerUp={() => update({ desiredRetention: retention / 100 })} onKeyUp={() => update({ desiredRetention: retention / 100 })} className="mt-2 w-full accent-[var(--color-ink)]" />
          <p className="mt-1 text-xs text-dim">How likely you should be to solve a puzzle when it comes back. Higher means more reviews; 90% is a good balance.</p>
        </label>
        <Toggle label="Sounds" on={s.sound} disabled={!canEdit} onChange={(v) => update({ sound: v })} />
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl">Appearance</h2>
        <ThemePicker />
        <p className="mt-2 text-xs text-dim">Saved on this device only.</p>
      </section>

      <section className="mt-10">
        <h2 className="font-serif text-2xl">Board</h2>
        <div className="mt-4 grid grid-cols-3 gap-4">
          {BOARDS.map(([id, name]) => (
            <button key={id} disabled={!canEdit} onClick={() => { document.documentElement.dataset.board = id; update({ boardTheme: id }); }} aria-pressed={s.boardTheme === id} className={`rounded-lg p-2 text-sm disabled:opacity-60 ${s.boardTheme === id ? "bg-paper-2 ring-1 ring-ink" : "hover:bg-paper-2"}`}>
              <div data-board-preview={id} style={{ ["--sq-light" as string]: id === "felt" ? "#e9e4cf" : id === "slate" ? "#dee3e6" : "#e6cfa1", ["--sq-dark" as string]: id === "felt" ? "#6e9168" : id === "slate" ? "#8ca2ad" : "#a87a4f" }}>
                <MiniBoard fen="r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3" orientation="white" />
              </div>
              <span className="mt-2 block">{name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="font-serif text-2xl">Accounts for game scans</h2>
        <UsernameField disabled={!canEdit} label="chess.com username" value={s.chesscomUsername ?? ""} onSave={(v) => update({ chesscomUsername: v })} />
        <UsernameField disabled={!canEdit} label="lichess username" value={s.lichessUsername ?? ""} onSave={(v) => update({ lichessUsername: v })} />
      </section>

      <section className="mt-10 border-t border-line pt-6">
        <p className="text-sm text-dim">Signed in as {email}</p>
        <button className="btn btn-ghost mt-3" onClick={doSignOut} disabled={!canEdit}>Sign out</button>
      </section>
    </div>
  );
}

const THEMES: [ThemePref, string][] = [["system", "Match device"], ["light", "Light"], ["dark", "Dark"]];

function ThemePicker() {
  const pref = useThemePref();
  return (
    <div role="radiogroup" aria-label="Theme" className="mt-4 grid grid-cols-3 rounded-lg border border-line p-1 text-sm">
      {THEMES.map(([id, label]) => (
        <button key={id} type="button" role="radio" aria-checked={pref === id} onClick={() => setThemePref(id)}
          className={`rounded-md py-2 font-medium transition-colors ${pref === id ? "bg-ink text-paper" : "text-dim hover:text-ink"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, on, disabled, onChange }: { label: string; on: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-sm">
      <span>{label}</span>
      <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)} className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${on ? "bg-ink" : "bg-paper-3"}`}>
        <span className={`absolute left-0 top-0.5 h-5 w-5 rounded-full transition-transform ${on ? "translate-x-5 bg-paper" : "translate-x-0.5 bg-dim"}`} />
      </button>
    </label>
  );
}

function UsernameField({ label, value, disabled, onSave }: { label: string; value: string; disabled?: boolean; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="flex flex-col gap-1.5 text-sm text-dim">{label}
      <input className="field text-ink disabled:opacity-60" disabled={disabled} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} autoCapitalize="none" autoCorrect="off" />
    </label>
  );
}
