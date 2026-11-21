// Offline practice end to end, on a production build (the service worker only runs there):
//   VITE_TEST_LOGIN=1 npx vite build --outDir dist-test && npx vite preview --outDir dist-test --port 4173 &
//   TEST_PASSWORD=… node tests/e2e/offline.mjs [outDir]
// Signs in online, goes offline, grades two puzzles, reloads while still offline (the app must open
// from the service worker, signed in, with both grades still applied), comes back online, and checks
// the server got exactly two new reviews.
import { execSync } from "node:child_process";
import { chromium, webkit, devices } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:4173/";
const OUT = process.argv[2] ?? "test-results";
const PASSWORD = process.env.TEST_PASSWORD;
if (!PASSWORD) throw new Error("Set TEST_PASSWORD for the dev test account");
const isWebkit = process.env.BROWSER === "webkit";
const fail = (msg) => { console.error("FAIL:", msg); process.exitCode = 1; };
const check = (ok, msg) => (ok ? console.log("ok:", msg) : fail(msg));
const reviewsOnServer = () => Number(execSync("npx convex data reviews --limit 8000 --format jsonLines | wc -l", { encoding: "utf8" }).trim());

const browser = await (isWebkit ? webkit : chromium).launch();
const ctx = await browser.newContext({ ...devices[isWebkit ? "iPhone 13" : "Pixel 7"] });
const page = await ctx.newPage();
const errors = [];
// Convex Auth tries to refresh its token while offline and leaves the failed fetch unhandled.
page.on("pageerror", (e) => /Failed to fetch|Load failed|NetworkError/.test(String(e)) || errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/offline-${n}.png` });

await page.goto(BASE);
await page.fill("input[name=email]", process.env.TEST_EMAIL ?? "test@chessfsrs.local");
await page.fill("input[name=password]", PASSWORD);
await page.click("button:has-text('Sign in')");
await page.waitForSelector("main", { timeout: 20000 });
// Let the service worker install and the library copy arrive.
// (waitForFunction treats an async predicate's Promise as truthy, so poll instead.)
for (let i = 0; !(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state === "activated")); i++) {
  if (i > 40) throw new Error("service worker never activated");
  await page.waitForTimeout(500);
}
await page.goto(BASE + "#/library");
await page.waitForFunction(() => /Library \d+/.test(document.querySelector("h1")?.textContent ?? "") && !/Library 0/.test(document.querySelector("h1").textContent), null, { timeout: 20000 });
await page.waitForTimeout(1500);
const before = reviewsOnServer();
console.log("reviews on server before:", before);

await ctx.setOffline(true);
await page.goto(BASE + "#/practice");
await page.waitForTimeout(1500);

async function gradeOne(i) {
  const prompt = page.locator("[aria-live=polite]");
  await page.getByRole("button", { name: /Solution/ }).waitFor({ timeout: 10000 });
  // Wait for the opponent's intro move so Solution is enabled.
  await page.waitForFunction(() => !document.querySelector("button:has(svg.lucide-eye)")?.disabled, null, { timeout: 10000 }).catch(() => {});
  const first = await prompt.textContent();
  await page.getByRole("button", { name: /Solution/ }).click();
  await page.getByRole("button", { name: /^Again/ }).waitFor({ timeout: 15000 });
  await shot(`graded-${i}`);
  await page.getByRole("button", { name: /^Good/ }).click();
  await page.waitForTimeout(800);
  return first;
}
await gradeOne(1);
await gradeOne(2);
const note = await page.locator("[role=status]").first().textContent().catch(() => "");
check(/2 grades will sync/.test(note ?? ""), `offline note counts the grades ("${note}")`);
await page.waitForTimeout(2000);
check(reviewsOnServer() === before, "nothing reached the server while offline");

// Reload with no network: the service worker serves the app and the local copy keeps the grades.
await page.reload();
await page.waitForSelector("main", { timeout: 15000 });
await page.waitForTimeout(1500);
await shot("reloaded-offline");
const note2 = await page.locator("[role=status]").first().textContent().catch(() => "");
check(/2 grades will sync/.test(note2 ?? ""), `after an offline reload the grades are still queued ("${note2}")`);

await ctx.setOffline(false);
await page.waitForFunction(() => !document.querySelector("[role=status]"), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(3000);
await shot("back-online");
const after = reviewsOnServer();
check(after === before + 2, `server got exactly 2 reviews (${before} -> ${after})`);

// A second reload online must not send them again.
await page.reload();
await page.waitForSelector("main", { timeout: 15000 });
await page.waitForTimeout(5000);
check(reviewsOnServer() === before + 2, "no duplicates after reloading online");
check(errors.length === 0, `no page errors${errors.length ? ": " + errors.join(" | ") : ""}`);
await browser.close();
