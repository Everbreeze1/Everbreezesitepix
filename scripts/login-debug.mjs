import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:8080";
mkdirSync("artifacts/live-check", { recursive: true });

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text().slice(0, 250));
});
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e).slice(0, 250)));
page.on("requestfailed", (r) =>
  console.log("REQ FAILED:", r.method(), r.url().slice(0, 120), r.failure()?.errorText),
);
page.on("response", async (r) => {
  if (r.status() >= 400 && !/favicon|\.map$/.test(r.url())) {
    let body = "";
    try {
      body = (await r.text()).slice(0, 300);
    } catch {}
    console.log("HTTP", r.status(), r.url().slice(0, 140), body);
  }
  if (/auth\/v1\/token/.test(r.url())) {
    let body = "";
    try {
      body = (await r.text()).slice(0, 300);
    } catch {}
    console.log(
      "AUTH RESPONSE",
      r.status(),
      body.replace(/"access_token":"[^"]+"/, '"access_token":"<redacted>"'),
    );
  }
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });

console.log("--- inputs on page ---");
console.log(
  await page.evaluate(() =>
    Array.from(document.querySelectorAll("input")).map(
      (i) => `${i.type} name=${i.name} id=${i.id} placeholder=${i.placeholder}`,
    ),
  ),
);
console.log("--- buttons on page ---");
console.log(
  await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).map(
      (b) => `type=${b.type} "${(b.textContent || "").trim().slice(0, 40)}"`,
    ),
  ),
);

await page.fill('input[type="email"]', env.email);
await page.fill('input[type="password"]', env.password);
await page.screenshot({ path: "artifacts/live-check/debug-filled.png" });
await page.click('button[type="submit"]');
await page.waitForTimeout(8000);

console.log("--- url after submit ---", page.url());
await page.screenshot({ path: "artifacts/live-check/debug-after.png", fullPage: true });
const text = await page.locator("body").innerText();
console.log("--- body text (last 1200 chars) ---");
console.log(text.slice(-1200));

await browser.close();
