/**
 * Exercises the checklist builder — the screen from the original bug report.
 *
 * The test account is empty, so nothing can be measured without data. This
 * creates ONE starter template ("HVAC Inspection", the same one in the report),
 * measures the layout fixes against the real rendered page, then DELETES it
 * again so the account is left as it was found.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:8080";
const SHOTS = "artifacts/live-check";
mkdirSync(SHOTS, { recursive: true });

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const findings = [];
const say = (s) => console.log(s);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", (m) => {
  if (m.type() === "error" && !/DevTools|\[vite\]|favicon/i.test(m.text()))
    findings.push(`console: ${m.text().slice(0, 200)}`);
});
page.on("pageerror", (e) => findings.push(`pageerror: ${String(e).slice(0, 200)}`));
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|\.map$/.test(r.url()))
    findings.push(`http ${r.status()} ${r.url().replace(BASE, "").slice(0, 120)}`);
});

// ---- login ----
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForSelector('button[type="submit"]', { state: "visible" });
await page.fill('input[type="email"]', env.email);
await page.fill('input[type="password"]', env.password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 });
await page.waitForTimeout(4000);
say("login OK");

// ---- does the checklists panel finish loading? ----
await page.goto(`${BASE}/templates?tab=checklists`, { waitUntil: "networkidle" });
await page.waitForTimeout(12000);
const stillSpinning = await page.evaluate(() => !!document.querySelector(".animate-spin"));
await page.screenshot({ path: `${SHOTS}/builder-01-empty.png` });
say(`spinner still visible after 12s: ${stillSpinning}`);
if (stillSpinning) findings.push("checklists tab: spinner still visible after 12s");

// ---- create one starter so there is something to measure ----
say("creating starter template…");
await page.getByRole("button", { name: /Starters/i }).click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${SHOTS}/builder-02-starters.png` });
const card = page.locator("text=HVAC Inspection").first();
await card.waitFor({ timeout: 15000 });
await page
  .locator("div")
  .filter({ hasText: /HVAC Inspection/ })
  .getByRole("button", { name: /Use this template/i })
  .first()
  .click();
await page.waitForTimeout(6000);
await page.screenshot({ path: `${SHOTS}/builder-03-created.png` });
say("starter created");

// ---- geometry: FAB vs the bottom toolbar (the original complaint) ----
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(1200);
const fab = await page.evaluate(() => {
  const f = document.querySelector(
    'button[aria-label="Open camera"], button[aria-label^="Create a project"]',
  );
  if (!f) return null;
  const r = f.getBoundingClientRect();
  const hits = [];
  for (const el of document.querySelectorAll("button, a, input, [role='button']")) {
    if (el === f || f.contains(el)) continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 || b.height === 0) continue;
    if (b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top)
      hits.push(
        (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 50),
      );
  }
  return { fab: { top: r.top, left: r.left }, hits };
});
say(`FAB overlap check: ${JSON.stringify(fab)}`);
if (fab?.hits?.length) findings.push(`FAB covers: ${fab.hits.join(" | ")}`);
await page.screenshot({ path: `${SHOTS}/builder-04-bottom.png` });

// ---- geometry: do the two sticky panes line up when scrolled? ----
await page.evaluate(() => window.scrollTo(0, 500));
await page.waitForTimeout(900);
const sticky = await page.evaluate(() => {
  const stickies = Array.from(document.querySelectorAll("div")).filter(
    (d) => getComputedStyle(d).position === "sticky",
  );
  return stickies.map((d) => ({
    top: Math.round(d.getBoundingClientRect().top),
    cls: d.className.toString().slice(0, 70),
  }));
});
say(`sticky elements: ${JSON.stringify(sticky, null, 1)}`);
await page.screenshot({ path: `${SHOTS}/builder-05-scrolled.png` });

// ---- clean up: remove the template this script created ----
say("cleaning up…");
try {
  await page
    .getByRole("button", { name: /Template actions/i })
    .first()
    .click();
  await page.waitForTimeout(800);
  await page.getByRole("menuitem", { name: /Delete template/i }).click();
  await page.waitForTimeout(1200);
  await page
    .getByRole("button", { name: /Delete template/i })
    .last()
    .click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/builder-06-cleaned.png` });
  const gone = await page.evaluate(() => !document.body.innerText.includes("HVAC Inspection"));
  say(`cleanup removed the template: ${gone}`);
  if (!gone)
    findings.push("CLEANUP INCOMPLETE — 'HVAC Inspection' still present, delete it manually");
} catch (e) {
  findings.push(`CLEANUP FAILED (${String(e).slice(0, 120)}) — delete 'HVAC Inspection' manually`);
}

await browser.close();

console.log("\n============ FINDINGS ============");
if (!findings.length) console.log("none");
else [...new Set(findings)].forEach((f) => console.log(" - " + f));
