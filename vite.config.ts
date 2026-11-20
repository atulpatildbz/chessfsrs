import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// BASE_PATH: "/chessfsrs/" for GitHub Pages, "./" for the Capacitor (Android) build, "/" in dev.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), tailwindcss()],
  server: { port: 5173, strictPort: true },
  build: { chunkSizeWarningLimit: 900 },
});
