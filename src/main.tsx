import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import "./styles.css";
import { App } from "./App";

const url = import.meta.env.VITE_CONVEX_URL as string | undefined;
const root = createRoot(document.getElementById("root")!);

if (!url) {
  root.render(<p style={{ padding: 24 }}>Missing VITE_CONVEX_URL. Run <code>npx convex dev</code> first.</p>);
} else {
  const convex = new ConvexReactClient(url);
  root.render(
    <StrictMode>
      {/* SignIn handles ?code= itself so it can show "not on the access list". */}
      <ConvexAuthProvider client={convex} shouldHandleCode={false}>
        <App />
      </ConvexAuthProvider>
    </StrictMode>,
  );
}
