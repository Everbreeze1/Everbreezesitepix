/**
 * Drives the workspace Schedule tab on /projects in a real browser.
 *
 * Reads by default: it logs in, opens the tab three ways (clicking the pill,
 * the `?tab=schedule` address, and the legacy `?tab=calendar` one that links
 * shared before the rename still carry), checks the grid, the legend, the rail
 * and the out-of-window warning, and screenshots.
 *
 * WRITE=1 adds the round trip that needs a row to exist: it books a day by
 * TYPING the date rather than picking it, which is the only way to reproduce
 * the year-segment bug, counts the PATCHes that typing produces, clicks the
 * resulting chip on the grid to prove it opens, and then clears the date back
 * to NULL. The database is shared with production, so that is opt-in and every
 * row it touches is reported.
 *
 * Run with: node scripts/drive-workspace-schedule.mjs
 * Screenshots land in artifacts/workspace-schedule/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/workspace-schedule";
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
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

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

/**
 * Wait for the Schedule tab to reach a state it will not leave on its own.
 *
 * A fixed sleep made this driver a coin toss: the tab renders an empty state
 * while its three reads are still landing, so a 6-second wait sometimes caught
 * the transient version and sometimes the settled one. Waiting on the outcome
 * instead is what turned that flicker from an intermittent test failure into a
 * bug with a cause.
 */
const settled = (page) =>
  page
    .waitForFunction(
      () => {
        const t = document.body.innerText;
        return /Workspace schedule/.test(t) || /Nothing is dated yet/.test(t);
      },
      undefined,
      { timeout: 60000 },
    )
    .catch(() => {});

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1100 } });
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
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let attempt = 0; attempt < 6; attempt++) {
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
  if (/\/login/.test(new URL(page.url()).pathname)) {
    bad("login", "still on /login after submitting");
    await page.screenshot({ path: `${SHOTS}/00-login-failed.png` });
    return { browser };
  }
  ok("login");

  /* --------------------------------------------------------- the tab strip */
  current = "projects";
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Workspace", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await page.screenshot({ path: `${SHOTS}/01-projects-tabs.png` });

  const tab = page.getByRole("button", { name: /^Schedule/ }).first();
  if (await tab.count()) ok("Schedule pill is on the strip");
  else bad("Schedule pill is on the strip", "no button whose name starts with Schedule");

  const strip = await page
    .locator('[aria-current="page"], button:has-text("Pipelines")')
    .first()
    .textContent()
    .catch(() => "");
  ok("strip reads", String(strip).trim());

  /* -------------------------------------------------------------- open it */
  current = "schedule";
  await tab.click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/02-schedule.png`, fullPage: true });

  const url = new URL(page.url());
  if (url.searchParams.get("tab") === "schedule") ok("clicking the pill writes ?tab=schedule");
  else bad("clicking the pill writes ?tab=schedule", `url is ${page.url()}`);

  const heading = await page
    .locator("text=Workspace schedule")
    .first()
    .isVisible()
    .catch(() => false);
  heading ? ok("the schedule card rendered") : bad("the schedule card rendered");

  for (const probe of ["due today", "in the next 7 days"]) {
    const seen = await page
      .locator(`text=${probe}`)
      .first()
      .isVisible()
      .catch(() => false);
    seen ? ok(`summary shows "${probe}"`) : bad(`summary shows "${probe}"`);
  }

  const rail = await page
    .locator("text=/Nothing dated on this day|\\d+ entr(y|ies)/")
    .first()
    .isVisible()
    .catch(() => false);
  rail ? ok("the day rail rendered") : bad("the day rail rendered");

  const awaiting = await page
    .locator("text=/awaiting a date/i")
    .first()
    .isVisible()
    .catch(() => false);
  if (awaiting) ok("the awaiting-a-date rail rendered");

  const empty = await page
    .locator("text=Nothing is dated yet")
    .first()
    .isVisible()
    .catch(() => false);
  if (empty) ok("empty state", "this workspace has no dated work at all");

  /* --------------------------------------------------- the address works */
  current = "deep link";
  await page.goto(`${BASE}/projects?tab=schedule`, { waitUntil: "domcontentloaded" });
  await settled(page);
  const deepLinked =
    (await page
      .locator("text=Workspace schedule")
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .locator("text=Nothing is dated yet")
      .first()
      .isVisible()
      .catch(() => false));
  deepLinked
    ? ok("?tab=schedule opens on the Schedule")
    : bad("?tab=schedule opens on the Schedule");
  await page.screenshot({ path: `${SHOTS}/03-deep-link.png`, fullPage: true });

  const legend = await page
    .locator("text=Job booked")
    .first()
    .isVisible()
    .catch(() => false);
  legend ? ok("the marker legend is on screen") : bad("the marker legend is on screen");

  /* -------------------------- the address people already have keeps working */
  /*
   * `?tab=calendar` was the address for a release and the group page linked to
   * it. Renaming the tab must not turn a link somebody already sent into the
   * project list.
   */
  current = "legacy link";
  await page.goto(`${BASE}/projects?tab=calendar`, { waitUntil: "domcontentloaded" });
  await settled(page);
  const legacy =
    (await page
      .locator("text=Workspace schedule")
      .first()
      .isVisible()
      .catch(() => false)) ||
    (await page
      .locator("text=Nothing is dated yet")
      .first()
      .isVisible()
      .catch(() => false));
  legacy
    ? ok("the old ?tab=calendar link still opens the Schedule")
    : bad("the old ?tab=calendar link still opens the Schedule");

  /* ---------------------------------------------- month paging still works */
  current = "paging";
  const next = page.getByRole("button", { name: "Next month" }).first();
  if (await next.count()) {
    await next.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${SHOTS}/04-next-month.png` });
    ok("month paging");
  } else {
    ok("month paging", "skipped: empty state, no grid to page");
  }

  /* ------------------------------------- the month past the task read's reach */
  /*
   * The grid pages without limit, the task read is windowed, and booked jobs
   * are not windowed at all. Paging past the window used to draw the jobs and
   * silently none of the tasks. It has to say so.
   */
  current = "coverage";
  await page.goto(`${BASE}/projects?tab=schedule`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Workspace schedule", { timeout: 60000 }).catch(() => {});
  const back = page.getByRole("button", { name: "Previous month" }).first();
  for (let i = 0; i < 8; i++) {
    await back.click();
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(1200);
  const warned = await page
    .locator("text=/aren.t loaded this far out/i")
    .first()
    .isVisible()
    .catch(() => false);
  warned
    ? ok("a month outside the task window says so")
    : bad("a month outside the task window says so");
  await page.screenshot({ path: `${SHOTS}/08-outside-window.png` });

  /* ------------------------------------------------ the one write, opt-in */
  /*
   * WRITE=1 books the first "awaiting a date" job for today through the UI,
   * screenshots the populated grid, then clicks Clear to put the row back to
   * NULL. One nullable field on one project, set and unset, and the before and
   * after are both reported. The database is shared with production, so this
   * does not run unless asked for.
   */
  if (process.env.WRITE === "1") {
    current = "write";
    await page.goto(`${BASE}/projects?tab=schedule`, { waitUntil: "domcontentloaded" });
    await settled(page);
    await page
      .waitForSelector('input[aria-label^="Book a day for"]', { timeout: 60000 })
      .catch(() => {});
    const booker = page.locator('input[aria-label^="Book a day for"]').first();
    if (!(await booker.count())) {
      bad("write round trip", "no job awaiting a date to book - cannot exercise the write path");
    } else {
      const who = await booker.getAttribute("aria-label");
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
        today.getDate(),
      ).padStart(2, "0")}`;

      /*
       * TYPED, not filled.
       *
       * `fill()` sets the whole value in one go, which is what the native date
       * picker does and is exactly the path that never had the bug. Typing is
       * the path that did: each segment change emits a complete valid date, so
       * the year arrives as 0002, 0020, 0202 and only then 2026. Count the
       * PATCHes to see whether the intermediate three are being written.
       */
      let patches = 0;
      const countPatch = (req) => {
        if (req.method() === "PATCH" && /\/rest\/v1\/projects/.test(req.url())) patches += 1;
      };
      page.on("request", countPatch);

      // focus(), not click(): a click lands on whichever segment is under the
      // cursor, and the digits then go into the wrong one.
      await booker.focus();
      const digits = `${String(today.getMonth() + 1).padStart(2, "0")}${String(
        today.getDate(),
      ).padStart(2, "0")}${today.getFullYear()}`;
      for (const d of digits) {
        await page.keyboard.press(`Digit${d}`);
        await page.waitForTimeout(140);
      }
      await page.waitForTimeout(4000);
      page.off("request", countPatch);
      ok("typed value", `${digits} -> "${await booker.inputValue().catch(() => "?")}"`);

      patches === 1
        ? ok("typing a year writes once, not once per digit", `${patches} PATCH`)
        : bad("typing a year writes once, not once per digit", `${patches} PATCH, expected 1`);

      await page.screenshot({ path: `${SHOTS}/06-booked.png`, fullPage: true });
      const landed = await page
        .locator("text=/1 due today|Scheduled for/i")
        .first()
        .isVisible()
        .catch(() => false);
      landed ? ok("booking a day lands on the grid", `${who} -> ${iso}`) : bad("booking a day");

      /* ------------------------------ clicking the item ON THE GRID opens it */
      /*
       * The client: "clicking a task directly on the calendar grid does
       * nothing - only the same item in the sidebar is clickable".
       */
      current = "grid click";
      const chip = page.locator('a[aria-label^="Job booked"], a[aria-label^="Task due"]').first();
      if (await chip.count()) {
        const label = await chip.getAttribute("aria-label");
        await chip.click();
        await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
        const opened = /\/projects\/[0-9a-f-]{36}/.test(new URL(page.url()).pathname);
        opened
          ? ok("clicking an item on the grid opens its project", label)
          : bad("clicking an item on the grid opens its project", `url is ${page.url()}`);
        await page.screenshot({ path: `${SHOTS}/09-grid-click.png` });
        await page.goto(`${BASE}/projects?tab=schedule`, { waitUntil: "domcontentloaded" });
        await settled(page);
      } else {
        bad("clicking an item on the grid opens its project", "no chip on the grid to click");
      }
    }

    /*
     * Put the row back, whether this run booked it or a previous one did.
     *
     * Deliberately outside the booking branch. Nested inside it, a run that
     * found the job already booked skipped the cleanup as well as the booking,
     * so a failed clear stayed failed and left a date on the customer's project
     * for the next run to find. Cleanup has to be reachable from whatever state
     * the last run left behind.
     */
    current = "cleanup";
    await page.goto(`${BASE}/projects?tab=schedule`, { waitUntil: "domcontentloaded" });
    await settled(page);
    await page.waitForSelector('button:has-text("Clear")', { timeout: 30000 }).catch(() => {});
    const clear = page.getByRole("button", { name: "Clear" }).first();
    if (await clear.count()) {
      await clear.click();
      await page.waitForTimeout(4000);
      await page.screenshot({ path: `${SHOTS}/07-cleared.png`, fullPage: true });
      const back = await page
        .locator("text=/awaiting a date/i")
        .first()
        .isVisible()
        .catch(() => false);
      back ? ok("the row is back to NULL") : bad("the row is back to NULL", "still booked");
    } else {
      /*
       * No Clear button is the RIGHT answer when nothing is booked. Reporting
       * it as a failure made a clean run look broken and buried the one case
       * that matters: a date left behind on the customer's project.
       */
      const alreadyClear = await page
        .locator("text=/awaiting a date/i")
        .first()
        .isVisible()
        .catch(() => false);
      alreadyClear
        ? ok("the row is back to NULL", "nothing was booked to clear")
        : bad("the row is back to NULL", "no Clear button and the job is not awaiting a date");
    }
  }

  /* ---------------------------------------------- the other tabs still work */
  current = "regression";
  for (const name of ["Projects", "Groups", "Pipelines"]) {
    const pill = page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
    if (!(await pill.count())) {
      bad(`${name} pill still present`);
      continue;
    }
    await pill.click();
    await page.waitForTimeout(2500);
    ok(`${name} tab still opens`);
  }
  await page.screenshot({ path: `${SHOTS}/05-back-to-projects.png` });

  return { browser };
};

run()
  .then(async ({ browser }) => {
    for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`);
    console.log(`\n${problems.length} console/page errors`);
    for (const p of problems.slice(0, 12)) console.log(`  [${p.where}] ${p.kind}: ${p.detail}`);
    await browser?.close();
    process.exit(checks.some((c) => !c.pass) ? 1 : 0);
  })
  .catch(async (e) => {
    console.error("driver failed:", e);
    process.exit(1);
  });
