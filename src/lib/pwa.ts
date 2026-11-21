// Service worker for the web build (GitHub Pages / installed PWA): caches the app so it opens offline.
// The Android app bundles its files, so it doesn't need one.
import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// A new version installs and takes over in the background straight away (registerType "autoUpdate"),
// so any fresh load gets it. A page that's already open keeps running the old code until a moment a
// reload costs nothing: the next change of screen, or the first seconds after coming back from a
// long time away, before touching anything. Never while a puzzle is under way or something is typed.
const LONG_AWAY = 30 * 60_000;
const RETURN_WINDOW = 10_000;

let holds = 0;
/** Keeps an open page on its current version while `active` (a puzzle under way or awaiting a grade). */
export function useHoldUpdates(active: boolean) {
  useEffect(() => {
    if (!active) return;
    holds++;
    return () => { holds--; };
  }, [active]);
}

const hasTypedText = () =>
  [...document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("textarea, input:not([type=hidden],[type=checkbox],[type=radio],[type=range])")]
    .some((e) => e.value.trim() !== "");

/** `settled` resolves once nothing is left to save (local writes, server calls); reloads wait for it, up to 3 s. */
export function registerServiceWorker(settled: () => Promise<unknown>) {
  if (!import.meta.env.PROD || Capacitor.isNativePlatform() || !("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  let controlled = !!sw.controller;
  let stale = false; // a newer version controls this page than the code it's running
  let hiddenAt: number | null = document.hidden ? Date.now() : null;
  let freshReturn = false; // just back from a long time away, not yet touched
  let returnTimer: ReturnType<typeof setTimeout> | undefined;
  let reloading = false;
  let reg: ServiceWorkerRegistration | undefined;

  const reload = async () => {
    if (reloading) return;
    reloading = true;
    await Promise.race([settled(), new Promise((r) => setTimeout(r, 3000))]);
    location.reload();
  };
  const reloadOnReturn = () => { if (stale && freshReturn && holds === 0 && !hasTypedText()) void reload(); };
  const touched = () => { freshReturn = false; };

  sw.addEventListener("controllerchange", () => {
    if (controlled) { stale = true; reloadOnReturn(); }
    controlled = true; // a first visit's worker claiming the page is the same version
  });
  window.addEventListener("hashchange", () => { if (stale) void reload(); });
  // Old lazily loaded files are gone once a new version is deployed; reload rather than break.
  window.addEventListener("vite:preloadError", (e) => { if (stale) { e.preventDefault(); void reload(); } });
  for (const t of ["pointerdown", "keydown", "wheel"]) addEventListener(t, touched, { capture: true, passive: true });
  document.addEventListener("visibilitychange", () => {
    clearTimeout(returnTimer);
    if (document.hidden) { hiddenAt = Date.now(); freshReturn = false; return; }
    freshReturn = hiddenAt !== null && Date.now() - hiddenAt > LONG_AWAY;
    hiddenAt = null;
    if (freshReturn) returnTimer = setTimeout(touched, RETURN_WINDOW);
    reloadOnReturn(); // a version that arrived while away
    // A resumed tab never navigates, so the browser wouldn't look for a new version on its own.
    void reg?.update().catch(() => {}); // one that's out now reloads from controllerchange
  });

  void sw.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).then((r) => { reg = r; }, () => {});
}
