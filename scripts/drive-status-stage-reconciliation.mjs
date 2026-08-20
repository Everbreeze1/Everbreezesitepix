/**
 * Drives the client's third round on project status:
 *
 *   "Beside the statuses where Invoiced, Scheduled is, there is another status
 *    also that says complete, Active or onhold. we have to reconcile between
 *    these two statuses. The active onhold status is also on maps."
 *
 * The reconciliation under test: the stage owns the bucket. So this checks the
 * project header carries ONE chip rather than two, that moving a job to a stage
 * mapped to Completed takes it off the map's Active filter in the same breath,
 * and that the map and the project list say the team's word for where the job
 * is instead of the roll-up of it.
 *
 * Note on the database: this runs fine before
 * 20260922000000_pipeline_stage_status.sql is applied. Without the column the
 * API derives each stage's bucket from its name, which is the same rule the
 * migration seeds with, so the six default stages behave identically either
 * way. What you cannot check until it lands is editing a stage's mapping.
 *
 * Leaves the project on the stage and status it was found on.
 *
 * Run with: node scripts/drive-status-stage-reconciliation.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/status-stage-reconciliation";
mkdirSync(SHOTS, { recursive: true });

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

const BUCKETS = ["Active", "On hold", "Completed"];

const chipOf = (page) => page.locator('button[aria-label^="Project status:"]');
const chipLabel = async (page) =>
  ((await chipOf(page).getAttribute("aria-label")) ?? "")
    .replace(/^Project status:\s*/, "")
    .replace(/\.\s*Change status$/, "")
    .trim();

const openChipMenu = async (page) => {
  await chipOf(page).click();
  const menu = page.locator('[role="menu"]').last();
  await menu.waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(600);
  return menu;
};

const main = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const page = await browser
    .newContext({ viewport: { width: 1400, height: 950 } })
    .then((c) => c.newPage());
  let projectUrl = null;
  let projectName = null;
  let original = null;

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
    await page.waitForTimeout(3500);
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
    projectName = (await page.locator("h1").first().innerText()).trim();

    /* ------------------------------------------------- one chip, not two */
    const chips = await chipOf(page).count();
    if (chips === 1) ok("the header carries one status control");
    else bad("the header carries one status control", `${chips} found`);

    original = await chipLabel(page);

    // The row the chip sits in must not also carry a bucket chip beside it.
    // That pairing - "LEAD/QUOTED" next to "Active" - is the whole complaint.
    const rowText = (
      await chipOf(page)
        .evaluateHandle((el) => el.parentElement)
        .then((h) => h.evaluate((el) => el.innerText))
    )
      .replace(/\s+/g, " ")
      .trim();
    const strays = BUCKETS.filter((b) => b !== original && new RegExp(`\\b${b}\\b`).test(rowText));
    if (strays.length === 0) ok("no second status chip beside it", `row reads "${rowText}"`);
    else bad("no second status chip beside it", `also shows ${strays.join(", ")}`);
    await page.screenshot({ path: `${SHOTS}/10-header-one-chip.png` });

    /* --------------------------------- the menu says what a stage counts as */
    const menu = await openChipMenu(page);
    const menuText = (await menu.innerText()).replace(/\s+/g, " ").trim();
    await page.screenshot({ path: `${SHOTS}/20-menu.png` });

    const stageRows = await menu.getByRole("menuitem").all();
    const stages = [];
    for (const row of stageRows) {
      const text = (await row.innerText()).replace(/\s+/g, " ").trim();
      // The bucket renders through `uppercase`, and innerText hands back what
      // the CSS did, so match case-insensitively and put the label back.
      const m = /^(.*?)\s+(active|on hold|completed)$/i.exec(text);
      if (m) {
        const bucket = BUCKETS.find((b) => b.toLowerCase() === m[2].toLowerCase());
        stages.push({ name: m[1], bucket, text });
      }
    }
    if (stages.length > 0) {
      ok(
        "every stage says what it counts as",
        stages.map((s) => `${s.name}=${s.bucket}`).join(", "),
      );
    } else {
      bad("every stage says what it counts as", `menu reads "${menuText}"`);
    }

    /*
     * Prefer a stage whose NAME is not itself one of the three bucket words.
     * "Invoiced counts as Completed" is the case worth proving: a badge reading
     * "Completed" would pass every check below even if nothing had been
     * reconciled at all.
     */
    const distinct = (bucket) =>
      stages.find(
        (s) =>
          s.bucket === bucket && !BUCKETS.some((b) => b.toLowerCase() === s.name.toLowerCase()),
      ) ?? stages.find((s) => s.bucket === bucket);
    const done = distinct("Completed");
    const live = distinct("Active");
    if (!done || !live) {
      bad("the pipeline has both a live and a finished stage", "cannot test the roll-up");
      await page.keyboard.press("Escape");
      return;
    }

    /* --------------------------- move it to a finished stage from the header */
    const startAtLive = original !== done.name;
    const target = startAtLive ? done : live;
    await menu.getByRole("menuitem", { name: new RegExp(`^${target.name}\\b`) }).click();

    let after = "";
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(400);
      after = await chipLabel(page);
      if (after === target.name) break;
    }
    if (after === target.name) ok("one click moves the job", `"${original}" to "${target.name}"`);
    else bad("one click moves the job", `chip reads "${after}"`);

    // And the chip now states the bucket that came with it.
    const reopened = await openChipMenu(page);
    const statedBucket = (await reopened.innerText()).replace(/\s+/g, " ");
    if (new RegExp(`Counts as ${target.bucket}`, "i").test(statedBucket)) {
      ok("the chip states the bucket it rolled up to", `counts as ${target.bucket}`);
    } else {
      bad("the chip states the bucket it rolled up to", statedBucket.slice(0, 120));
    }
    await page.screenshot({ path: `${SHOTS}/30-after-move.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    /* ------------- the edit form cannot write a status against the stage */
    await page.locator('button[aria-label="Project actions"]').click();
    await page.getByRole("menuitem", { name: /Edit details/i }).click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: "Edit project" });
    await dialog.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1200);
    const statusSelect = dialog.locator("#ep-status");
    const shown = (await statusSelect.innerText().catch(() => "")).trim();
    const disabled = await statusSelect.isDisabled().catch(() => false);
    if (disabled && shown.toLowerCase() === target.bucket.toLowerCase()) {
      ok("the edit form defers to the stage", `shows "${shown}", not editable`);
    } else {
      bad(
        "the edit form defers to the stage",
        `reads "${shown}"${disabled ? "" : " and is still editable"}`,
      );
    }
    await page.screenshot({ path: `${SHOTS}/35-edit-dialog.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);

    /* ------------------------------------------------------- the map agrees */
    await page.goto(`${BASE}/map`, { waitUntil: "networkidle" });
    await page.waitForTimeout(6000);

    const rowFor = (name) =>
      page
        .locator("button")
        .filter({ hasText: name })
        .filter({ hasText: /,|-|·|\w/ })
        .first();

    const pickFilter = async (label) => {
      await page
        .getByRole("button", { name: new RegExp(label, "i") })
        .first()
        .click();
      await page.waitForTimeout(1500);
    };

    // Completed work must not be sitting on the Active filter any more. That
    // is the map half of the complaint, stated as a check.
    await pickFilter("Active");
    const onActive = await rowFor(projectName)
      .isVisible()
      .catch(() => false);
    if (target.bucket === "Completed" ? !onActive : onActive) {
      ok("the map's Active filter agrees with the stage", `${target.name} -> ${target.bucket}`);
    } else {
      bad(
        "the map's Active filter agrees with the stage",
        `${target.name} counts as ${target.bucket} but Active ${onActive ? "still lists" : "does not list"} it`,
      );
    }

    await pickFilter(target.bucket === "Completed" ? "Completed" : "Active");
    const listed = rowFor(projectName);
    if (await listed.isVisible().catch(() => false)) {
      const badge = (await listed.innerText()).replace(/\s+/g, " ");
      if (badge.includes(target.name)) {
        ok("the map names the pin the way the project page does", `"${target.name}"`);
      } else {
        bad("the map names the pin the way the project page does", badge.slice(0, 120));
      }
    } else {
      bad("the map lists the project under its bucket", `${target.bucket} filter is empty of it`);
    }
    await page.screenshot({ path: `${SHOTS}/40-map.png` });

    /* ----------------------------------------------- the project list agrees */
    await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
    await page.waitForTimeout(4500);
    const card = page.locator(`a[href="${new URL(projectUrl).pathname}"]`).first();
    const cardText = await card
      .evaluateHandle((el) => el.closest("div.group") ?? el.parentElement)
      .then((h) => h.evaluate((el) => el.innerText))
      .catch(() => "");
    // The badge renders through `uppercase`, so compare on a folded copy.
    const flat = cardText.replace(/\s+/g, " ").trim();
    const folded = flat.toLowerCase();
    if (folded.includes(target.name.toLowerCase())) {
      const dupes = BUCKETS.filter(
        (b) =>
          b.toLowerCase() !== target.name.toLowerCase() && new RegExp(`\\b${b}\\b`, "i").test(flat),
      );
      if (dupes.length === 0) ok("the card carries the stage and no second badge");
      else bad("the card carries the stage and no second badge", `also shows ${dupes.join(", ")}`);
    } else {
      bad("the card carries the stage", flat.slice(0, 140));
    }
    await page.screenshot({ path: `${SHOTS}/50-projects-list.png` });

    /* ------------------------------ the mapping is a field a team can edit */
    await page
      .getByRole("button", { name: /Pipelines/i })
      .first()
      .click();
    await page.waitForTimeout(2500);
    await page
      .getByRole("button", { name: /^Manage/i })
      .first()
      .click();
    const sheet = page.locator('[role="dialog"]').last();
    await sheet.waitFor({ state: "visible", timeout: 15000 });
    await page.waitForTimeout(1500);
    const buckets = sheet.locator('[aria-label^="What "]');
    const count = await buckets.count();
    if (count > 0) {
      const first = (await buckets.first().innerText()).replace(/\s+/g, " ").trim();
      ok(
        "a stage's bucket is editable where the stage is",
        `${count} rows, first reads "${first}"`,
      );
    } else {
      bad("a stage's bucket is editable where the stage is", "no picker on the stage rows");
    }
    await page.screenshot({ path: `${SHOTS}/60-stage-editor.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  } catch (e) {
    bad("run", e?.message ?? String(e));
  } finally {
    if (original && projectUrl) {
      try {
        await page.goto(projectUrl, { waitUntil: "networkidle" });
        await page.waitForTimeout(3500);
        if ((await chipLabel(page)) !== original) {
          const menu = await openChipMenu(page);
          await menu
            .getByRole("menuitem", { name: new RegExp(`^${original}\\b`) })
            .click()
            .catch(() => {});
          await page.waitForTimeout(2500);
        }
        console.log(`restored to "${original}"`);
      } catch (e) {
        console.log(`COULD NOT RESTORE to "${original}": ${e?.message ?? e}`);
      }
    }
    await browser.close();
    for (const r of results) {
      console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.n}${r.d ? `  (${r.d})` : ""}`);
    }
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exit(failed.length ? 1 : 0);
  }
};

main();
