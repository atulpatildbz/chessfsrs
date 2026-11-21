// How fast the app feels: launch and tap-to-response times, with budgets that fail the run.
// Runs on a production build (the service worker and minified code are what people get):
//   VITE_TEST_LOGIN=1 npx vite build --outDir dist-test && npx vite preview --outDir dist-test --port 4173 &
//   TEST_PASSWORD=… node tests/e2e/perf.mjs [desktop|phone|iphone|all]
// "phone" is a Pixel 7 with the CPU slowed 4x, roughly a mid-range Android phone.
// Each interaction is timed from the pointer going down until the frame showing the result has been
// painted. On Chromium the browser's own Event Timing (what INP is built on) is taken as well, and
// the larger of the two has to fit the budget.
import { chromium, webkit, devices } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4173/";
export const PASSWORD = process.env.TEST_PASSWORD;
if (!PASSWORD) throw new Error("Set TEST_PASSWORD for the dev test account");
const which = process.argv[2] ?? "all";

// Budgets in ms. A tap should answer within ~100 ms to feel instant; launches within a second.
const BUDGET = {
  desktop: { launch: 600, tap: 50 },
  phone: { launch: 1200, tap: 100 },
  iphone: { launch: 800, tap: 60 },
};
const PROFILES = {
  desktop: { browser: chromium, device: devices["Desktop Chrome"], cpu: 1 },
  phone: { browser: chromium, device: devices["Pixel 7"], cpu: 4 },
  iphone: { browser: webkit, device: devices["iPhone 13"], cpu: 1 },
};

let failed = false;

/** Timing helpers that work on any page, including an Android WebView. */
export function tools(page) {
  /**
   * Time from the next pointer/key press until the frame in which `cond` (a function source run in
   * the page) first holds has been painted. The check runs in the page's own frame callbacks, before
   * that frame's paint; a message posted from there is handled after the paint.
   */
  async function tap(act, cond, arg, timeout = 15000) {
    await page.evaluate(([c, a]) => {
      cancelAnimationFrame(window.__raf);
      window.__t0 = 0;
      window.__ev = 0;
      window.__painted = 0;
      const mark = () => { window.__t0 ||= performance.now(); };
      addEventListener("pointerdown", mark, { capture: true, once: true });
      addEventListener("keydown", mark, { capture: true, once: true });
      if (!window.__obs && typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("event")) {
        window.__obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__ev = Math.max(window.__ev, e.duration); });
        window.__obs.observe({ type: "event", durationThreshold: 16, buffered: false });
      }
      const check = (0, eval)(c);
      const frame = () => {
        if (window.__t0 && check(a)) {
          const ch = new MessageChannel();
          ch.port1.onmessage = () => { window.__painted = performance.now(); };
          ch.port2.postMessage(0);
          return;
        }
        window.__raf = requestAnimationFrame(frame);
      };
      window.__raf = requestAnimationFrame(frame);
    }, [cond.toString(), arg]);
    await act();
    const h = await page.waitForFunction(() => window.__painted && window.__painted - window.__t0, null, { timeout }).catch((e) => {
      void page.evaluate(() => cancelAnimationFrame(window.__raf)).catch(() => {});
      throw e;
    });
    const ms = await h.jsonValue();
    await page.waitForTimeout(150); // let Event Timing entries arrive
    const ev = await page.evaluate(() => window.__ev);
    return { ms: Math.round(ms), ev: Math.round(ev) || null };
  }
  /** Milliseconds since navigation started until `cond` holds (start-up: a frame callback, ~1 frame before paint). */
  async function since(cond, arg) {
    const h = await page.waitForFunction(([c, a]) => (0, eval)(c)(a) && performance.now(), [cond.toString(), arg], { polling: "raf", timeout: 30000 });
    return Math.round(await h.jsonValue());
  }
  return { tap, since };
}

// Page conditions (run in the browser). chessground hides squares it no longer needs (display:
// none) and reuses them, so square checks must skip hidden ones.
const C = {
  fontsReady: () => document.fonts.status === "loaded" && document.fonts.check('16px "Newsreader Variable"') && document.fonts.check('16px "Schibsted Grotesk Variable"'),
  homeReady: () => /position|caught up/.test(document.querySelector("main h1")?.textContent ?? ""),
  boardReady: () => document.querySelectorAll("main cg-board piece").length > 1,
  canMove: () => { const b = [...document.querySelectorAll("main button")].find((x) => /Hint/.test(x.textContent)); return b && !b.disabled; },
  patternsReady: () => /^Patterns/.test(document.querySelector("main h1")?.textContent ?? "") && !!document.querySelector("main h2"),
  heading: (re) => new RegExp(re).test(document.querySelector("main h1")?.textContent ?? ""),
  grades: () => [...document.querySelectorAll("main button")].some((x) => /^Again/.test(x.textContent)),
  newPuzzle: () => { const b = document.querySelector("main cg-board"); return !!b && b !== window.__oldBoard && b.querySelectorAll("piece").length > 1; },
  hintShown: () => !!document.querySelector('main cg-board square.hint-sq:not([style*="display: none"])'),
  moveFeedback: () => !!document.querySelector('main cg-board square.wrong-sq:not([style*="display: none"]), main cg-board square.right-sq:not([style*="display: none"])'),
  selected: () => !!document.querySelector('main cg-board square.move-dest:not([style*="display: none"])'),
};

/** Centre of a board square element, in page coordinates. */
async function centreOf(page, selector, i = 0) {
  return page.evaluate(([s, i]) => {
    const el = document.querySelectorAll(s)[i];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, [selector, i]);
}

/** Pick up one of the solver's pieces (not a pawn, which might open the promotion picker) and play a legal move. */
async function playSomeMove(page, t, press) {
  const color = await page.evaluate(() => (document.querySelector("main .cg-wrap")?.classList.contains("orientation-black") ? "black" : "white"));
  const sel = `main cg-board piece.${color}:not(.pawn)`;
  const n = await page.evaluate((s) => document.querySelectorAll(s).length, sel);
  for (let i = 0; i < n; i++) {
    const at = await centreOf(page, sel, i);
    if (!at) continue;
    const select = await t.tap(() => press(at.x, at.y), C.selected, undefined, 1500).catch(() => null);
    if (!select) { await press(at.x, at.y); continue; } // put it back down
    const dest = await centreOf(page, 'main cg-board square.move-dest:not([style*="display: none"])');
    const move = await t.tap(() => press(dest.x, dest.y), C.moveFeedback);
    return { select, move };
  }
  return null;
}

async function signIn(page) {
  await page.goto(BASE);
  await page.fill("input[name=email]", process.env.TEST_EMAIL ?? "test@chessfsrs.local");
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector("main", { timeout: 20000 });
  for (let i = 0; !(await page.evaluate(async () => (await navigator.serviceWorker?.getRegistration())?.active?.state === "activated")); i++) {
    if (i > 40) throw new Error("service worker never activated");
    await page.waitForTimeout(500);
  }
  await page.goto(BASE + "#/library");
  await page.waitForFunction(() => /Library \d+/.test(document.querySelector("h1")?.textContent ?? "") && !/Library 0/.test(document.querySelector("h1").textContent), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await waitForPatternsCopy(page);
}

/**
 * The app fetches the Patterns numbers once per device, two seconds after start-up, and opens the
 * page from that copy from then on. Wait for it, so the run measures a device that's been used.
 */
export async function waitForPatternsCopy(page) {
  const has = () => page.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("chessfsrs");
    req.onerror = () => resolve(false);
    req.onsuccess = () => {
      const get = req.result.transaction("kv").objectStore("kv").get("q:patterns");
      get.onsuccess = () => { req.result.close(); resolve(!!get.result); };
    };
  }));
  for (let i = 0; !(await has()); i++) {
    if (i > 40) throw new Error("the Patterns copy never arrived");
    await page.waitForTimeout(500);
  }
}

/** The measured session, shared by every medium. */
export async function measure(page, { reload, offline, touch, press: pressWith }) {
  const t = tools(page);
  const press = pressWith ?? ((x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y)));
  const r = {};

  // Launch: a fresh start of the installed app (median of three), straight to Home, then to Practice.
  const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const launches = async (hash, conds) => {
    const runs = conds.map(() => []);
    for (let i = 0; i < 3; i++) {
      await reload(hash);
      for (const [j, c] of conds.entries()) runs[j].push(await t.since(c));
    }
    return runs.map(median);
  };
  [r["launch: home shows the queue"], r["launch: text in its final fonts"]] = await launches("#/", [C.homeReady, C.fontsReady]);
  [r["launch: practice board drawn"], r["ready: first puzzle takes a move"]] = await launches("#/practice", [C.boardReady, C.canMove]);
  if (offline) {
    await offline(true);
    [r["launch offline: practice board drawn"]] = await launches("#/practice", [C.boardReady]);
    await offline(false);
    await reload("#/practice");
  }

  // Taps on the practice screen.
  await page.waitForFunction(C.canMove, null, { timeout: 15000 });
  const tapOn = async (re) => {
    const b = page.locator("main button").filter({ hasText: re }).first();
    const box = await b.boundingBox();
    return () => press(box.x + box.width / 2, box.y + box.height / 2);
  };
  const moves = await playSomeMove(page, t, press);
  r["tap: pick up a piece"] = moves?.select ?? NaN; // NaN fails the report: nothing was measured
  r["tap: play a move"] = moves?.move ?? NaN;
  // A wrong move hands the turn back after a moment; a right one may have solved the puzzle.
  await page.waitForFunction(() => { return [...document.querySelectorAll("main button")].some((x) => (/Hint/.test(x.textContent) && !x.disabled) || /^Again/.test(x.textContent)); }, null, { timeout: 15000 });
  if (!(await page.evaluate(C.grades))) {
    r["tap: hint"] = await t.tap(await tapOn(/Hint/), C.hintShown);
    r["tap: solution"] = await t.tap(await tapOn(/Solution/), C.grades);
  }
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => { window.__oldBoard = document.querySelector("main cg-board"); });
    r[`tap: grade, next puzzle drawn #${i}`] = await t.tap(await tapOn(/^Good/), C.newPuzzle);
    await page.waitForFunction(C.canMove, null, { timeout: 15000 });
    if (i < 3) await t.tap(await tapOn(/Solution/), C.grades);
  }

  // Moving around the app.
  const nav = async (label, re) => {
    const a = page.locator(`nav a:visible`).filter({ hasText: label }).first();
    const box = await a.boundingBox();
    return t.tap(() => press(box.x + box.width / 2, box.y + box.height / 2), ...(typeof re === "function" ? [re] : [C.heading, re]));
  };
  r["tab: home"] = await nav("Home", "position|caught up");
  r["tab: library"] = await nav("Library", () => /^Library/.test(document.querySelector("main h1")?.textContent ?? "") && document.querySelectorAll("main cg-board piece").length > 20);
  r["tab: patterns (with its numbers)"] = await nav("Patterns", C.patternsReady);
  r["tab: practice"] = await nav("Practice", C.boardReady);
  await page.evaluate(() => { location.hash = "#/library"; });
  await page.waitForTimeout(800);
  r["tap: open a puzzle from the library"] = await t.tap(async () => { const b = await page.locator("main a[href^='#/puzzle/']").first().boundingBox(); await press(b.x + b.width / 2, b.y + b.height / 2); }, () => location.hash.startsWith("#/puzzle/") && document.querySelectorAll("main cg-board piece").length > 1);
  return r;
}

export const isFailed = () => failed;
export function report(name, r, budget) {
  console.log(`\n${name}`);
  for (const [k, v] of Object.entries(r)) {
    const ms = typeof v === "number" ? v : Math.max(v.ms, v.ev ?? 0);
    // A new puzzle pauses on purpose (400 ms) so you see the position before the move you answer.
    const limit = k.startsWith("launch") || k.startsWith("first") ? budget.launch * (k.startsWith("first") ? 3 : 1) : k.startsWith("ready") ? budget.launch + 400 : budget.tap;
    const over = !(ms <= limit); // NaN (nothing measured) counts as over
    if (over) failed = true;
    const ev = typeof v === "object" && v.ev ? `  (to paint ${v.ms} ms, browser Event Timing ${v.ev} ms)` : "";
    console.log(`  ${over ? "SLOW" : "ok  "} ${String(ms).padStart(5)} ms  ${k}${ev}`);
  }
}

/** A first visit to the website, nothing cached, over a 4G-like connection (Chromium only). */
async function firstVisit(browser, p) {
  const ctx = await browser.newContext({ ...p.device });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 100, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (2 * 1024 * 1024) / 8 });
  if (p.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  await page.goto(BASE, { waitUntil: "commit" });
  const ms = await tools(page).since(() => !!document.querySelector("input[name=email], button"));
  await ctx.close();
  return ms;
}

async function runProfile(name) {
  const p = PROFILES[name];
  const browser = await p.browser.launch();
  const first = p.browser === chromium ? await firstVisit(browser, p) : null;
  const ctx = await browser.newContext({ ...p.device });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => /Failed to fetch|Load failed|NetworkError/.test(String(e)) || console.error("page error:", String(e)));
  await signIn(page);
  let cdp;
  if (p.cpu > 1) {
    cdp = await ctx.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu });
  }
  const reload = async (hash) => {
    await page.goto("about:blank");
    await page.goto(BASE + hash);
    if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: p.cpu }); // survives navigation, but be sure
  };
  const r = await measure(page, { reload, offline: (on) => ctx.setOffline(on), touch: !!p.device.hasTouch });
  if (first !== null) r["first visit: sign-in page on 4G"] = first;
  report(`${name} (${p.device.userAgent.includes("iPhone") ? "WebKit, iPhone 13" : p.cpu > 1 ? `Chromium, Pixel 7, CPU ${p.cpu}x slower` : "Chromium, desktop"})`, r, BUDGET[name]);
  await browser.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const name of which === "all" ? Object.keys(PROFILES) : [which]) await runProfile(name);
  if (failed) { console.log("\nSome timings are over budget."); process.exitCode = 1; }
}
