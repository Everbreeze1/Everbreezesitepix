/**
 * Delete a template copy a driver left behind.
 *
 * Opening the editor on an EXAMPLE inserts a team-owned copy, because an
 * example belongs to no team and RLS refuses the write. Closing without edits
 * deletes it again - but if the run dies in between, the row stays, in a
 * database shared with production.
 *
 * The card count does NOT catch this: a copy records `copiedFrom` and shadows
 * the example it was made from, so the library is the same length with the
 * stray row as without it. `check-template-library-clean.mjs` looks at which
 * templates the team OWNS instead, and this deletes one by exact name.
 *
 * Deliberately narrow: it will only remove a template whose name matches the
 * argument exactly, and it reports what it did.
 *
 *   node scripts/cleanup-stray-template-copy.mjs "Some Template (copy)"
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const TARGET = process.argv[2];
if (!TARGET) {
  console.error('usage: node scripts/cleanup-stray-template-copy.mjs "Exact Template Name"');
  process.exit(1);
}

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

  /*
   * Matched on a substring, not on the whole label.
   *
   * An exact selector found nothing while the row was plainly on the page -
   * template names carry ampersands and the odd non-breaking space, and one
   * character out of eighty is enough to miss. The exact name is printed
   * before anything is deleted so the match can be read back.
   */
  const matches = await page.evaluate(
    (target) =>
      [...document.querySelectorAll('button[aria-label^="More actions for"]')]
        .map((b) => b.getAttribute("aria-label").replace("More actions for ", ""))
        .filter((name) => name.includes(target)),
    TARGET,
  );
  const found = matches.length;
  console.log(`"${TARGET}": ${found} matching team-owned template(s)`);
  for (const name of matches) console.log(`  - ${name}`);
  if (found !== 1) {
    console.log("nothing to do (need exactly one match)");
    await browser.close();
    process.exit(found === 0 ? 0 : 1);
  }

  await page
    .locator(`button[aria-label="More actions for ${matches[0].replace(/"/g, '\\"')}"]`)
    .first()
    .click();
  await page.waitForTimeout(600);
  await page.getByRole("menuitem", { name: /Delete/ }).click();
  await page.waitForTimeout(1000);
  /*
   * The confirm button says "Continue".
   *
   * `remove()` calls confirm() without a confirmText, so it falls back to the
   * default in use-confirm.tsx. Looking for /Delete/i matched only the
   * DESCRIPTION - the button was never clicked, the modal stayed open, and the
   * script cheerfully reported success.
   */
  const action = page.locator('[role="alertdialog"] button').filter({ hasText: /^Continue$/ });
  await action.first().waitFor({ state: "visible", timeout: 15000 });
  await action.first().click();
  await page.waitForTimeout(4000);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 120000 });
  await page.waitForTimeout(2500);
  // Same substring match used to find it, or this re-check is worthless too.
  const left = await page.evaluate(
    (target) =>
      [...document.querySelectorAll('button[aria-label^="More actions for"]')].filter((b) =>
        b.getAttribute("aria-label").includes(target),
      ).length,
    TARGET,
  );
  console.log(left === 0 ? "deleted - the example is back in its place" : "STILL THERE");
  await browser.close();
  process.exit(left === 0 ? 0 : 1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
