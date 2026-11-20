// Render public/icon.svg to the PNG sizes the manifest and Android need.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const svg = readFileSync(new URL("../public/icon.svg", import.meta.url), "utf8");
const b = await chromium.launch();
const p = await b.newPage();
for (const [size, file, pad] of [[192, "icon-192.png", 0], [512, "icon-512.png", 0], [512, "icon-512-maskable.png", 0.12], [1024, "icon-1024.png", 0]]) {
  await p.setViewportSize({ width: size, height: size });
  const inner = pad ? svg.replace('rx="14"', 'rx="0"') : svg;
  await p.setContent(`<style>html,body{margin:0;background:${pad ? "#0F2A23" : "transparent"}}</style><div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">${inner.replace("<svg ", `<svg width="${size * (1 - pad * 2)}" height="${size * (1 - pad * 2)}" `)}</div>`);
  await p.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname, omitBackground: !pad });
}
await b.close();
