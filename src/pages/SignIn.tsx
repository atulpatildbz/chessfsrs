import { useState, type FormEvent } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Logo } from "../components/Logo";
import { MiniBoard } from "../components/Board";

export function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await signIn("password", { email: String(form.get("email")), password: String(form.get("password")), flow });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not-allowed")) setError("This email isn't on the access list.");
      else if (msg.includes("InvalidSecret") || msg.includes("InvalidAccountId")) setError(flow === "signIn" ? "Wrong email or password. New here? Create an account first." : "Couldn't create the account.");
      else if (msg.includes("already exists")) setError("That account already exists. Sign in instead.");
      else if (msg.includes("8 characters")) setError("Use a password of at least 8 characters.");
      else setError(flow === "signIn" ? "Couldn't sign in. Check the email and password." : "Couldn't create the account. Is this email on the access list?");
    } finally {
      setBusy(false);
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
            <Logo className="h-9 w-9 text-brass" />
            <h1 className="font-serif text-3xl">chessfsrs</h1>
          </div>
          <p className="mb-8 max-w-sm text-sage">Puzzles from your own games, brought back just before you'd forget them.</p>
          <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
            <label className="text-sm text-sage" htmlFor="email">Email</label>
            <input id="email" name="email" type="email" autoComplete="email" required className="field" />
            <label className="mt-1 text-sm text-sage" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete={flow === "signIn" ? "current-password" : "new-password"} minLength={8} required className="field" />
            {error && <p className="text-sm text-claret" role="alert">{error}</p>}
            <button className="btn btn-primary mt-3" disabled={busy}>{flow === "signIn" ? "Sign in" : "Create account"}</button>
            <button type="button" className="text-left text-sm text-sage underline-offset-4 hover:underline" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(null); }}>
              {flow === "signIn" ? "First time here? Create an account" : "Already have an account? Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
