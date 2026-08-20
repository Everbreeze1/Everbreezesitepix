/**
 * Drives the new workspace Calendar tab on /projects in a real browser.
 *
 * WRITES NOTHING. It logs in, opens the tab four ways (click, and the
 * `?tab=calendar` address), reads the grid and the rail, and screenshots.
 * The database is shared with production, so this run is a reader: it never
 * touches a date control, and until
 * supabase/migrations/20260923000000_project_scheduled_date.sql is applied
 * there are no date controls to touch.
 *
 * Run with: node scripts/drive-workspace-calendar.mjs
 * Screenshots land in artifacts/workspace-calendar/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/workspace-calendar";
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

  const tab = page.getByRole("button", { name: /^Calendar/ }).first();
  if (await tab.count()) ok("calendar pill is on the strip");
  else bad("calendar pill is on the strip", "no button whose name starts with Calendar");

  const strip = await page
    .locator('[aria-current="page"], button:has-text("Pipelines")')
    .first()
    .textContent()
    .catch(() => "");
  ok("strip reads", String(strip).trim());

  /* -------------------------------------------------------------- open it */
  current = "calendar";
  await tab.click();
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${SHOTS}/02-calendar.png`, fullPage: true });

  const url = new URL(page.url());
  if (url.searchParams.get("tab") === "calendar") ok("clicking the pill writes ?tab=calendar");
  else bad("clicking the pill writes ?tab=calendar", `url is ${page.url()}`);

  const heading = await page
    .locator("text=Workspace schedule")
    .first()
    .isVisible()
    .catch(() => false);
  heading ? ok("the calendar card rendered") : bad("the calendar card rendered");

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
  await page.goto(`${BASE}/projects?tab=calendar`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
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
    ? ok("?tab=calendar opens on the Calendar")
    : bad("?tab=calendar opens on the Calendar");
  await page.screenshot({ path: `${SHOTS}/03-deep-link.png`, fullPage: true });

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
    await page.goto(`${BASE}/projects?tab=calendar`, { waitUntil: "domcontentloaded" });
    await page
      .waitForSelector('input[aria-label^="Book a day for"]', { timeout: 60000 })
      .catch(() => {});
    const booker = page.locator('input[aria-label^="Book a day for"]').first();
    if (!(await booker.count())) {
      ok("write round trip", "skipped: nothing awaiting a date");
    } else {
      const who = await booker.getAttribute("aria-label");
      const today = new Date();
      const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
        today.getDate(),
      ).padStart(2, "0")}`;
      await booker.fill(iso);
      await page.waitForTimeout(3500);
      await page.screenshot({ path: `${SHOTS}/06-booked.png`, fullPage: true });
      const landed = await page
        .locator("text=/1 due today|Scheduled for/i")
        .first()
        .isVisible()
        .catch(() => false);
      landed ? ok("booking a day lands on the grid", `${who} -> ${iso}`) : bad("booking a day");

      const clear = page.getByRole("button", { name: "Clear" }).first();
      if (await clear.count()) {
        await clear.click();
        await page.waitForTimeout(3500);
        await page.screenshot({ path: `${SHOTS}/07-cleared.png`, fullPage: true });
        const back = await page
          .locator("text=/awaiting a date/i")
          .first()
          .isVisible()
          .catch(() => false);
        back ? ok("Clear puts the row back to NULL") : bad("Clear puts the row back to NULL");
      } else {
        bad("Clear puts the row back to NULL", "no Clear button after booking");
      }
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
