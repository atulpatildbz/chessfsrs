import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import "./styles.css";
import { App } from "./App";
import { loadLocal } from "./lib/local/store";
import { registerServiceWorker } from "./lib/pwa";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;

const isNetworkError = (e: unknown) => e instanceof TypeError && /fetch|network|load failed|offline/i.test(e.message);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const whenOnline = () => (navigator.onLine ? Promise.resolve() : new Promise<void>((r) => window.addEventListener("online", () => r(), { once: true })));

/**
 * Convex refreshes the sign-in token over HTTP. If that fetch fails because the network is down (or
 * flaky while reconnecting), the client gives up on the socket until a reload, and queued grades
 * would wait for one. Instead, wait for the network and try again: the token refresh resolves late
 * rather than failing.
 */
class OfflineTolerantClient extends ConvexReactClient {
  private generation = 0;
  setAuth(...[fetchToken, ...rest]: Parameters<ConvexReactClient["setAuth"]>) {
    const gen = ++this.generation;
    super.setAuth(async (args) => {
      for (let wait = 1000; ; wait = Math.min(wait * 2, 30_000)) {
        try {
          return await fetchToken(args);
        } catch (e) {
          if (!isNetworkError(e)) throw e;
          if (gen !== this.generation) return null;
          await whenOnline();
          await sleep(wait);
          if (gen !== this.generation) return null; // signed out or re-configured meanwhile
        }
      }
    }, ...rest);
  }
  clearAuth() {
    this.generation++;
    super.clearAuth();
  }
}
const root = createRoot(document.getElementById("root")!);

if (!url) {
  root.render(<p style={{ padding: 24 }}>Missing VITE_CONVEX_URL. Run <code>npx convex dev</code> first.</p>);
} else {
  void loadLocal();
  registerServiceWorker();
  // Offline grades wait in IndexedDB, so a mutation held during a disconnect is safe: no "leave page?" prompt.
  const convex = new OfflineTolerantClient(url, { unsavedChangesWarning: false });
  root.render(
    <StrictMode>
      {/* SignIn handles ?code= itself so it can show "not on the access list". */}
      <ConvexAuthProvider client={convex} shouldHandleCode={false}>
        <App />
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
