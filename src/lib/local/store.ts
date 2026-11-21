// This device's copy of the library and the grades not yet on the server, kept in memory for rendering
// and written through to IndexedDB so it survives reloads and works offline.
import { useSyncExternalStore } from "react";
import { applyOutbox, confirmed, mergePull, type LocalPuzzle, type Op } from "../../../lib/offline";
import { clear, entries, write } from "./idb";

export type LocalSettings = {
  desiredRetention: number;
  newPerDay: number;
  boardTheme: string;
  sound: boolean;
  chesscomUsername?: string;
  lichessUsername?: string;
};
export type LocalMe = { id: string; email: string };

type State = {
  loaded: boolean;
  me: LocalMe | null;
  settings: LocalSettings | null;
  cursor: number;
  puzzles: Map<string, LocalPuzzle>;
  ops: Op[];
  queries: Map<string, unknown>;
};

let state: State = { loaded: false, me: null, settings: null, cursor: 0, puzzles: new Map(), ops: [], queries: new Map() };
let version = 0;
const listeners = new Set<() => void>();
const emit = () => { version++; for (const l of listeners) l(); };
const set = (patch: Partial<State>) => { state = { ...state, ...patch }; emit(); };

// IndexedDB writes run one after another, so a later write never lands before an earlier one.
let chain: Promise<unknown> = Promise.resolve();
const persist = (f: () => Promise<unknown>) => { chain = chain.then(f).catch((e) => console.error("local store write failed", e)); };

// Outbox keys sort in the order the ops were made.
let seq = 0;
const opKey = (op: Op & { seq?: number }) => `${String(op.seq ?? 0).padStart(12, "0")}:${op.opId}`;
type StoredOp = Op & { seq: number };

export async function loadLocal(): Promise<void> {
  try {
    const [kv, puzzles, ops] = await Promise.all([entries<unknown>("kv"), entries<LocalPuzzle>("puzzles"), entries<StoredOp>("outbox")]);
    const k = new Map(kv);
    const queries = new Map(kv.filter(([key]) => key.startsWith("q:")).map(([key, v]) => [key.slice(2), v]));
    ops.sort(([a], [b]) => (a < b ? -1 : 1));
    seq = Math.max(0, ...ops.map(([, o]) => o.seq ?? 0));
    state = {
      loaded: true,
      me: (k.get("me") as LocalMe) ?? null,
      settings: (k.get("settings") as LocalSettings) ?? null,
      cursor: (k.get("cursor") as number) ?? 0,
      puzzles: new Map(puzzles),
      ops: ops.map(([, o]) => o),
      queries,
    };
  } catch (e) {
    // Private mode or storage blocked: run online-only from memory.
    console.error("local store unavailable", e);
    state = { ...state, loaded: true };
  }
  emit();
}

export const getLocal = () => state;

/** Signed in as someone else than the copy belongs to: start over. */
export function resetFor(me: LocalMe) {
  const sameUser = state.me?.id === me.id;
  if (sameUser) {
    if (state.me!.email !== me.email) { set({ me }); persist(() => write("kv", [["me", me]])); }
    return;
  }
  state = { loaded: true, me, settings: null, cursor: 0, puzzles: new Map(), ops: [], queries: new Map() };
  emit();
  persist(async () => {
    await Promise.all([clear("puzzles"), clear("outbox"), clear("kv")]);
    await write("kv", [["me", me]]);
  });
}

export function forgetLocal() {
  state = { loaded: true, me: null, settings: null, cursor: 0, puzzles: new Map(), ops: [], queries: new Map() };
  emit();
  persist(() => Promise.all([clear("puzzles"), clear("outbox"), clear("kv")]));
}

export function setSettings(settings: LocalSettings) {
  if (JSON.stringify(settings) === JSON.stringify(state.settings)) return;
  set({ settings });
  persist(() => write("kv", [["settings", settings]]));
}

export function applyPull(pull: { puzzles: LocalPuzzle[]; deleted: { id: string; at: number }[] }) {
  const r = mergePull(state.puzzles, pull, state.cursor);
  if (!r.changed && r.cursor === state.cursor) return;
  const changes: [string, unknown][] = [];
  if (r.changed) {
    for (const p of pull.puzzles) if (r.puzzles.get(p._id) === p) changes.push([p._id, p]);
    for (const d of pull.deleted) changes.push([d.id, undefined]);
  }
  const ops = state.ops.filter((op) => !confirmed(op, r.puzzles));
  const dropped = state.ops.filter((op) => !ops.includes(op));
  set({ puzzles: r.puzzles, cursor: r.cursor, ops });
  persist(async () => {
    await write("puzzles", changes);
    await write("kv", [["cursor", r.cursor]]);
    await write("outbox", dropped.map((op) => [opKey(op), undefined]));
  });
}

export function enqueue(op: Op) {
  const stored: StoredOp = { ...op, seq: ++seq };
  set({ ops: [...state.ops, stored] });
  persist(() => write("outbox", [[opKey(stored), stored]]));
}

export function updateOp(opId: string, patch: Partial<Op>) {
  const ops = state.ops.map((o) => (o.opId === opId ? ({ ...o, ...patch } as Op) : o));
  const op = ops.find((o) => o.opId === opId);
  if (!op) return;
  const keep = !confirmed(op, state.puzzles);
  set({ ops: keep ? ops : ops.filter((o) => o !== op) });
  persist(() => write("outbox", [[opKey(op), keep ? op : undefined]]));
}

/**
 * The op the flusher has handed to Convex. It will reach the server even if removed here, so undoing
 * it needs an undo op rather than deleting it.
 */
let inFlight: string | null = null;
export const setInFlight = (opId: string | null) => { inFlight = opId; };
export const isInFlight = (opId: string) => inFlight === opId;

export function removeOp(opId: string) {
  const op = state.ops.find((o) => o.opId === opId);
  if (!op) return;
  set({ ops: state.ops.filter((o) => o !== op) });
  persist(() => write("outbox", [[opKey(op), undefined]]));
}

export function cacheQuery(key: string, value: unknown) {
  if (JSON.stringify(state.queries.get(key)) === JSON.stringify(value)) return;
  const queries = new Map(state.queries);
  queries.set(key, value);
  set({ queries });
  persist(() => write("kv", [[`q:${key}`, value]]));
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };

export function useLocal(): State {
  return useSyncExternalStore(subscribe, getLocal);
}

// The overlaid library is rebuilt only when puzzles, outbox or retention change.
let memo: { puzzles: Map<string, LocalPuzzle>; ops: Op[]; r: number; out: Map<string, LocalPuzzle> } | null = null;
export function effectivePuzzles(s: State = state): Map<string, LocalPuzzle> {
  const r = s.settings?.desiredRetention ?? 0.9;
  if (!memo || memo.puzzles !== s.puzzles || memo.ops !== s.ops || memo.r !== r) memo = { puzzles: s.puzzles, ops: s.ops, r, out: applyOutbox(s.puzzles, s.ops, r) };
  return memo.out;
}

/** The library with not-yet-synced grades applied. */
export function usePuzzles(): Map<string, LocalPuzzle> {
  return effectivePuzzles(useLocal());
}

export const localVersion = () => version;
