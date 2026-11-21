// Keeps the local copy in step with the server whenever there's a connection: pulls changed puzzles,
// caches settings, and sends queued grades in order. There's nothing to press; it runs while signed in.
import { useEffect, useState } from "react";
import { useConvex, useConvexAuth, useConvexConnectionState, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import type { FunctionReference } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { applyPull, cacheQuery, getLocal, removeOp, setInFlight, setSettings, updateOp, useLocal } from "./store";

/** Errors after which an op can never apply. Anything else (not signed in yet, network) is retried. */
const PERMANENT = ["Puzzle not found", "Bad grade"];

export function SyncEngine() {
  const { isAuthenticated } = useConvexAuth();
  const local = useLocal();
  const pull = useQuery(api.sync.pull, isAuthenticated && local.loaded ? { since: local.cursor } : "skip");
  const settings = useQuery(api.settings.get, isAuthenticated ? {} : "skip");

  useEffect(() => { if (pull && pull.userId === getLocal().me?.id) applyPull(pull); }, [pull]);
  useEffect(() => { if (settings) setSettings(settings); }, [settings]);
  useFlush(isAuthenticated);
  usePrefetch(isAuthenticated);
  return null;
}

/**
 * Pages built on server-side stats would wait for a round trip on first open. Fetch them once on a
 * device that has no copy yet, shortly after start-up; after that the page opens from the copy and
 * refreshes it live while open.
 */
function usePrefetch(isAuthenticated: boolean) {
  const convex = useConvex();
  useEffect(() => {
    if (!isAuthenticated || getLocal().queries.has("patterns")) return;
    const me = getLocal().me?.id;
    let live = true;
    const t = setTimeout(() => {
      convex.query(api.stats.patterns, {}).then((v) => { if (live && v && getLocal().me?.id === me) cacheQuery("patterns", v); }, () => {});
    }, 2_000);
    return () => { live = false; clearTimeout(t); };
  }, [isAuthenticated, convex]);
}

// Module-wide, so a remounted SyncEngine never sends an op that's already on its way, and the
// mounted one is woken when a send finishes (even one started by an earlier mount).
let busy = false;
let wake: (() => void) | null = null;

/** Send outbox ops one at a time, in order, while authenticated. */
function useFlush(isAuthenticated: boolean) {
  const convex = useConvex();
  const { ops } = useLocal();
  const [kick, setKick] = useState(0);
  useEffect(() => {
    const w = () => setKick((k) => k + 1);
    wake = w;
    return () => { if (wake === w) wake = null; };
  }, []);

  useEffect(() => {
    if (!isAuthenticated || busy) return;
    const op = getLocal().ops.find((o) => o.ack === undefined);
    if (!op) return;
    busy = true;
    setInFlight(op.opId);
    void (async () => {
      try {
        // While offline the Convex client holds the request and resends it on reconnect; after a
        // reload the op is still queued and goes again, and the server applies an opId only once.
        const r = op.kind === "review"
          ? await convex.mutation(api.practice.review, {
              id: op.puzzleId as Id<"puzzles">, grade: op.grade, durationMs: op.durationMs, mistakes: op.mistakes, hints: op.hints,
              revealed: op.revealed, expectedReps: op.expectedReps, opId: op.opId, reviewedAt: op.reviewedAt,
            })
          : await convex.mutation(api.practice.undo, { opId: op.targetOpId });
        updateOp(op.opId, { ack: r.updatedAt });
      } catch (e) {
        if (e instanceof ConvexError && PERMANENT.includes(String(e.data))) removeOp(op.opId); // e.g. the puzzle was deleted
        else await new Promise((res) => setTimeout(res, 5_000)); // try again shortly
      } finally {
        setInFlight(null);
        busy = false;
        wake?.();
      }
    })();
  }, [isAuthenticated, ops, kick, convex]);
}

/**
 * useQuery that remembers its last result on this device and returns it while the live one isn't
 * available (offline, or still loading after a reload).
 */
export function useCachedQuery<Q extends FunctionReference<"query">>(query: Q, args: Q["_args"] | "skip", key: string): Q["_returnType"] | undefined {
  const { isAuthenticated } = useConvexAuth();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const live = (useQuery as any)(query, isAuthenticated && args !== "skip" ? args : "skip") as Q["_returnType"] | undefined;
  const { queries } = useLocal();
  useEffect(() => { if (live !== undefined) cacheQuery(key, live); }, [key, live]);
  return live ?? (queries.get(key) as Q["_returnType"] | undefined);
}

/** True while there's no working connection to the server. */
export function useOffline(): boolean {
  const c = useConvexConnectionState();
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", on); };
  }, []);
  return !online || (c.hasEverConnected ? !c.isWebSocketConnected : false);
}
