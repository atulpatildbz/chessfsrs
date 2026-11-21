// A new version reaches pages that stay open (phones rarely close tabs or installed apps), without
// ever reloading under you:
//   VITE_TEST_LOGIN=1 npx vite build --outDir dist-test && [TEST_PASSWORD=…] node tests/e2e/pwa-update.mjs
// Serves a copy of the build and "deploys" new versions by changing sw.js. With TEST_PASSWORD it also
// checks a solved-but-ungraded practice puzzle holds the update (that part grades one puzzle on the
// dev deployment).
import { cpSync, appendFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chromium } from "playwright";

const SRC = process.argv[2] ?? "dist-test";
const DIR = "dist-pwa-update";
const PORT = 4179;
const BASE = `http://localhost:${PORT}/`;
const PASSWORD = process.env.TEST_PASSWORD;
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const check = (ok, msg) => (ok ? console.log("ok:", msg) : fail(msg));

let server;
async function serve() {
  if (server && server.exitCode === null) { server.kill(); await once(server, "exit"); }
  server = spawn("node_modules/.bin/vite", ["preview", "--outDir", DIR, "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("preview server didn't start");
}
let version = 0;
async function deploy() {
  appendFileSync(`${DIR}/sw.js`, `\n// v${++version}\n`);
  await serve();
}

// Each load gets a mark; a reload wipes it. Counting controller changes shows a new version took over.
const mark = (page) => page.evaluate(() => {
  window.__mark = true;
  window.__takeovers = 0;
  if (!window.__counting) navigator.serviceWorker.addEventListener("controllerchange", () => window.__takeovers++);
  window.__counting = true;
});
const reloaded = (page) => page.evaluate(() => window.__mark !== true);
const takenOver = (page) => page.waitForFunction(() => window.__takeovers > 0, null, { timeout: 10000 }).then(() => true, () => false);
const loadEvent = (page, timeout = 10000) => page.waitForEvent("load", { timeout }).then(() => true, () => false);

// Playwright can't background a tab; tell the page it was hidden or shown. `away` moves the clock on
// for the moment of coming back (and puts it back, so nothing later sees the shifted time).
const leave = (page) => page.evaluate(() => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
  document.dispatchEvent(new Event("visibilitychange"));
});
const comeBack = (page, { away = 0, tap = false } = {}) => page.evaluate(({ away, tap }) => {
  const now = Date.now;
  if (away) Date.now = () => now() + away;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  Date.now = now;
  if (tap) document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
}, { away, tap });
const LONG = 31 * 60_000;

rmSync(DIR, { recursive: true, force: true });
cpSync(SRC, DIR, { recursive: true });
await serve();
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  await a.goto(BASE);
  await mark(a);
  await a.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await a.waitForTimeout(1000);
  check(await a.evaluate(() => !!navigator.serviceWorker.controller) && !(await reloaded(a)), "a first visit runs from the service worker without a reload");

  // Two tabs open; a version comes out.
  const b = await ctx.newPage();
  await b.goto(BASE + "#/library");
  await mark(b);
  await mark(a);
  await deploy();
  await leave(a);
  await comeBack(a);
  check(await takenOver(a), "coming back to the tab picks up the new version");
  await a.waitForTimeout(1000);
  check(!(await reloaded(a)) && !(await reloaded(b)), "and neither open tab reloads by itself");

  let load = loadEvent(b);
  await b.evaluate(() => { location.hash = "/"; });
  check(await load, "changing screens in one tab loads the new version there");
  check(!(await reloaded(a)), "without reloading the other tab");
  load = loadEvent(a);
  await a.evaluate(() => { location.hash = "/library"; });
  check(await load && (await a.evaluate(() => location.hash)) === "#/library", "the other tab loads it on its own next change of screen, on that screen");
  await b.close();

  // Away a long time while a version comes out.
  await mark(a);
  await leave(a);
  await deploy();
  load = loadEvent(a);
  await comeBack(a, { away: LONG });
  check(await load, "back after a long time away: the version that came out loads straight away");

  await mark(a);
  await leave(a);
  await deploy();
  await comeBack(a, { away: LONG, tap: true });
  check(await takenOver(a), "(the next version is picked up)");
  await a.waitForTimeout(1000);
  check(!(await reloaded(a)), "but not once you've tapped the page");

  await mark(a);
  await a.evaluate(() => { const t = document.createElement("textarea"); t.value = "1. e4 e5"; document.body.append(t); });
  await leave(a);
  await deploy();
  await comeBack(a, { away: LONG });
  check(await takenOver(a), "(the next version is picked up)");
  await a.waitForTimeout(1000);
  check(!(await reloaded(a)), "and not with text typed");
  await a.evaluate(() => document.querySelector("body > textarea").remove());
  load = loadEvent(a);
  await a.evaluate(() => { location.hash = "/"; });
  check(await load, "a held-back version loads on the next change of screen");

  if (!PASSWORD) console.log("skip: practice hold (set TEST_PASSWORD)");
  else {
    await a.fill("input[name=email]", process.env.TEST_EMAIL ?? "test@chessfsrs.local");
    await a.fill("input[name=password]", PASSWORD);
    await a.click("button:has-text('Sign in')");
    await a.waitForSelector("main", { timeout: 20000 });
    await a.evaluate(() => { location.hash = "/practice"; });
    const solution = a.getByRole("button", { name: /Solution/ });
    await solution.waitFor({ timeout: 15000 });
    await a.waitForFunction(() => !document.querySelector("button:has(svg.lucide-eye)")?.disabled, null, { timeout: 10000 });
    await solution.click();
    await a.getByRole("button", { name: /^Good/ }).waitFor({ timeout: 15000 });
    await mark(a);
    await leave(a);
    await deploy();
    await comeBack(a, { away: LONG });
    check(await takenOver(a), "(the next version is picked up)");
    await a.waitForTimeout(1000);
    check(!(await reloaded(a)) && (await a.getByRole("button", { name: /^Good/ }).isVisible()), "back after a long time to a puzzle waiting for a grade: it's still there");
    await a.getByRole("button", { name: /^Good/ }).click();

    // The next puzzle: a hint before your first move is enough to hold it.
    const hint = a.getByRole("button", { name: /Hint/ });
    await a.waitForFunction(() => ![...document.querySelectorAll("button")].find((b) => /Hint/.test(b.textContent))?.disabled, null, { timeout: 10000 });
    await hint.click();
    await mark(a);
    await leave(a);
    await deploy();
    await comeBack(a, { away: LONG });
    await takenOver(a);
    await a.waitForTimeout(1000);
    check(!(await reloaded(a)), "back after a long time to a puzzle you took a hint on: it's still there");
    await solution.click();
    await a.getByRole("button", { name: /^Good/ }).click();
    await a.waitForTimeout(1500); // the next puzzle, untouched; the version from before is still waiting
    await mark(a);
    await leave(a);
    load = loadEvent(a);
    await comeBack(a, { away: LONG });
    check(await load, "once graded, with the next puzzle untouched, the version loads");

    // A username edited and left by tapping another screen is saved before the new version loads.
    // (Locally the save goes out before the reload either way; this guards the flow, while the wait
    // for in-flight saves in main.tsx covers slow or reconnecting connections.)
    await a.evaluate(() => { location.hash = "/settings"; });
    const field = a.getByLabel("lichess username");
    await field.waitFor({ timeout: 10000 });
    const original = await field.inputValue();
    await mark(a);
    await deploy();
    await leave(a);
    await comeBack(a);
    await takenOver(a);
    const edited = `pwa-check-${version}`;
    await field.fill(edited);
    load = loadEvent(a);
    await a.locator('a[href="#/library"]:visible').first().click();
    check(await load, "(leaving settings loads the new version)");
    await a.evaluate(() => { location.hash = "/settings"; });
    await field.waitFor({ timeout: 10000 });
    await a.waitForTimeout(1500);
    check((await field.inputValue()) === edited, `the username typed just before is saved ("${await field.inputValue()}")`);
    await field.fill(original);
    await field.blur();
    await a.waitForTimeout(1500);
  }
} finally {
  await browser.close();
  if (server?.exitCode === null) { server.kill(); await once(server, "exit"); }
  rmSync(DIR, { recursive: true, force: true });
}
