// Phone-sized end-to-end test with real touch input (taps and a touch drag), against the dev server.
//   TEST_PASSWORD=… node tests/e2e/mobile.mjs [outDir]
// Solves the README example puzzle (added if missing), grades it, and walks every page checking
// for horizontal overflow and console errors.
import { chromium, webkit, devices } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? "test-results";
const EMAIL = process.env.TEST_EMAIL ?? "test@chessfsrs.local";
const PASSWORD = process.env.TEST_PASSWORD;
if (!PASSWORD) throw new Error("Set TEST_PASSWORD for the dev test account");

const isWebkit = process.env.BROWSER === "webkit";
const browser = await (isWebkit ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...devices[process.env.DEVICE ?? (isWebkit ? "iPhone 13" : "Pixel 7")] });
const page = await ctx.newPage();
const cdp = isWebkit ? null : await ctx.newCDPSession(page);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${OUT}/mobile-${n}.png` });
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const check = (ok, msg) => (ok ? console.log("ok:", msg) : fail(msg));

await page.goto(BASE);
await page.fill("input[name=email]", EMAIL);
await page.fill("input[name=password]", PASSWORD);
await page.click("button:has-text('Sign in')");
await page.waitForSelector("main", { timeout: 15000 });

// Every page fits the phone width.
for (const hash of ["", "#/practice", "#/library", "#/patterns", "#/add", "#/import", "#/settings"]) {
  await page.goto(BASE + hash);
  await page.waitForTimeout(1500);
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  check(sw <= cw, `no horizontal scroll on ${hash || "home"} (${sw} <= ${cw})`);
  // Content clipped off the right edge by an overflow:hidden parent doesn't show up in scrollWidth.
  const clipped = await page.evaluate(() => {
    const scrollsX = (el) => { for (let e = el.parentElement; e && e.tagName !== "MAIN"; e = e.parentElement) if (/auto|scroll/.test(getComputedStyle(e).overflowX)) return true; return false; };
    return [...document.querySelectorAll("main *")]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.right > innerWidth + 1 && !scrollsX(el); })
      .slice(0, 3).map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
  });
  check(clipped.length === 0, `nothing cut off at the right edge on ${hash || "home"}${clipped.length ? ": " + clipped.join(", ") : ""}`);
}

// The example puzzle: Black to move; 1... Kg7 is played for you, then you play Nd5, Bxf6+, Nxf6.
await page.goto(BASE + "#/add");
await page.click("text=Paste the example");
await page.click("button:has-text('Add puzzle')");
await page.waitForSelector("text=/Added \\d/");
await page.goto(BASE + "#/library");
await page.click("button:has-text('Added by hand')");
await page.fill("input[placeholder^='Search']", "chess.com");
await page.waitForTimeout(1500);
const href = await page.locator("a[href^='#/puzzle/']").first().getAttribute("href");
const id = href.split("/").pop();

const box = async () => page.locator("cg-board").first().boundingBox();
const center = async (sq) => {
  const b = await box();
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]) - 1;
  return { x: b.x + (f + 0.5) * (b.width / 8), y: b.y + (7 - r + 0.5) * (b.height / 8) };
};
const tap = async (sq) => { const c = await center(sq); await page.touchscreen.tap(c.x, c.y); await page.waitForTimeout(150); };
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y })) });
async function drag(from, to) {
  if (!cdp) return (await tap(from), await tap(to)); // WebKit: no raw touch events, tap instead
  const a = await center(from), b = await center(to);
  await touch("touchStart", [a]);
  for (let i = 1; i <= 8; i++) await touch("touchMove", [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8 }]);
  await touch("touchEnd", []);
  await page.waitForTimeout(150);
}
const pieceOn = (sq) => page.evaluate(([f, r]) => {
  const b = document.querySelector("cg-board").getBoundingClientRect();
  const size = b.width / 8;
  for (const p of document.querySelectorAll("cg-board piece")) {
    const t = p.getBoundingClientRect();
    if (Math.round((t.left - b.left) / size) === f && Math.round((t.top - b.top) / size) === 7 - r) return p.className;
  }
  return null;
}, [sq.charCodeAt(0) - 97, Number(sq[1]) - 1]);

await page.goto(BASE + `#/practice?id=${id}`);
await page.waitForSelector("cg-board");
await page.waitForTimeout(1500); // opponent's set-up move
const scrollBefore = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
// A wrong move, then Hint at once: the red square's reset must not wipe the hint.
await tap("c3");
const b5 = await center("b5");
await page.touchscreen.tap(b5.x, b5.y);
await page.locator("cg-board square.wrong-sq:visible").waitFor({ timeout: 3000 });
await page.keyboard.press("h"); // Hint while the red square shows
await page.waitForTimeout(800);
check(await page.locator("cg-board square.hint-sq:visible").count() > 0, "a hint asked for right after a wrong move stays on the board");
await tap("c3"); await tap("d5"); // Nd5 by tapping
await page.waitForTimeout(1200); // Rh8 reply
check((await pieceOn("d5"))?.includes("knight"), "tap-tap move played Nd5");
await drag("h4", "f6"); // Bxf6+ by dragging
await page.waitForTimeout(1200); // Qxf6 reply
check((await pieceOn("f6"))?.includes("queen"), "touch drag played Bxf6+ (and Qxf6 came back)");
const scrollAfter = await page.evaluate(() => document.querySelector("main")?.scrollTop ?? 0);
check(scrollAfter === scrollBefore, `dragging a piece doesn't scroll the page (${scrollBefore} → ${scrollAfter})`);
await tap("d5"); await tap("f6"); // Nxf6
await page.waitForSelector("text=/^Solved/", { timeout: 5000 }).catch(() => null);
check(await page.locator("text=/^Solved/").count() > 0, "solved the puzzle with touch input");
await shot("solved");

// The daily queue: reveal, grade with the suggested button, next puzzle; then undo.
await page.goto(BASE + "#/practice");
await page.waitForSelector("cg-board");
await page.waitForTimeout(2000);
const done = async () => Number((await page.locator("main").innerText()).match(/(\d+) done/)?.[1] ?? -1);
const tapButton = async (re) => {
  const l = page.getByRole("button", { name: re }).first();
  const b = await l.boundingBox();
  const vh = page.viewportSize().height;
  const visible = !!b && b.y >= 0 && b.y + b.height <= vh - 64;
  if (!visible) await l.scrollIntoViewIfNeeded();
  const c = await l.boundingBox();
  await page.touchscreen.tap(c.x + c.width / 2, c.y + c.height / 2);
  return visible;
};
const before = await done();
for (let i = 0; i < 2; i++) {
  check(await tapButton(/Solution/), `puzzle ${i + 1}: Solution button is on screen`);
  await page.waitForTimeout(3500);
  check(await tapButton(/^Again/), `puzzle ${i + 1}: grade buttons are on screen without scrolling`);
  await page.waitForTimeout(2500);
}
check((await done()) === before + 2, `two grades counted (${before} → ${await done()})`);
await shot("queue");
await tapButton(/Undo/);
await page.waitForTimeout(2500);
check((await done()) === before + 1, "undo takes back the last grade");

check(errors.length === 0, `no console errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
