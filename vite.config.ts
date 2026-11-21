import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// BASE_PATH: "/chessfsrs/" for GitHub Pages, "./" for the Capacitor (Android) build, "/" in dev.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // The Android build bundles its files and registers no worker (src/lib/pwa.ts).
      injectRegister: false,
      disable: process.env.BASE_PATH === "./",
      // A new version takes over at once; open pages reload at a safe moment (src/lib/pwa.ts).
      registerType: "autoUpdate",
      manifest: false, // public/manifest.webmanifest
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2,webmanifest}"],
        // Stockfish is only for scanning games, which needs the network anyway.
        globIgnores: ["engine/**"],
        navigateFallback: "index.html",
        skipWaiting: true,
        clientsClaim: true,
        maximumFileSizeToCacheInBytes: 3_000_000,
      },
    }),
  ],
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
