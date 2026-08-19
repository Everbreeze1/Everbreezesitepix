/**
 * Drives the two things the client asked for after the pipeline rework:
 *
 *   "when i add pipelines it gets created on the right side but no arrow to
 *    move it, it hides there."
 *
 *   "when i pick a project for a pipeline it attaches it nicely but I also
 *    have to click done ... Done is extra click thats not needed."
 *
 * Overflow cannot be staged with one pipeline on the board, so this CREATES a
 * few throwaway pipelines to push the strip past its edge, checks the arrows
 * and the pinned "+", and DELETES them again in a finally block. It leaves the
 * workspace exactly as it found it.
 *
 * Run with: node scripts/drive-pipeline-polish.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/pipeline-polish";
mkdirSync(SHOTS, { recursive: true });

/** Long enough that four of them cannot fit, distinctive enough to clean up. */
const TEMP = [
  "Zz Drive Check Alpha Long Name",
  "Zz Drive Check Bravo Long Name",
  "Zz Drive Check Charlie Long Name",
  "Zz Drive Check Delta Long Name",
];

const env = (p) => {
  const o = {};
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) o[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return o;
};

const results = [];
const ok = (n, d = "") => results.push({ pass: true, n, d });
const bad = (n, d = "") => results.push({ pass: false, n, d });

const main = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 900, height: 900 } })
    .then((c) => c.newPage());
  const created = [];

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
    await page
      .getByRole("button", { name: /Pipelines/i })
      .first()
      .click();
    await page.waitForTimeout(2500);

    const plus = page.locator('button[aria-label="Create pipeline"]');
    const rightArrow = page.locator('button[aria-label="Scroll pipelines right"]');
    const leftArrow = page.locator('button[aria-label="Scroll pipelines left"]');
    const scroller = page.locator("[data-board-id]").first().locator("xpath=..");

    if (await rightArrow.isVisible().catch(() => false)) {
      bad("no arrow before the strip overflows", "right arrow showing with one pipeline");
    } else {
      ok("no arrow before the strip overflows");
    }

    /* --------------------------------------------- create until it overflows */
    for (const name of TEMP) {
      const newDialog = page.locator('[role="dialog"]').filter({ hasText: "New Pipeline" });
      // The toast from the previous creation can sit over the strip, so the
      // first click is not guaranteed to land.
      for (let attempt = 0; attempt < 3; attempt++) {
        await plus.click({ force: true }).catch(() => {});
        await page.waitForTimeout(1200);
        if (await newDialog.isVisible().catch(() => false)) break;
      }
      await newDialog.waitFor({ state: "visible", timeout: 15000 });
      const input = page.locator("#board-name");
      await input.fill("");
      await input.pressSequentially(name, { delay: 8 });
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Create Pipeline" }).click();
      created.push(name);

      /*
       * Poll, do not sleep. Creating a pipeline is five sequential round trips
       * (name check, insert board, insert stages, then re-read both), which on
       * a cold connection is comfortably longer than any fixed wait worth
       * writing. A sleep here reported the app as broken when it was only slow.
       */
      let active = "";
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(500);
        active = (
          await page
            .locator('[data-board-id][aria-current="page"]')
            .innerText()
            .catch(() => "")
        ).trim();
        if (active === name) break;
      }
      if (active !== name) {
        bad(`creating "${name}" selects it`, `selected tab reads "${active}"`);
      }
    }
    if (!results.some((r) => !r.pass && /selects it/.test(r.n))) {
      ok("a new pipeline is selected the moment it is created");
    }
    await page.screenshot({ path: `${SHOTS}/20-overflowing.png` });

    /*
     * The client's actual complaint, stated as a check: after creating a
     * pipeline the selected tab must be ON SCREEN, not merely selected. This
     * is measured on the tab the app chose for itself, never on one Playwright
     * clicked - clicking scrolls the element into view as a side effect, which
     * would make the check pass without the app doing anything.
     */
    const selected = page.locator('[data-board-id][aria-current="page"]');
    const selectedName = (await selected.innerText().catch(() => "")).trim();
    const inView = await selected
      .evaluate((el) => {
        const box = el.getBoundingClientRect();
        const par = el.parentElement.getBoundingClientRect();
        return box.left >= par.left - 2 && box.right <= par.right + 2;
      })
      .catch(() => false);
    if (inView) ok("the newly created pipeline is on screen, not hiding", selectedName);
    else
      bad("the newly created pipeline is on screen, not hiding", selectedName || "none selected");

    /* --------------------------------------------------------- the arrows */
    const leftShown = await leftArrow.isVisible().catch(() => false);
    const rightShown = await rightArrow.isVisible().catch(() => false);
    if (leftShown || rightShown) {
      ok("an arrow appears once the strip overflows", `left:${leftShown} right:${rightShown}`);
    } else {
      bad("an arrow appears once the strip overflows", "neither arrow rendered");
    }

    if (await plus.isVisible()) ok('"+" stays reachable when the strip overflows');
    else bad('"+" stays reachable when the strip overflows', "scrolled out of view");

    const before = await scroller.evaluate((el) => el.scrollLeft);
    if (leftShown) {
      await leftArrow.click();
      await page.waitForTimeout(1200);
      const after = await scroller.evaluate((el) => el.scrollLeft);
      if (after < before) ok("the arrow actually scrolls the strip", `${before} -> ${after}`);
      else bad("the arrow actually scrolls the strip", `${before} -> ${after}`);
      await page.screenshot({ path: `${SHOTS}/21-scrolled-left.png` });

      // Having scrolled away from the end, the other arrow must now offer the
      // way back.
      if (await rightArrow.isVisible().catch(() => false)) {
        ok("the opposite arrow appears once there is something that way");
      } else {
        bad("the opposite arrow appears once there is something that way");
      }
    }

    /* ------------------------------------------- renaming stages in place */
    /*
     * Swapping two stage names is the case that needs the API's temporary-name
     * pass: `pipeline_stages_board_normalized_name_key` forbids two columns
     * that read the same, so writing "Scheduled" onto stage 1 while stage 2 is
     * still called "Scheduled" is a unique violation partway through an edit
     * that is perfectly legal by the time it finishes. Hand-written, never
     * exercised until here, and a failure would reach the client as a raw
     * Postgres error.
     */
    await page.getByRole("button", { name: /^Manage$/ }).click();
    await page.waitForTimeout(1500);
    const sheet = page.locator('[role="dialog"]').filter({ hasText: /Pipeline Settings/ });
    const stageInput = (n) => sheet.locator(`input[aria-label="Stage ${n} name"]`);

    const firstBefore = await stageInput(1).inputValue();
    const secondBefore = await stageInput(2).inputValue();
    await stageInput(1).fill(secondBefore);
    await stageInput(2).fill(firstBefore);
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Done$/ }).click();
    await page.waitForTimeout(4000);

    const err = await page
      .locator("[data-sonner-toast]")
      .filter({ hasText: /duplicate key|violates|could not save/i })
      .count()
      .catch(() => 0);
    if (err > 0) {
      bad("two stage names can be swapped", "the save errored");
    } else {
      await page.getByRole("button", { name: /^Manage$/ }).click();
      await page.waitForTimeout(1800);
      const firstAfter = await stageInput(1).inputValue();
      const secondAfter = await stageInput(2).inputValue();
      if (firstAfter === secondBefore && secondAfter === firstBefore) {
        ok(
          "two stage names can be swapped",
          `${firstBefore}/${secondBefore} -> ${firstAfter}/${secondAfter}`,
        );
      } else {
        bad(
          "two stage names can be swapped",
          `expected ${secondBefore}/${firstBefore}, got ${firstAfter}/${secondAfter}`,
        );
      }

      // Put them back, and prove a plain rename (no collision) still works.
      await stageInput(1).fill(firstBefore);
      await stageInput(2).fill(secondBefore);
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: /^Done$/ }).click();
      await page.waitForTimeout(3500);
      await page.getByRole("button", { name: /^Manage$/ }).click();
      await page.waitForTimeout(1800);
      if ((await stageInput(1).inputValue()) === firstBefore) ok("a plain rename saves");
      else bad("a plain rename saves", await stageInput(1).inputValue());
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
    }

    /* ----------------------------------------- the add-project dialog */
    await page.waitForTimeout(1200);
    const addBtn = page.locator('button[aria-label^="Add project to"]').first();
    if (await addBtn.isVisible().catch(() => false)) {
      await addBtn.click();
      await page.waitForTimeout(1200);
      const dialog = page.locator('[role="dialog"]').filter({ hasText: /Move a project to/ });
      const text = await dialog.innerText();
      await page.screenshot({ path: `${SHOTS}/22-add-project.png` });

      const hasDone = await dialog
        .getByRole("button", { name: /^Done$/ })
        .isVisible()
        .catch(() => false);
      if (hasDone) bad("the add-project dialog has no Done button");
      else ok("the add-project dialog has no Done button");

      if (/saved as you make it/i.test(text)) ok("it says the picks are already saved");
      else bad("it says the picks are already saved", text.split("\n")[1] ?? "");

      const closes = await dialog
        .locator('button:has(.sr-only:text("Close")), button:has-text("Close")')
        .count();
      if (closes > 0) ok("the dialog still has its own close control");
      else bad("the dialog still has its own close control");

      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      if (!(await dialog.isVisible().catch(() => false))) ok("Escape closes it");
      else bad("Escape closes it");
    } else {
      bad("add-project dialog reachable", "no column + button found");
    }
  } finally {
    /* ------------------------------------------------------------ cleanup */
    for (const name of created) {
      try {
        await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
        await page.waitForTimeout(2500);
        await page
          .getByRole("button", { name: /Pipelines/i })
          .first()
          .click();
        await page.waitForTimeout(2000);
        const tab = page.locator(`[data-board-id]`, { hasText: name }).first();
        if (!(await tab.isVisible().catch(() => false))) continue;
        await tab.click();
        await page.waitForTimeout(1200);
        await page.getByRole("button", { name: /^Manage$/ }).click();
        await page.waitForTimeout(1200);
        await page.getByRole("button", { name: /Delete Pipeline/i }).click();
        await page.waitForTimeout(900);
        await page.getByRole("button", { name: /^Continue$/ }).click();
        await page.waitForTimeout(2200);
        console.log(`  cleaned up "${name}"`);
      } catch (e) {
        console.error(`  COULD NOT CLEAN UP "${name}": ${e.message}`);
      }
    }
    await browser.close();
  }

  console.log("");
  let failures = 0;
  for (const r of results) {
    if (!r.pass) failures++;
    console.log(`  ${(r.pass ? "PASS" : "FAIL").padEnd(4)}  ${r.n}${r.d ? `  (${r.d})` : ""}`);
  }
  console.log("");
  console.log(failures === 0 ? "Pipeline polish verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
