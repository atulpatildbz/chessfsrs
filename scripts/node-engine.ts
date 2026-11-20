// Stockfish 19 lite (the same WASM build the app uses) in Node, behind the UCI client.
import { createRequire } from "node:module";
import { UciEngine } from "../lib/uci";

export function nodeEngine() {
  const require = createRequire(import.meta.url);
  const listeners: ((l: string) => void)[] = [];
  // The stockfish package replaces global fetch while loading; keep ours.
  const realFetch = globalThis.fetch;
  const sf = require("stockfish")("lite-single", (line: string) => listeners.forEach((f) => f(line)));
  globalThis.fetch = realFetch;
  return new UciEngine({ send: (c) => sf.processCommand(c), onLine: (cb) => listeners.push(cb), close: () => sf.terminate?.() });
}
