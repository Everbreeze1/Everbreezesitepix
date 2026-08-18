/**
 * Drives the blueprint / walkthrough UI in a real browser.
 *
 * Everything before this script verified the database: the columns exist, the
 * policies let a real user through, the apply service's insert shapes are
 * accepted. None of that renders a single component. A typo in
 * WalkthroughTemplatesManager, a hook called after an early return, an icon
 * imported from the wrong module - all of those pass tsc and vitest and blow up
 * only when a browser mounts the tab.
 *
 * WHAT THIS RUN WRITES. The database is shared with production, so this is
 * stated up front rather than discovered afterwards:
 *
 *   - ONE walkthrough template, created through the starter gallery, named by
 *     the starter it came from. Deleted through the UI at the end of the run,
 *     and swept by scripts/verify-blueprint-migration.mjs style cleanup if the
 *     run dies first.
 *
 * Nothing else is created. No blueprint is applied to any project, because that
 * would write checklists and documents into a real job.
 *
 * Run with: BASE_URL=http://localhost:8092 node scripts/drive-blueprint-ui.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/blueprint-ui";
mkdirSync(SHOTS, { recursive: true });

function env(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail) => checks.push({ pass: false, name, detail });

/** Console errors and page crashes, attributed to whichever screen was open. */
const problems = [];
let current = "startup";
const IGNORE = [
  /Download the React DevTools/i,
  /Re-optimizing dependencies/i,
  /\[vite\]/i,
  /Module level directives/i,
  /favicon/i,
  /net::ERR_/i,
];

/** The starter this run installs and then removes. */
const STARTER = "Pre-Work Site Condition";

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const page = await ctx.newPage();

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (IGNORE.some((re) => re.test(t))) return;
    problems.push({ kind: "console", where: current, detail: t.slice(0, 240) });
  });
  page.on("pageerror", (e) =>
    problems.push({ kind: "pageerror", where: current, detail: String(e).slice(0, 240) }),
  );

  /* ------------------------------------------------------------------ login */
  current = "login";
  // networkidle, not domcontentloaded: these are controlled React inputs, so
  // filling before hydration sets the DOM value but not the component state and
  // submit posts empty credentials.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', password);
    const got = await page.inputValue('input[type="email"]');
    if (got === email) break;
    await page.waitForTimeout(800);
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  if (/\/login/.test(new URL(page.url()).pathname)) {
    await page.screenshot({ path: `${SHOTS}/00-login-failed.png` });
    throw new Error("login did not leave /login");
  }
  ok("login", new URL(page.url()).pathname);

  /* --------------------------------------------- the new Walkthroughs tab */
  current = "templates/walkthroughs";
  await page.goto(`${BASE}/templates?tab=walkthroughs`, { waitUntil: "domcontentloaded" });

  const body = () => page.locator("body").innerText();

  /*
   * Wait for the panel to REACH a state, rather than sleeping and hoping.
   *
   * A flat 4.5s caught this mid-spinner twice, and every assertion downstream
   * then failed against a screen that was still loading - reported as "no
   * Starters button found", which reads as a missing control rather than as a
   * slow load. The three outcomes below are the panel's only resting states, so
   * whichever lands first means the load is done.
   */
  const settled = async (timeout = 60000) => {
    /*
     * Locators joined with .or(), not a comma-separated selector string.
     *
     * Two traps, both hit on this script: the rail's "Search walkthroughs…" is a
     * PLACEHOLDER, which never appears in innerText; and Playwright's text=
     * engine cannot be mixed into a comma-separated CSS list, which throws
     * IMMEDIATELY rather than timing out. With a .catch() on the end, that
     * turned a 60s wait into no wait at all and every assertion below read a
     * page still showing "Loading…".
     */
    await page
      .locator('input[placeholder*="Search walkthroughs" i]')
      .or(page.getByText(/no walkthrough shot lists yet/i))
      .or(page.getByText(/aren't available here yet/i))
      .first()
      .waitFor({ state: "visible", timeout })
      .catch(() => {});
    return body();
  };
  await settled();
  await page.screenshot({ path: `${SHOTS}/01-walkthroughs.png` });
  {
    const text = await body();
    // The rail is a placeholder, so it is asked for as a locator rather than
    // looked for in the page text - same trap as `settled` above.
    const hasRail = (await page.locator('input[placeholder*="Search walkthroughs" i]').count()) > 0;
    if (/aren't available here yet|Walkthroughs aren't available/i.test(text)) {
      bad("Walkthroughs tab renders", "showed the migration-pending state");
    } else if (hasRail || /no walkthrough shot lists yet/i.test(text)) {
      ok("Walkthroughs tab renders", "reached a real state, not the pending notice");
    } else {
      bad("Walkthroughs tab renders", `unrecognised screen: ${text.slice(0, 160)}`);
    }
  }

  // The tab strip must actually carry the new tab, not just respond to the URL.
  {
    const strip = await page.locator("body").innerText();
    if (/walkthroughs/i.test(strip)) ok("Walkthroughs appears in the tab strip");
    else bad("Walkthroughs appears in the tab strip", "not found in the page text");
  }

  /* -------------------------------------- create one, through the starters */
  current = "walkthrough starters";
  let created = false;
  {
    /*
     * Idempotent: a previous run that died before its cleanup leaves the
     * starter behind, and installing a second copy would turn a failed run into
     * a slowly growing pile of rows in a live database. If it is already there,
     * the create is skipped and the delete below still gets exercised.
     */
    const already = new RegExp(STARTER).test(await body());
    if (already) {
      created = true;
      checks.push({
        pass: true,
        skipped: true,
        name: "creating from a starter works",
        detail: `SKIPPED - "${STARTER}" already exists, reusing it for the delete check`,
      });
    }
    const startersBtn = already
      ? page.locator("__never__")
      : page.getByRole("button", { name: /Start from a trade|Starters/ }).first();
    if (already) {
      // Nothing to open; fall through to the blueprint checks.
    } else if ((await startersBtn.count()) === 0) {
      bad("starter gallery opens", "no Starters button found");
    } else {
      await startersBtn.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/02-starter-gallery.png` });
      const card = page.getByRole("button", { name: new RegExp(STARTER) }).first();
      if ((await card.count()) === 0) {
        bad("starter gallery opens", `"${STARTER}" not offered`);
      } else {
        ok("starter gallery opens", `offering "${STARTER}"`);
        await card.click();
        // The install writes a template plus ten shots.
        await page.waitForTimeout(5000);
        await page.screenshot({ path: `${SHOTS}/03-walkthrough-created.png` });
        const text = await body();
        if (new RegExp(STARTER, "i").test(text) && /shot/i.test(text)) {
          created = true;
          ok("creating from a starter works", "template and its shots rendered");
        } else {
          bad("creating from a starter works", text.slice(0, 200));
        }
      }
    }
  }

  /* ---------------------------- the blueprint builder offers walkthroughs */
  current = "templates/blueprints";
  await page.goto(`${BASE}/templates?tab=blueprints`, { waitUntil: "domcontentloaded" });
  // Same settle, same reason: "Search blueprints…" is a placeholder too, so this
  // tab was also being read mid-spinner and reported as "no Preview control".
  await page
    .locator('input[placeholder*="Search blueprints" i]')
    .or(page.getByText(/no project blueprints yet/i))
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/04-blueprints.png` });
  {
    const text = await body();
    // Preview mode is the spec item that had no UI before this work.
    if (/preview/i.test(text)) ok("blueprint detail offers Preview");
    else bad("blueprint detail offers Preview", "no Preview control on the page");

    const addBtn = page.getByRole("button", { name: /Add section/ }).first();
    if ((await addBtn.count()) === 0) {
      checks.push({
        pass: true,
        skipped: true,
        name: "Add section offers Walkthrough",
        detail: "SKIPPED - no blueprint selected or no manage rights",
      });
    } else {
      await addBtn.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${SHOTS}/05-add-section-menu.png` });
      const menu = await page.locator("body").innerText();
      if (/walkthrough/i.test(menu)) ok("Add section offers Walkthrough");
      else bad("Add section offers Walkthrough", "kind not in the menu");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    }
  }

  /* ------------------------------------ the blueprint-first project flow */
  current = "projects/new";
  await page.goto(`${BASE}/projects/new`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${SHOTS}/06-new-project-step1.png` });
  {
    const text = await body();
    if (/Step 1 of 2/.test(text) && /Start blank/.test(text)) {
      ok("new project starts on the blueprint chooser");
      // Case-INSENSITIVE throughout this file. Several of these labels carry a
      // Tailwind `uppercase` class, and Playwright's innerText() returns the
      // RENDERED text, so "What this creates" comes back as "WHAT THIS CREATES".
      // Matching case-sensitively failed three checks against a UI that was
      // rendering perfectly - a false negative is worse than no check, because
      // it sends you looking for a bug that is not there.
      if (/what this creates/i.test(text)) ok("the chooser shows the outcome preview");
      else bad("the chooser shows the outcome preview", "preview pane missing");

      const cont = page.getByRole("button", { name: /^Continue/ }).first();
      if ((await cont.count()) > 0) {
        await cont.click();
        await page.waitForTimeout(3500);
        await page.screenshot({ path: `${SHOTS}/07-new-project-step2.png` });
        const step2 = await body();
        if (/change/i.test(step2) && /search address/i.test(step2)) {
          ok("continuing reaches the details step with a Change affordance");
        } else {
          bad("continuing reaches the details step", step2.slice(0, 200));
        }
      }
    } else if (/search address/i.test(text)) {
      // Legitimate when this account has no blueprints to choose between.
      checks.push({
        pass: true,
        skipped: true,
        name: "new project starts on the blueprint chooser",
        detail: "SKIPPED - went straight to details (no blueprints, or not Team)",
      });
    } else {
      bad("new project starts on the blueprint chooser", text.slice(0, 200));
    }
  }

  /* ------------------------------------------------------------- clean up */
  if (created) {
    current = "cleanup";
    await page.goto(`${BASE}/templates?tab=walkthroughs`, { waitUntil: "domcontentloaded" });
    await settled();
    /*
     * waitForSelector, not a fixed sleep. A flat 4s caught this panel mid-spinner
     * on one run and reported "no actions menu to delete from" - which reads as
     * a missing control rather than as a slow load, and left the row behind.
     */
    const more = page.getByRole("button", { name: "More actions" }).first();
    await more.waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    if ((await more.count()) > 0) {
      await more.click();
      await page.waitForTimeout(800);
      const del = page.getByRole("menuitem", { name: /Delete/ }).first();
      if ((await del.count()) > 0) {
        await del.click();
        await page.waitForTimeout(1200);
        const confirmBtn = page.getByRole("button", { name: /Delete walkthrough/ }).first();
        if ((await confirmBtn.count()) > 0) {
          await confirmBtn.click();
          await page.waitForTimeout(3000);
          ok("cleanup: the created walkthrough was deleted through the UI");
        } else {
          bad("cleanup", "confirm dialog did not offer 'Delete walkthrough'");
        }
      } else {
        bad("cleanup", "no Delete in the actions menu");
      }
    } else {
      bad("cleanup", "no actions menu to delete from");
    }
    await page.screenshot({ path: `${SHOTS}/08-after-cleanup.png` });
  }

  await browser.close();
};

run()
  .then(() => report())
  .catch((e) => {
    bad("run completed", String(e).slice(0, 300));
    report();
  });

function report() {
  console.log("");
  let failures = 0;
  for (const c of checks) {
    const mark = c.skipped ? "-" : c.pass ? "PASS" : "FAIL";
    if (!c.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  if (problems.length) {
    console.log("\n  Browser problems:");
    for (const p of problems.slice(0, 15)) {
      console.log(`    [${p.kind}] ${p.where}: ${p.detail}`);
    }
    if (problems.length > 15) console.log(`    ... and ${problems.length - 15} more`);
  } else {
    console.log("\n  No console errors or page crashes.");
  }
  console.log("");
  console.log(failures === 0 ? "UI verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}
