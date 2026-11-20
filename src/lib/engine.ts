// Stockfish (lite, single-threaded WASM) in a Web Worker. Needs no cross-origin isolation,
// so it runs on GitHub Pages and in the Android WebView.
import { UciEngine } from "../../lib/uci";

export function createEngine() {
  const worker = new Worker(`${import.meta.env.BASE_URL}engine/stockfish-19-lite-single.js`);
  return new UciEngine({
    send: (cmd) => worker.postMessage(cmd),
    onLine: (cb) => worker.addEventListener("message", (e) => cb(String(e.data))),
    close: () => worker.terminate(),
  });
}
