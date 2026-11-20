// End-to-end smoke test against a running dev server (npm run dev) and the dev Convex deployment.
//   node tests/e2e/smoke.mjs [outDir]
// Needs an allowlisted test email on the dev deployment (allowlist:grant).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5173/";
const OUT = process.argv[2] ?? "test-results";
const EMAIL = process.env.TEST_EMAIL ?? "test@chessfsrs.local";
const PASSWORD = process.env.TEST_PASSWORD;
if (!PASSWORD) throw new Error("Set TEST_PASSWORD (and TEST_EMAIL) for an allowlisted dev account");
const mobile = process.env.MOBILE === "1";

const browser = await chromium.launch();
const page = await browser.newPage(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true } : { viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const shot = (n) => page.screenshot({ path: `${OUT}/${mobile ? "m-" : ""}${n}.png` });

await page.goto(BASE);
await page.waitForSelector("input[name=email]");
await shot("01-signin");
await page.fill("input[name=email]", EMAIL);
await page.fill("input[name=password]", PASSWORD);
await page.click("button:has-text('Sign in')");
// First run: account doesn't exist yet -> create it.
const signedIn = await page.waitForSelector("text=Start practice, text=Train on the moves you missed, text=All caught up, [role=alert]", { timeout: 15000 }).catch(() => null);
if (await page.$("[role=alert]")) {
  await page.click("text=First time here? Create an account");
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button:has-text('Create account')");
}
await page.waitForSelector("main", { timeout: 15000 });
await page.waitForTimeout(1500);
await shot("02-home");

// Add the user's example puzzle.
await page.goto(BASE + "#/add");
await page.click("text=Paste the example");
await page.waitForTimeout(500);
await shot("03-add");
await page.click("button:has-text('Add puzzle')");
await page.waitForSelector("text=/Added \\d/");
await shot("04-added");

// Practice: solve it (White: Nd5, Bxf6+, Nxf6), with one wrong move first.
async function clickSquare(sq, orientation = "white") {
  const box = await page.locator("cg-board").first().boundingBox();
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]) - 1;
  const x = orientation === "white" ? f : 7 - f, y = orientation === "white" ? 7 - r : r;
  await page.mouse.click(box.x + (x + 0.5) * (box.width / 8), box.y + (y + 0.5) * (box.height / 8));
}
async function move(from, to) { await clickSquare(from); await page.waitForTimeout(120); await clickSquare(to); }

await page.goto(BASE + "#/practice");
await page.waitForSelector("cg-board");
await page.waitForTimeout(1600); // opponent's set-up move
await shot("05-practice-start");
// Our puzzle may not be first if the account has others: find it via text of the prompt instead.
await move("c3", "b5"); // wrong
await page.waitForTimeout(250);
await shot("06-wrong");
await page.waitForTimeout(700);
await move("c3", "d5");
await page.waitForTimeout(1000);
await move("h4", "f6");
await page.waitForTimeout(1000);
await move("d5", "f6");
await page.waitForTimeout(900);
await shot("07-solved");
const again = await page.locator("button:has-text('Again')").count();
console.log("grade buttons:", again ? "yes" : "NO");
await page.keyboard.press("Space");
await page.waitForTimeout(1500);
await shot("08-after-grade");

await page.goto(BASE + "#/library");
await page.waitForTimeout(1500);
await shot("09-library");
await page.goto(BASE + "#/import");
await page.waitForTimeout(800);
await shot("10-import");
await page.goto(BASE + "#/");
await page.waitForTimeout(1500);
await shot("11-home-after");

console.log(errors.length ? "ERRORS:\n" + errors.join("\n") : "no console errors");
await browser.close();
