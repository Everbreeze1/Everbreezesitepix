/**
 * Read-only: is the document template library exactly as it should be?
 *
 * The drivers in this repo open the editor to look at it, and on an account
 * whose library is all examples that INSERTS a copy which closing is supposed
 * to delete again. If a run dies between those two points the row is stranded -
 * in a database shared with production - so after any driver that timed out,
 * this is the thing to run.
 *
 * Writes nothing. Counts the cards and reports any name that appears twice.
 *
 * Run with: node scripts/check-template-library-clean.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const EXPECTED = Number(process.env.EXPECTED_CARDS ?? 30);

function env() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const run = async () => {
  const { email, password } = env();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await ctx.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let i = 0; i < 5; i += 1) {
    await page.locator('input[type="email"]').fill("");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 8 });
    await page.locator('input[type="password"]').fill("");
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 8 });
    await page.waitForTimeout(2000);
    if ((await page.locator('input[type="email"]').inputValue()) === email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);

  await page.goto(`${BASE}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 120000 });
  await page.waitForTimeout(3000);

  const report = await page.evaluate(() => ({
    // One "Use in a project" button per card.
    total: [...document.querySelectorAll("button")].filter(
      (b) => b.textContent?.trim() === "Use in a project",
    ).length,
    // The "..." menu renders only under `canManage && !isExample`, so its
    // aria-label is a precise list of the templates the team owns - which is
    // exactly what a stranded copy would show up in.
    owned: [...document.querySelectorAll('button[aria-label^="More actions for"]')].map((b) =>
      b.getAttribute("aria-label").replace("More actions for ", ""),
    ),
  }));

  console.log(`cards on the page: ${report.total} (expected ${EXPECTED})`);
  console.log(
    report.owned.length
      ? `team-owned templates (${report.owned.length}): ${report.owned.join(", ")}`
      : "team-owned templates: none - the library is all examples, as it was",
  );

  const clean = report.total === EXPECTED && report.owned.length === 0;
  console.log(clean ? "\nLIBRARY CLEAN" : "\nLIBRARY DIRTY - a row was left behind");
  await browser.close();
  process.exit(clean ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
