// Phone screenshots of every page and the main practice states, for eyeballing layout.
//   [COLOR_SCHEME=light] TEST_PASSWORD=… node tests/e2e/shots.mjs outDir [deviceName]
import { chromium, webkit, devices } from "playwright";
const BASE = process.env.BASE_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? "test-results";
const dev = process.argv[3] ?? "Pixel 7";
const tag = dev.replace(/\s+/g, "");
const browser = await (/iPhone/.test(dev) ? webkit : chromium).launch();
const scheme = process.env.COLOR_SCHEME ?? "dark";
const ctx = await browser.newContext({ ...devices[dev], colorScheme: scheme });
const page = await ctx.newPage();
const shot = (n) => page.screenshot({ path: `${OUT}/${tag}-${scheme}-${n}.png` });
await page.goto(BASE);
await shot("00-signin");
await page.fill("input[name=email]", process.env.TEST_EMAIL ?? "test@chessfsrs.local");
await page.fill("input[name=password]", process.env.TEST_PASSWORD);
await page.click("button:has-text('Sign in')");
await page.waitForSelector("main", { timeout: 15000 });
for (const [n, h] of [["01-home", ""], ["03-library", "#/library"], ["05-patterns", "#/patterns"], ["06-add", "#/add"], ["07-import", "#/import"], ["08-settings", "#/settings"]]) {
  await page.goto(BASE + h); await page.waitForTimeout(1800); await shot(n);
}
await page.goto(BASE + "#/library"); await page.waitForTimeout(1500);
await page.locator("a[href^='#/puzzle/']").first().click(); await page.waitForTimeout(1500); await shot("04-detail");
await page.goto(BASE + "#/practice"); await page.waitForTimeout(2500); await shot("02a-practice");
await page.getByRole("button", { name: /Hint/ }).first().click().catch(() => {}); await page.waitForTimeout(500); await shot("02b-hint");
await page.getByRole("button", { name: /Solution/ }).first().click().catch(() => {}); await page.waitForTimeout(4000); await shot("02c-graded");
await page.evaluate(() => document.querySelector("main").scrollTo(0, 1e5)); await page.waitForTimeout(400); await shot("02d-graded-bottom");
await browser.close();
