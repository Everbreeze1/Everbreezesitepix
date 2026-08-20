/**
 * Drives the client's feedback on the project page:
 *
 *   "To change the project status I have to go to the three dot menu on top of
 *    the project to edit the project, then i can change the status to complete
 *    or onhold etc. I think this status change should be readily available on
 *    the project page itself."
 *
 * Opens a project, changes the status from its own header, checks that the
 * label, the dot and the cover badge all follow, then reloads to prove the
 * write landed - and puts the original status back in a finally block, so the
 * workspace is left exactly as it was found.
 *
 * Run with: node scripts/drive-project-status-chip.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/project-status-chip";
mkdirSync(SHOTS, { recursive: true });

const env = (p) => {
  const o = {};
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
};

const BUCKETS = ["Active", "On hold", "Completed"];

const results = [];
const ok = (n, d = "") => results.push({ pass: true, n, d });
const bad = (n, d = "") => results.push({ pass: false, n, d });

/** The chip, addressed the way a screen reader would. */
const chipOf = (page) => page.locator('button[aria-label^="Project status:"]');

const statusOf = async (page) =>
  ((await chipOf(page).getAttribute("aria-label")) ?? "")
    .replace(/^Project status:\s*/, "")
    .replace(/\.\s*Change status$/, "")
    .trim();

const main = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1280, height: 900 } })
    .then((c) => c.newPage());
  let original = null;
  let projectUrl = null;
  /** The stage it was standing in when we found it, if it was in a pipeline. */
  let startedInStage = null;

  try {
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForSelector('button[type="submit"]', { state: "visible" });
    for (let i = 0; i < 6; i++) {
      await page.fill('input[type="email"]', "");
      await page.fill('input[type="password"]', "");
      await page.locator('input[type="email"]').pressSequentially(email, { delay: 12 });
      await page.locator('input[type="password"]').pressSequentially(password, { delay: 12 });
      await page.waitForTimeout(2000);
      if ((await page.inputValue('input[type="email"]')) === email) break;
    }
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    if (/\/login/.test(new URL(page.url()).pathname)) throw new Error("login failed");
    ok("login");

    await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    /*
     * By href, not by clicking the first project-ish link: the sidebar's
     * "Recently deleted" is also under /projects/, and a run that opens the
     * trash instead of a project fails in a way that reads as a missing chip.
     */
    const href = await page
      .$$eval("a", (as) =>
        as
          .map((a) => a.getAttribute("href"))
          .find((h) => h && /^\/projects\/[0-9a-f-]{36}$/.test(h)),
      )
      .catch(() => null);
    if (!href) throw new Error("no project to open");
    await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    projectUrl = page.url();

    /* ------------------------------------------------ the chip is even there */
    const chip = chipOf(page);
    if (!(await chip.isVisible().catch(() => false))) {
      bad("status is a control in the header", "no status chip found");
      return;
    }
    original = await statusOf(page);
    ok("status is a control in the header", `reads "${original}"`);
    await page.screenshot({ path: `${SHOTS}/10-header.png` });

    /*
     * This script covers the project that is in NO pipeline, which is the only
     * case where the three buckets are set by hand. A project standing in a
     * stage takes its bucket from that stage instead - see
     * drive-status-stage-reconciliation.mjs - so take it out of the pipeline
     * first, and put it back in the finally block.
     */
    await chip.click();
    let menu = page.locator('[role="menu"]').last();
    await menu.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(700);
    const outOfPipeline = menu.getByRole("menuitem", { name: /Not in a pipeline/i });
    if ((await outOfPipeline.isEnabled().catch(() => false)) === true) {
      startedInStage = original;
      await outOfPipeline.click();
      for (let i = 0; i < 30; i++) {
        await page.waitForTimeout(400);
        if (BUCKETS.includes(await statusOf(page))) break;
      }
      original = await statusOf(page);
      ok("a project can be taken out of its pipeline", `now reads "${original}"`);
      await chip.click();
      menu = page.locator('[role="menu"]').last();
      await menu.waitFor({ state: "visible", timeout: 10000 });
      await page.waitForTimeout(700);
    }

    /* ------------------------------------------------------- open and choose */
    for (const label of ["Active", "On hold", "Completed"]) {
      const item = menu.getByRole("menuitem", { name: label, exact: true });
      if (await item.isVisible().catch(() => false)) ok(`"${label}" is offered`);
      else bad(`"${label}" is offered`, "missing from the menu");
    }
    await page.screenshot({ path: `${SHOTS}/20-menu-open.png` });
    const target = original === "On hold" ? "Completed" : "On hold";
    await menu.getByRole("menuitem", { name: target, exact: true }).click();

    /*
     * The toast is watched inside this loop, not after it: it is on a timer,
     * and a poll that only looks once the write has finished can arrive after
     * it has already faded, which reads as "the app said nothing".
     */
    let after = "";
    let sawToast = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(400);
      if (!sawToast) {
        sawToast = await page
          .locator("[data-sonner-toast]")
          .filter({ hasText: /Status set to/i })
          .first()
          .isVisible()
          .catch(() => false);
      }
      after = await statusOf(page);
      if (after === target && sawToast) break;
    }
    if (after === target) ok("one click changes it", `"${original}" to "${target}"`);
    else bad("one click changes it", `chip still reads "${after}"`);
    sawToast ? ok("the change is confirmed") : bad("the change is confirmed", "no toast");
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/30-changed.png` });

    /* ------------------------------------------------------ it actually saved */
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(4000);
    const persisted = await statusOf(page);
    if (persisted === target) ok("it survives a reload");
    else bad("it survives a reload", `reads "${persisted}" after reload`);
    await page.screenshot({ path: `${SHOTS}/40-after-reload.png` });

    /* --------------------------- the old route still works and agrees with it */
    await page.locator('button[aria-label="Project actions"]').click();
    await page.getByRole("menuitem", { name: /Edit details/i }).click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Edit project" });
    await dialog.waitFor({ state: "visible", timeout: 15000 });
    const inDialog = (
      await dialog
        .locator("#ep-status")
        .innerText()
        .catch(() => "")
    ).trim();
    if (inDialog.toLowerCase() === target.toLowerCase()) ok("the edit dialog agrees");
    else bad("the edit dialog agrees", `dialog reads "${inDialog}"`);
    await page.screenshot({ path: `${SHOTS}/50-edit-dialog.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  } catch (e) {
    bad("run", e?.message ?? String(e));
  } finally {
    /*
     * Put it back exactly as it was: the bucket first, then the stage it was
     * standing in - in that order, because moving it back into the stage is
     * what re-stamps the bucket, and doing the bucket second would leave the
     * two disagreeing, which is the state this whole round exists to remove.
     */
    const restoreTo = startedInStage ?? original;
    if (restoreTo && projectUrl) {
      try {
        await page.goto(projectUrl, { waitUntil: "networkidle" });
        await page.waitForTimeout(3000);
        if (!startedInStage && (await statusOf(page)) !== original) {
          await chipOf(page).click();
          await page
            .locator('[role="menu"]')
            .last()
            .getByRole("menuitem", { name: original, exact: true })
            .click();
          await page.waitForTimeout(2500);
        }
        if (startedInStage && (await statusOf(page)) !== startedInStage) {
          await chipOf(page).click();
          await page
            .locator('[role="menu"]')
            .last()
            .getByRole("menuitem", { name: new RegExp(`^${startedInStage}\\b`) })
            .click();
          await page.waitForTimeout(2500);
        }
        console.log(`restored to "${restoreTo}"`);
      } catch (e) {
        console.log(`COULD NOT RESTORE to "${restoreTo}": ${e?.message ?? e}`);
      }
    }
    await browser.close();
    const failed = results.filter((r) => !r.pass);
    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.n}${r.d ? `  (${r.d})` : ""}`);
    }
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
};

main();
