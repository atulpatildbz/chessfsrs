import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Capacitor } from "@capacitor/core";
import { App as NativeApp } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { Logo } from "../components/Logo";
import { MiniBoard } from "../components/Board";

const NATIVE_REDIRECT = "chessfsrs://auth";
const convexUrl = import.meta.env.VITE_CONVEX_URL as string;
/** Where ConvexAuthProvider keeps the OAuth verifier (its namespace is the deployment URL). */
const VERIFIER_KEY = `__convexAuthOAuthVerifier_${convexUrl.replace(/[^a-zA-Z0-9]/g, "")}`;
const native = Capacitor.isNativePlatform();
/** Module-level so StrictMode's double effects can't spend a one-time code twice. */
const spentCodes = new Set<string>();

type Phase = "idle" | "browser" | "verifying";

function describe(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("not-allowed")) return "That Google account isn't on the access list.";
  return "Sign-in didn't finish. Try again.";
}

export function SignIn() {
  const { signIn } = useAuthActions();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const finish = useCallback(
    async (code: string) => {
      if (spentCodes.has(code)) return;
      spentCodes.add(code);
      setPhase("verifying");
      setError(null);
      try {
        await signIn(undefined as unknown as string, { code });
      } catch (err) {
        setError(describe(err));
        setPhase("idle");
      }
    },
    [signIn],
  );

  // Web: Google sends us back to SITE_URL?code=…
  useEffect(() => {
    if (native) return;
    const url = new URL(window.location.href);
    const code = url.searchParams.get("code");
    if (!code) return;
    url.searchParams.delete("code");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    void finish(code);
  }, [finish]);

  // Android: the browser tab ends on chessfsrs://auth?code=…, which reopens the app.
  useEffect(() => {
    if (!native) return;
    const onUrl = (raw: string) => {
      if (!raw.startsWith(NATIVE_REDIRECT)) return;
      void Browser.close().catch(() => undefined);
      const code = new URL(raw).searchParams.get("code");
      if (code) void finish(code);
      else {
        setError(describe("no code"));
        setPhase("idle");
      }
    };
    const subs = [
      NativeApp.addListener("appUrlOpen", (e) => onUrl(e.url)),
      Browser.addListener("browserFinished", () => setPhase((p) => (p === "browser" ? "idle" : p))),
    ];
    // Cold start: Android killed the app while the browser tab was open.
    void NativeApp.getLaunchUrl().then((r) => r?.url && onUrl(r.url));
    return () => subs.forEach((s) => void s.then((h) => h.remove()));
  }, [finish]);

  async function google() {
    setError(null);
    setPhase("browser");
    try {
      if (!native) {
        await signIn("google"); // navigates away
        return;
      }
      // Google refuses sign-in inside a WebView, so open the system browser instead.
      const res = await new ConvexHttpClient(convexUrl).action(api.auth.signIn, { provider: "google", params: { redirectTo: NATIVE_REDIRECT } });
      if (!res.redirect || !res.verifier) throw new Error("Unexpected sign-in response");
      localStorage.setItem(VERIFIER_KEY, res.verifier);
      await Browser.open({ url: res.redirect });
    } catch (err) {
      setError(describe(err));
      setPhase("idle");
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center px-5 py-10">
      <div className="grid w-full max-w-4xl items-center gap-10 md:grid-cols-[1.1fr_1fr]">
        <div className="hidden md:block">
          <MiniBoard fen="r2q1r2/ppp2pk1/3pnn2/2bNp3/4P2B/3P4/PPP2PPP/R2Q1RK1 b - - 2 2" orientation="white" lastMove={["c3", "d5"]} />
        </div>
        <div>
          <div className="mb-8 flex items-center gap-3">
            <Logo className="h-9 w-9 text-ink" />
            <h1 className="font-serif text-[2.1rem] leading-tight">chessfsrs</h1>
          </div>
          <p className="mb-8 max-w-sm text-dim">Puzzles from your own games, brought back just before you'd forget them.</p>
          <div className="flex max-w-sm flex-col gap-3">
            <button className="btn btn-primary" onClick={() => void google()} disabled={phase !== "idle"}>
              <GoogleMark />
              {phase === "verifying" ? "Signing you in…" : "Continue with Google"}
            </button>
            {error && <p className="text-sm text-blunder" role="alert">{error}</p>}
            {(import.meta.env.DEV || import.meta.env.VITE_TEST_LOGIN === "1") && <DevPasswordForm onError={setError} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Dev server only: the browser tests sign in with a test account (see convex/auth.ts). */
function DevPasswordForm({ onError }: { onError: (e: string | null) => void }) {
  const { signIn } = useAuthActions();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    onError(null);
    try {
      await signIn("password", { email: String(form.get("email")), password: String(form.get("password")), flow: "signIn" });
    } catch {
      onError("Password sign-in failed (dev deployment with ENABLE_PASSWORD_LOGIN and a test account only).");
    }
  }
  return (
    <form onSubmit={submit} className="mt-6 flex flex-col gap-2 border-t border-line pt-4">
      <p className="text-xs text-dim">Dev test account</p>
      <input name="email" type="email" placeholder="test@chessfsrs.local" required className="field" />
      <input name="password" type="password" placeholder="Password" required className="field" />
      <button className="btn btn-ghost">Sign in with password</button>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.8c4.3-4 6.9-9.9 6.9-17.2z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.8c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
