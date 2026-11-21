// The perf session from perf.mjs, inside the Android app's WebView, plus cold starts of the app.
// Needs one device or emulator on adb with a debug build installed (WebView debugging is on there):
//   VITE_TEST_LOGIN=1 npm run cap:android && (cd android && ./gradlew assembleDebug)
//   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
//   TEST_PASSWORD=… node tests/e2e/perf-android.mjs
import { _android } from "playwright";
import { PASSWORD, isFailed, measure, report, waitForPatternsCopy } from "./perf.mjs";

const PKG = "com.atulpatildbz.chessfsrs";
const BUDGET = { launch: 1500, tap: 100 };

const [device] = await _android.devices();
if (!device) throw new Error("No Android device on adb");
console.log(`device: ${device.model()} (${(await device.shell("getprop ro.build.version.release")).toString().trim()})`);

const open = async () => {
  const wv = await device.webView({ pkg: PKG }, { timeout: 30000 });
  return wv.page();
};

/** Kill the app, start it, and time process start to the first frame with a page in it. */
async function coldStart() {
  await device.shell(`am force-stop ${PKG}`);
  await new Promise((r) => setTimeout(r, 1000));
  const out = (await device.shell(`date +%s%3N; am start -W -n ${PKG}/.MainActivity`)).toString();
  const t0 = Number(out.split("\n")[0]);
  const activity = Number(out.match(/TotalTime: (\d+)/)?.[1]);
  const page = await open();
  await page.waitForFunction(() => performance.getEntriesByName("app-ready").length > 0 || document.querySelector("input[name=password]"), null, { timeout: 30000 });
  const ready = await page.evaluate(() => performance.timeOrigin + (performance.getEntriesByName("app-ready")[0]?.startTime ?? NaN));
  return { page, activity, ready: Math.round(ready - t0) };
}

let { page } = await coldStart();
if (await page.locator("input[name=password]").count()) {
  await page.fill("input[name=email]", process.env.TEST_EMAIL ?? "test@chessfsrs.local");
  await page.fill("input[name=password]", PASSWORD);
  await page.click("button:has-text('Sign in')");
  await page.waitForSelector("main", { timeout: 30000 });
  await page.evaluate(() => { location.hash = "#/library"; });
  await page.waitForFunction(() => /Library \d+/.test(document.querySelector("h1")?.textContent ?? "") && !/Library 0/.test(document.querySelector("h1").textContent), null, { timeout: 30000 });
  await page.waitForTimeout(3000);
}

const starts = [];
for (let i = 0; i < 3; i++) starts.push(await coldStart());
const med = (xs) => xs.sort((a, b) => a - b)[1];
page = starts.at(-1).page;
await waitForPatternsCopy(page);
const r = {
  "launch: cold start, Android shows the app window": med(starts.map((s) => s.activity)),
  "launch: cold start, first page drawn": med(starts.map((s) => s.ready)),
};

const airplane = async (on) => {
  await device.shell(`cmd connectivity airplane-mode ${on ? "enable" : "disable"}`);
  await new Promise((res) => setTimeout(res, on ? 1500 : 4000));
};
let touch = null;
try {
  Object.assign(r, await measure(page, {
  // A hash-only goto stays in the same document; set the hash, then really reload.
  reload: async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.reload(); },
  offline: airplane,
  // Real touch events through DevTools (Playwright's touchscreen needs a context it created).
  press: async (x, y) => {
    touch ??= await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  },
}));
} finally {
  await device.shell("cmd connectivity airplane-mode disable"); // never leave the device offline
}
report(`android (${device.model()} WebView)`, r, BUDGET);
await device.close();
if (isFailed()) { console.log("\nSome timings are over budget."); process.exitCode = 1; }
