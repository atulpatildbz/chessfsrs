// Service worker for the web build (GitHub Pages / installed PWA): caches the app so it opens offline.
// The Android app bundles its files, so it doesn't need one.
import { Capacitor } from "@capacitor/core";

export function registerServiceWorker() {
  if (!import.meta.env.PROD || Capacitor.isNativePlatform() || !("serviceWorker" in navigator)) return;
  // New versions install in the background and take over on the next launch (registerType "prompt"
  // with no prompt: nothing reloads an open page).
  void import("virtual:pwa-register").then(({ registerSW }) => registerSW({ immediate: true }));
}
