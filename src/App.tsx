import { useEffect, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions, useAuthToken } from "@convex-dev/auth/react";
import { BookOpen, ChartNoAxesColumn, Download, Home as HomeIcon, Plus, Settings as SettingsIcon, Swords } from "lucide-react";
import { api } from "../convex/_generated/api";
import { navigate, useRoute } from "./lib/router";
import { setSoundEnabled } from "./lib/sound";
import { SignIn } from "./pages/SignIn";
import { Home } from "./pages/Home";
import { Practice } from "./pages/Practice";
import { Library } from "./pages/Library";
import { PuzzleDetail } from "./pages/PuzzleDetail";
import { AddPuzzles } from "./pages/AddPuzzles";
import { ImportGames } from "./pages/ImportGames";
import { Settings } from "./pages/Settings";
import { Patterns } from "./pages/Patterns";
import { Logo } from "./components/Logo";
import { forgetLocal, resetFor, useLocal } from "./lib/local/store";
import { SyncEngine } from "./lib/local/sync";

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const token = useAuthToken();
  const local = useLocal();
  if (!local.loaded) return <Splash />;
  // Signed in on this device before: open straight from the local copy, online or not. The server
  // catches up in the background.
  // The stored copy must belong to whoever the stored token is for (another account may have signed
  // in since); otherwise wait for the server.
  if (isAuthenticated || (token !== null && local.me !== null && tokenUser(token) === local.me.id)) return <SignedIn />;
  if (isLoading) return <Splash />;
  return <SignIn />;
}

/** User id in a Convex Auth JWT: its `sub` is "<userId>|<sessionId>". */
function tokenUser(token: string | null): string | null {
  try {
    const part = token?.split(".")[1];
    if (!part) return null;
    const sub = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
    return sub.split("|")[0];
  } catch {
    return null;
  }
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <Logo className="h-10 w-10 animate-pulse text-boxwood" />
    </div>
  );
}

function SignedIn() {
  const { isAuthenticated } = useConvexAuth();
  const token = useAuthToken();
  const live = useQuery(api.users.me, isAuthenticated ? {} : "skip");
  const local = useLocal();
  const { signOut } = useAuthActions();
  const route = useRoute();

  useEffect(() => { if (live?.allowed) resetFor({ id: live.id, email: live.email }); }, [live]);
  useEffect(() => {
    if (!local.settings) return;
    document.documentElement.dataset.board = local.settings.boardTheme;
    setSoundEnabled(local.settings.sound);
  }, [local.settings]);

  if (live !== undefined && (live === null || !live.allowed))
    return (
      <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo className="h-10 w-10 text-boxwood" />
        <p>This account isn't on the access list for this app.</p>
        <button className="btn btn-ghost" onClick={() => { forgetLocal(); void signOut(); }}>Sign out</button>
      </div>
    );
  // First sign-in on this device: wait for the server to say who this is.
  const me = live?.allowed ? live : local.me;
  if (!me || local.me?.id !== (live?.allowed ? live.id : tokenUser(token))) return <Splash />;

  const p = route.path;
  let page: ReactNode;
  if (p === "/practice") page = <Practice puzzleId={route.params.get("id")} />;
  else if (p === "/library") page = <Library key={route.params.get("q") ?? ""} initialSearch={route.params.get("q") ?? ""} />;
  else if (p === "/patterns") page = <Patterns />;
  else if (p.startsWith("/puzzle/")) page = <PuzzleDetail id={p.slice("/puzzle/".length)} />;
  else if (p === "/add") page = <AddPuzzles />;
  else if (p === "/import") page = <ImportGames />;
  else if (p === "/settings") page = <Settings email={me.email} />;
  else page = <Home />;

  return (
    <div className="flex h-full flex-col md:flex-row">
      <SyncEngine />
      <Nav path={p} />
      <main className={`min-h-0 flex-1 overflow-y-auto scroll-thin md:pb-0 ${p.startsWith("/practice") ? "pb-[calc(3.5rem+env(safe-area-inset-bottom))]" : "pb-24"}`}>{page}</main>
    </div>
  );
}

const NAV = [
  { to: "/", label: "Home", icon: HomeIcon },
  { to: "/practice", label: "Practice", icon: Swords },
  { to: "/library", label: "Library", icon: BookOpen },
  { to: "/patterns", label: "Patterns", icon: ChartNoAxesColumn },
  { to: "/add", label: "Add", icon: Plus },
  { to: "/import", label: "From games", icon: Download },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

function Nav({ path }: { path: string }) {
  const active = (to: string) => (to === "/" ? path === "/" : path === to || (to === "/library" && path.startsWith("/puzzle/")));
  return (
    <>
      {/* Desktop rail */}
      <nav className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-line px-3 py-6 md:flex">
        <button onClick={() => navigate("/")} className="mb-7 flex items-center gap-2.5 px-3 text-left">
          <Logo className="h-6 w-6 text-boxwood" />
          <span className="text-[1.05rem] font-semibold tracking-tight">chessfsrs</span>
        </button>
        {NAV.map(({ to, label, icon: Icon }) => (
          <a key={to} href={`#${to}`} aria-current={active(to) ? "page" : undefined} className={`relative flex items-center gap-3 rounded-md px-3 py-2 text-[0.95rem] ${active(to) ? "bg-ebony-2 text-boxwood before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-boxwood" : "text-dim hover:text-boxwood"}`}>
            <Icon size={18} strokeWidth={active(to) ? 2.4 : 1.8} />
            {label}
          </a>
        ))}
      </nav>
      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line bg-ebony pb-[env(safe-area-inset-bottom)] md:hidden">
        {/* Five tabs fit a phone: Add lives in the Library header there, Settings on Home. */}
        {NAV.filter((n) => n.to !== "/settings" && n.to !== "/add").map(({ to, label, icon: Icon }) => (
          <a key={to} href={`#${to}`} aria-current={active(to) ? "page" : undefined} className={`relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.7rem] ${active(to) ? "text-boxwood before:absolute before:inset-x-1/4 before:-top-px before:h-0.5 before:rounded-full before:bg-boxwood" : "text-dim"}`}>
            <Icon size={20} strokeWidth={active(to) ? 2.4 : 1.8} />
            {label}
          </a>
        ))}
      </nav>
    </>
  );
}
