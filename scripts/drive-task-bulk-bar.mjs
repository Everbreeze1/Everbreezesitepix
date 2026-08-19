/**
 * Drives the bulk action bar on the Tasks panel in a real browser.
 *
 * tests/task-bulk-bar.test.ts pins the SOURCE of the three fixes the review
 * asked for. None of it mounts a component, and all three complaints were about
 * what the thing does when a person uses it:
 *
 *   "i click drop down to choose assigned to ... it doesn't show who its
 *    assigned to."
 *   "after picking assignee the drop down window disappears, doesnt allow me to
 *    put date or priority, i have to click back at it."
 *   "there is a list view and a table view, the table view is not showing the
 *    task assignment flow."
 *
 * A grep can prove `clearSelection()` is gone. Only a browser can prove the bar
 * is still on screen after the assignment lands, that the trigger re-reads the
 * new value, and that a Radix Select bound to "__mixed__" does not blank
 * itself.
 *
 * WHAT THIS RUN WRITES. The database is shared with production, so it is stated
 * up front rather than discovered afterwards:
 *
 *   - TWO tasks in the first project it can open, both titled
 *     "QA bulk bar <timestamp>". Both are deleted through the bar's own Delete
 *     at the end of the run, which is also the last assertion.
 *   - The only assignee it ever picks is THE ACCOUNT BEING DRIVEN. Assigning
 *     work to yourself is not a notification (`create_notification` drops a row
 *     whose recipient is the actor), so no bell rings and NO EMAIL IS SENT to
 *     anybody. The "Mixed" state is made from one task assigned to self and one
 *     left unassigned, for the same reason: a real teammate must not be mailed
 *     a QA task.
 *
 * No existing task is touched. Every assertion is made against the two tasks
 * this script created, matched by the run's own title.
 *
 * Run with: node scripts/drive-task-bulk-bar.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/task-bulk-bar";
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

const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const TITLE_A = `QA bulk bar ${STAMP} A`;
const TITLE_B = `QA bulk bar ${STAMP} B`;
const PROJECT_HREF = /^\/projects\/[0-9a-f]{8}-[0-9a-f-]{27}$/;

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
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

  /**
   * The bulk bar.
   *
   * Anchored on the "N selected" counter, which is the one string only this bar
   * renders, and then walked up one level to the bar itself. Filtering a `div`
   * by that text does NOT work: Playwright's `hasText` matches an element's
   * whole text content, and the bar's includes every control's label.
   */
  const counter = page.getByText(/^\d+ selected$/).first();
  const bulkBar = counter.locator("xpath=..");
  /*
   * Scoped INSIDE the bar. The panel header carries a status-filter Select that
   * is also `role="combobox"` and comes first in the DOM, so an unscoped
   * `.first()` drives the filter and silently reports on the wrong control.
   */
  const assignTrigger = () => bulkBar.locator('button[role="combobox"]').first();
  const priorityTrigger = () => bulkBar.locator('button[role="combobox"]').nth(1);

  /* ------------------------------------------------------------------ login */
  current = "login";
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.fill('input[type="email"]', "");
    await page.fill('input[type="password"]', "");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 12 });
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 12 });
    // Re-read after a pause: hydration landing late re-renders these back empty.
    await page.waitForTimeout(2000);
    if ((await page.inputValue('input[type="email"]')) === email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  if (/\/login/.test(new URL(page.url()).pathname)) {
    await page.screenshot({ path: `${SHOTS}/00-login-failed.png` });
    throw new Error("login did not leave /login");
  }
  ok("login", new URL(page.url()).pathname);

  /* ------------------------------------------------- find a usable project */
  current = "projects";
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  // By href SHAPE, not prefix: the sidebar ships /projects/trash immediately,
  // so a prefix match is satisfied before the list has fetched anything.
  await page
    .waitForFunction(
      (pattern) =>
        Array.from(document.querySelectorAll('a[href^="/projects/"]')).some((a) =>
          new RegExp(pattern).test(a.getAttribute("href") ?? ""),
        ),
      PROJECT_HREF.source,
      { timeout: 90000 },
    )
    .catch(() => {});
  const hrefs = await page
    .locator('a[href^="/projects/"]')
    .evaluateAll(
      (els, pattern) =>
        Array.from(new Set(els.map((e) => e.getAttribute("href")))).filter((h) =>
          new RegExp(pattern).test(h ?? ""),
        ),
      PROJECT_HREF.source,
    );
  if (hrefs.length === 0) throw new Error("no projects to drive");

  current = "tasks panel";
  await page.goto(`${BASE}${hrefs[0]}?panel=tasks`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Add task" })
    .waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(2500);
  ok("tasks panel open", hrefs[0]);

  const quickAdd = page.getByPlaceholder(/Add a task and press Enter/i);

  /** Create one task through the inline quick-add. */
  const addTask = async (title) => {
    await quickAdd.click();
    await quickAdd.fill(title);
    await quickAdd.press("Enter");
    await page.getByText(title, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(800);
  };

  /** The row carrying this title, as a whole clickable row. */
  const rowFor = (title) => page.locator("li").filter({ hasText: title }).first();

  /** Tick a task's checkbox without opening it. */
  const tick = async (title) => {
    const row = rowFor(title);
    await row.hover();
    await row.locator('button[role="checkbox"]').first().click();
    await page.waitForTimeout(600);
  };

  try {
    /* ------------------------------------------------------------- set up */
    current = "create";
    await addTask(TITLE_A);
    await addTask(TITLE_B);
    ok("two tasks created");

    /* --------------------------------------- 1. the bar shows a selection */
    current = "select";
    await tick(TITLE_A);
    await tick(TITLE_B);
    await page.screenshot({ path: `${SHOTS}/05-after-tick.png`, fullPage: true });
    const barShown = await counter.isVisible().catch(() => false);
    if (!barShown) {
      await page.screenshot({ path: `${SHOTS}/10-no-bar.png`, fullPage: true });
      bad("bulk bar appears when tasks are ticked");
      return;
    }
    ok("bulk bar appears when tasks are ticked", (await counter.innerText()).split("\n")[0]);

    /* ------------------ 2. the assign trigger says who holds them already */
    current = "assign trigger";
    {
      const label = (await assignTrigger().innerText()).trim();
      // Both tasks were just created with no assignee.
      if (/unassigned/i.test(label)) ok("assign trigger reads the current value", label);
      else bad("assign trigger reads the current value", `showed "${label}", expected Unassigned`);
    }

    /* ---------- 3. THE ONE THEY REPORTED: the bar survives its own action */
    current = "assign";
    await assignTrigger().click();
    await page.waitForTimeout(600);
    // Self-assignment only. Never a teammate - that would mail a real person a
    // QA task. The account being driven is in the roster like anyone else.
    const meOption = page
      .locator('[role="option"]')
      .filter({ hasText: new RegExp(email.split("@")[0], "i") })
      .first();
    const haveMe = await meOption.isVisible().catch(() => false);
    if (!haveMe) {
      await page.keyboard.press("Escape");
      bad("could not find the driving account in the assignee list", "skipped the assign leg");
    } else {
      await meOption.click();
      await page.waitForTimeout(2500);

      const stillThere = await counter.isVisible().catch(() => false);
      await page.screenshot({ path: `${SHOTS}/20-after-assign.png`, fullPage: true });
      if (stillThere)
        ok("the bar SURVIVES assigning", await counter.innerText().then((t) => t.split("\n")[0]));
      else bad("the bar SURVIVES assigning", "it vanished - the reported bug is back");

      if (stillThere) {
        const label = (await assignTrigger().innerText()).trim();
        if (/unassigned/i.test(label))
          bad("the trigger updates to the new assignee", `still reads "${label}"`);
        else ok("the trigger updates to the new assignee", label);
      }
    }

    /* ----------------- 4. and priority is reachable without re-selecting */
    current = "priority";
    if (await counter.isVisible().catch(() => false)) {
      await priorityTrigger().click();
      await page.waitForTimeout(500);
      await page
        .locator('[role="option"]')
        .filter({ hasText: /^High$/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
      const label = (await priorityTrigger().innerText()).trim();
      if (/high/i.test(label)) ok("priority set without re-selecting", label);
      else bad("priority set without re-selecting", `trigger reads "${label}"`);
    }

    /* -------------------------------------------- 5. "Mixed" is said out loud */
    current = "mixed";
    if (await counter.isVisible().catch(() => false)) {
      // Untick B, unassign A alone, then re-tick B: one held, one not.
      await tick(TITLE_B);
      await assignTrigger().click();
      await page.waitForTimeout(500);
      // Unanchored: the option's children are an icon AND the word, so its text
      // is " Unassigned" and `/^Unassigned$/` never matches.
      await page
        .locator('[role="option"]')
        .filter({ hasText: /Unassigned/i })
        .first()
        .click();
      await page.waitForTimeout(2500);
      await tick(TITLE_B);
      const label = (await assignTrigger().innerText()).trim();
      await page.screenshot({ path: `${SHOTS}/30-mixed.png`, fullPage: true });
      if (/mixed/i.test(label)) ok("a disagreeing batch reads Mixed", label);
      else bad("a disagreeing batch reads Mixed", `reads "${label}"`);
    }

    /* ------------------------------- 6. the board view has the same flow */
    current = "board";
    await page.getByRole("button", { name: /board view/i }).click();
    await page.waitForTimeout(2000);
    const barOnBoard = await counter.isVisible().catch(() => false);
    const cardBoxes = await page.locator('button[role="checkbox"]').count();
    await page.screenshot({ path: `${SHOTS}/40-board.png`, fullPage: true });
    if (barOnBoard) ok("the bar is on the board view too");
    else bad("the bar is on the board view too", "not rendered");
    if (cardBoxes > 0) ok("board cards can be ticked", `${cardBoxes} checkbox(es)`);
    else bad("board cards can be ticked", "no checkboxes on cards");

    // The selection has to survive the view switch, which is the point of not
    // clearing on `view`.
    if (barOnBoard) {
      const count = (await counter.innerText()).match(/(\d+) selected/)?.[1];
      if (count === "2") ok("the selection survives the view switch", `${count} selected`);
      else bad("the selection survives the view switch", `reads ${count}`);
    }
    await page.getByRole("button", { name: /list view/i }).click();
    await page.waitForTimeout(1500);
  } finally {
    /* ------------------------------------------------------------- cleanup */
    current = "cleanup";
    try {
      /*
       * Close anything still open first. If a leg above threw with a Select
       * popup on screen, its overlay swallows every click below and cleanup
       * times out against a page that is otherwise fine - which is how a run
       * ends up leaving its throwaway tasks behind.
       */
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(400);
      // Through the bar's own Delete, which doubles as the last assertion:
      // bulkDelete is the one action that SHOULD clear the selection.
      if (!(await counter.isVisible().catch(() => false))) {
        await tick(TITLE_A).catch(() => {});
        await tick(TITLE_B).catch(() => {});
      }
      if (await counter.isVisible().catch(() => false)) {
        // Scoped to the bar. A row carries its own delete control too.
        await bulkBar
          .getByRole("button", { name: /^Delete$/ })
          .first()
          .click();
        await page.waitForTimeout(700);
        await page
          .locator('[role="alertdialog"] button')
          .filter({ hasText: /^Delete$/ })
          .first()
          .click();
        await page.waitForTimeout(2500);
        const gone = !(await page
          .getByText(TITLE_A, { exact: true })
          .isVisible()
          .catch(() => false));
        const barGone = !(await counter.isVisible().catch(() => false));
        if (gone) ok("cleanup: both tasks deleted");
        else bad("cleanup: both tasks deleted", "still on screen - REMOVE THEM BY HAND");
        if (barGone) ok("deleting DOES clear the selection");
        else bad("deleting DOES clear the selection", "bar still showing");
      } else {
        bad("cleanup", `could not re-select - REMOVE "${TITLE_A}" AND "${TITLE_B}" BY HAND`);
      }
    } catch (e) {
      bad("cleanup", `${String(e).slice(0, 120)} - REMOVE "QA bulk bar ${STAMP}" BY HAND`);
    }
    await browser.close();
  }
};

run()
  .catch((e) => bad("run", String(e).slice(0, 200)))
  .finally(() => {
    console.log("");
    let failures = 0;
    for (const c of checks) {
      if (!c.pass) failures++;
      console.log(
        `  ${(c.pass ? "PASS" : "FAIL").padEnd(4)}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`,
      );
    }
    if (problems.length) {
      console.log("\n  console/page errors:");
      for (const p of problems.slice(0, 10)) console.log(`    [${p.where}] ${p.detail}`);
    }
    console.log("");
    console.log(
      failures === 0 ? "Bulk bar verified in a browser." : `${failures} check(s) FAILED.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
