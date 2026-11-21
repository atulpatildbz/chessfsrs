import { useEffect, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
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

export function App() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <Splash />;
  if (!isAuthenticated) return <SignIn />;
  return <SignedIn />;
}

function Splash() {
  return (
    <div className="flex h-full items-center justify-center">
      <Logo className="h-10 w-10 animate-pulse text-brass" />
    </div>
  );
}

function SignedIn() {
  const me = useQuery(api.users.me);
  const settings = useQuery(api.settings.get);
  const { signOut } = useAuthActions();
  const route = useRoute();

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.board = settings.boardTheme;
    setSoundEnabled(settings.sound);
  }, [settings]);

  if (me === undefined) return <Splash />;
  if (me === null || !me.allowed)
    return (
      <div className="mx-auto flex h-full max-w-sm flex-col items-center justify-center gap-4 px-6 text-center">
        <Logo className="h-10 w-10 text-brass" />
        <p>This account isn't on the access list for this app.</p>
        <button className="btn btn-ghost" onClick={() => void signOut()}>Sign out</button>
      </div>
    );

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
      <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-line/60 px-3 py-5 md:flex">
        <button onClick={() => navigate("/")} className="mb-6 flex items-center gap-2.5 px-3 text-left">
          <Logo className="h-7 w-7 text-brass" />
          <span className="font-serif text-xl">chessfsrs</span>
        </button>
        {NAV.map(({ to, label, icon: Icon }) => (
          <a key={to} href={`#${to}`} className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[0.95rem] ${active(to) ? "bg-felt-2 text-bone" : "text-sage hover:text-bone"}`}>
            <Icon size={18} strokeWidth={active(to) ? 2.4 : 1.8} />
            {label}
          </a>
        ))}
      </nav>
      {/* Mobile tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-line/60 bg-felt pb-[env(safe-area-inset-bottom)] md:hidden">
        {/* Five tabs fit a phone: Add lives in the Library header there, Settings on Home. */}
        {NAV.filter((n) => n.to !== "/settings" && n.to !== "/add").map(({ to, label, icon: Icon }) => (
          <a key={to} href={`#${to}`} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.68rem] ${active(to) ? "text-brass" : "text-sage"}`}>
            <Icon size={20} strokeWidth={active(to) ? 2.4 : 1.8} />
            {label}
          </a>
        ))}
      </nav>
    </>
  );
}
