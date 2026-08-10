/**
 * Removes the checklist templates the builder-check script created, so the
 * account is left exactly as it was found. Deletes ONLY the two starter names
 * it created and nothing else.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:8080";
const SHOTS = "artifacts/live-check";
mkdirSync(SHOTS, { recursive: true });
const TARGETS = ["HVAC Inspection", "Damage Assessment"];

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForSelector('button[type="submit"]', { state: "visible" });
await page.fill('input[type="email"]', env.email);
await page.fill('input[type="password"]', env.password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 });
await page.waitForTimeout(4000);
console.log("login OK");

async function dismissOverlays() {
  // The "How's Templates working for you?" prompt sits over the editor chrome.
  for (const sel of ['button[aria-label="Close"]', 'button:has-text("×")']) {
    const el = page.locator(sel).first();
    if (
      await el
        .count()
        .then((c) => c > 0)
        .catch(() => false)
    ) {
      await el.click({ timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(300);
}

for (const name of TARGETS) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(`${BASE}/templates?tab=checklists`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    await dismissOverlays();

    const present = await page.evaluate((n) => document.body.innerText.includes(n), name);
    if (!present) break;

    // Select it in the rail so the editor's ⋯ menu targets this template.
    const railItem = page.locator(`button:has-text("${name}")`).first();
    if (await railItem.count()) {
      await railItem.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
    await dismissOverlays();

    const menu = page.getByRole("button", { name: /Template actions/i }).first();
    if (!(await menu.count())) break;
    await menu.click().catch(() => {});
    await page.waitForTimeout(800);
    const del = page.getByRole("menuitem", { name: /Delete template/i }).first();
    if (!(await del.count())) {
      await page.keyboard.press("Escape");
      continue;
    }
    await del.click();
    await page.waitForTimeout(1200);
    // Confirm dialog
    const confirm = page.getByRole("button", { name: /^Delete template$/i }).last();
    if (await confirm.count()) await confirm.click().catch(() => {});
    await page.waitForTimeout(3000);
  }
}

await page.goto(`${BASE}/templates?tab=checklists`, { waitUntil: "networkidle" });
await page.waitForTimeout(5000);
await page.screenshot({ path: `${SHOTS}/cleanup-final.png` });
const body = await page.locator("body").innerText();
const left = TARGETS.filter((t) => body.includes(t));
console.log(left.length ? `STILL PRESENT: ${left.join(", ")}` : "CLEAN — no test templates remain");
await browser.close();
