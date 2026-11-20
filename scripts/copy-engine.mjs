// Copy the Stockfish WASM build into public/engine so it is served (and bundled into the APK) as-is.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const bin = join(dirname(require.resolve("stockfish/package.json")), "bin");
const out = join(import.meta.dirname, "..", "public", "engine");
mkdirSync(out, { recursive: true });
for (const f of ["stockfish-19-lite-single.js", "stockfish-19-lite-single.wasm"]) copyFileSync(join(bin, f), join(out, f));
console.log("engine copied to public/engine");
