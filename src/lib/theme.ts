// Light or dark, chosen per device (it's about the room you're in, not the account), so it lives in
// localStorage and applies before the first paint (see the script in index.html).
import { useSyncExternalStore } from "react";
import { Capacitor, SystemBars, SystemBarsStyle } from "@capacitor/core";

export type ThemePref = "system" | "light" | "dark";
const KEY = "chessfsrs.theme";
const BG = { dark: "#17120e", light: "#f1e6cb" };
const WEBVIEW = Number(navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? 0);
const media = window.matchMedia("(prefers-color-scheme: light)");

function read(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

let pref = read();
const listeners = new Set<() => void>();

function apply() {
  const theme = pref === "system" ? (media.matches ? "light" : "dark") : pref;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BG[theme]);
  // Status bar icons: dark on the light theme, light on the dark one. Before WebView 140 Capacitor
  // keeps the page out from under the bars, which then show the window background, and that
  // follows the device's day/night setting (res/values-night), so the icons follow it too.
  if (Capacitor.isNativePlatform()) {
    const style = WEBVIEW >= 140 ? (theme === "light" ? SystemBarsStyle.Light : SystemBarsStyle.Dark) : SystemBarsStyle.Default;
    void SystemBars.setStyle({ style }).catch(() => {});
  }
}

export function setThemePref(p: ThemePref) {
  pref = p;
  try { if (p === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p); } catch { /* private mode: this session only */ }
  apply();
  for (const l of listeners) l();
}

export function initTheme() {
  apply();
  media.addEventListener("change", apply);
}

export function useThemePref(): ThemePref {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => pref);
}
