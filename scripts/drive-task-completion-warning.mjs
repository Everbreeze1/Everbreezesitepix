/**
 * Drives the assignee-completion warning in a real browser.
 *
 * The rule and its wording are covered by tests/assignment-rules.test.ts, and a
 * source-level guard there fails if a completion path checks permission without
 * pairing it with the confirmation. None of that mounts a component. The thing
 * only a browser can answer is whether the confirmation actually appears ON TOP
 * of the edit dialog it is raised from - an AlertDialog opened from inside an
 * open Dialog is two modals, two focus traps and two overlays at the same
 * z-index, and if the ordering were wrong the confirm would be unreachable and
 * the save would hang instead of warning.
 *
 * The sequence is the client's own, from their report:
 *   create a task assigned to someone else -> complete it from the row's
 *   progress button (warned before this change) -> open the task and complete
 *   it from the edit window (did NOT warn before this change).
 *
 * WHAT THIS RUN WRITES. The database is shared with production, so this is
 * stated up front rather than discovered afterwards:
 *
 *   - ONE task, in the first project that offers a teammate to assign to,
 *     titled "QA assignment warning <timestamp>". Deleted through the UI at the
 *     end of the run.
 *   - Possibly one extra such task per teammate tried, if the first teammate
 *     picked turns out to be the account being driven: assigning work to
 *     yourself is not an override and correctly does not warn. Each is deleted
 *     before the next is tried.
 *   - The creation-window leg cancels at the confirmation, so it writes nothing.
 *
 * No existing task is touched: every assertion is made against tasks this
 * script created, matched by the run's own title.
 *
 * Run with: node scripts/drive-task-completion-warning.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/task-warning";
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
const TITLE = `QA assignment warning ${STAMP}`;
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

  /** The confirmation, whatever raised it. */
  const alertDialog = page.locator('[role="alertdialog"]');
  const taskDialog = page.locator('[role="dialog"]').filter({ hasText: /Edit task|New task/ });
  const shown = (loc) => loc.isVisible().catch(() => false);

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
  /*
   * Waited for by href SHAPE, not by prefix. The sidebar ships /projects/trash
   * straight away, so `a[href^="/projects/"]` is satisfied before the list has
   * fetched anything and the run reports "no projects" against a page that is
   * still loading.
   */
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

  /** Open a project's Tasks panel. It is a URL parameter, not a clickable tab. */
  const openTasks = async (href) => {
    await page.goto(`${BASE}${href}?panel=tasks`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Add task" })
      .waitFor({ state: "visible", timeout: 90000 });
    await page.waitForTimeout(2000);
  };

  /*
   * The Assignee picker mounts a beat after the dialog does, once the team
   * roster resolves - so the third combobox is waited for rather than indexed
   * into immediately. Order in the dialog: Status, Priority, Assignee.
   */
  const assigneePicker = async () => {
    await page
      .waitForFunction(
        () => document.querySelectorAll("[role='dialog'] button[role='combobox']").length >= 3,
        null,
        { timeout: 30000 },
      )
      .catch(() => {});
    return taskDialog.locator("button[role='combobox']").nth(2);
  };

  const assigneeOptions = async () => {
    await page.getByRole("button", { name: "Add task" }).click();
    await taskDialog.waitFor({ state: "visible", timeout: 30000 });
    const trigger = await assigneePicker();
    if ((await trigger.count()) === 0) {
      await page.keyboard.press("Escape");
      return [];
    }
    await trigger.click();
    await page.waitForTimeout(700);
    const names = await page.locator("[role='option']").allInnerTexts();
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await page.keyboard.press("Escape");
    await taskDialog.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
    // Radix renders the avatar initials above the name inside one option.
    return names.map((n) => n.split("\n").pop().trim()).filter((n) => n && n !== "Unassigned");
  };

  let project = null;
  let members = [];
  for (const href of hrefs.slice(0, 6)) {
    await openTasks(href);
    const names = await assigneeOptions();
    if (names.length >= 1) {
      project = href;
      members = names;
      break;
    }
  }
  if (!project) throw new Error("no project offered a teammate to assign to");
  ok("project with a roster", `${project} offers: ${members.join(", ")}`);

  /* ------------------------------------------------------- the task itself */

  /*
   * One title per attempt.
   *
   * With a single shared title, a row left behind by the previous teammate was
   * the one `.first()` resolved to, so the next attempt clicked the status of a
   * task assigned to somebody else and reported no warning where none was owed.
   */
  let activeTitle = TITLE;
  const createTask = async (who, attempt) => {
    current = "create";
    activeTitle = `${TITLE} #${attempt}`;
    await page.getByRole("button", { name: "Add task" }).click();
    await taskDialog.waitFor({ state: "visible", timeout: 30000 });
    await taskDialog.locator('input[placeholder^="e.g. Fix gutter"]').fill(activeTitle);
    const assignee = await assigneePicker();
    await assignee.click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: who, exact: false }).first().click();
    await page.waitForTimeout(500);
    await taskDialog.getByRole("button", { name: "Create task" }).click();
    await taskDialog.waitFor({ state: "hidden", timeout: 30000 });
    await page.waitForTimeout(2500);
  };

  const row = () => page.locator("li").filter({ hasText: activeTitle }).first();
  const rowStatus = async () =>
    (await row()
      .locator("button[aria-label^='Status:']")
      .first()
      .getAttribute("aria-label")
      .catch(() => "")) ?? "";

  /**
   * Remove one row created by this run. Titles are matched loosely so a task
   * stranded by an earlier failed run is swept too, rather than accumulating in
   * a real project.
   */
  const deleteTask = async (match = activeTitle) => {
    current = "cleanup";
    const li = page.locator("li").filter({ hasText: match }).first();
    if ((await li.count()) === 0) return false;
    for (let attempt = 0; attempt < 3; attempt++) {
      // Any dialog still open swallows the click on the row behind it.
      if (await shown(taskDialog)) {
        await page.keyboard.press("Escape");
        await page.waitForTimeout(800);
      }
      await li.scrollIntoViewIfNeeded().catch(() => {});
      await li.hover().catch(() => {});
      await page.waitForTimeout(400);
      await li
        .getByRole("button", { name: "Delete task" })
        .click({ force: true })
        .catch(() => {});
      const raised = await alertDialog
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (!raised) continue;
      await alertDialog
        .getByRole("button", { name: /Continue|Delete/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
      return true;
    }
    await page.screenshot({ path: `${SHOTS}/99-delete-failed.png` });
    return false;
  };

  // Runs that failed part-way leave their task behind; clear them first so the
  // project does not silently collect QA rows.
  let swept = 0;
  while (await deleteTask("QA assignment warning")) swept++;
  if (swept) ok("swept tasks left by earlier runs", String(swept));

  /*
   * Which teammate is not the account being driven.
   *
   * Asked behaviourally rather than by matching names: assigning work to
   * yourself is not an override and correctly does not warn, so a run that
   * happened to pick the driver's own name would report a missing warning that
   * is not missing. The row's progress button is the path that warned BEFORE
   * this change, which makes it the honest probe - and confirming it still
   * warns is one of the things this run has to check anyway.
   */
  let assignee = null;
  for (const [i, who] of members.entries()) {
    await createTask(who, i + 1);
    current = "row button";
    const status = row().locator("button[aria-label^='Status:']").first();
    await status.click(); // open -> in progress
    await page.waitForTimeout(1500);
    await status.click(); // in progress -> done
    await page.waitForTimeout(2000);
    if (await shown(alertDialog)) {
      await page.screenshot({ path: `${SHOTS}/01-row-button-warning.png` });
      ok(
        "row progress button warns",
        (await alertDialog.innerText()).replace(/\s+/g, " ").slice(0, 160),
      );
      await alertDialog.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(1000);
      assignee = who;
      break;
    }
    // Assigned to the account being driven: no warning is owed. Clear it before
    // trying the next name, and say so if it would not go.
    if (!(await deleteTask())) bad("cleared the self-assigned probe task", activeTitle);
  }
  if (!assignee) {
    await page.screenshot({ path: `${SHOTS}/01-no-baseline.png` });
    throw new Error("no teammate produced the baseline warning - is the roster only this account?");
  }

  /* ------------------------------------ the reported hole: the edit window */
  current = "edit dialog";
  await row().click();
  await taskDialog.waitFor({ state: "visible", timeout: 30000 });
  (await shown(taskDialog.getByText("Edit task")))
    ? ok("clicking the row opens the edit window")
    : bad("clicking the row opens the edit window");

  const statusSelect = taskDialog.locator("button[role='combobox']").first();
  await statusSelect.click();
  await page.waitForTimeout(600);
  const doneOption = page.getByRole("option", { name: "Done" });
  if ((await doneOption.getAttribute("data-disabled")) !== null) {
    bad("Done is selectable here", "the option was disabled, so this path cannot be driven");
    await page.keyboard.press("Escape");
  } else {
    await doneOption.click();
    await page.waitForTimeout(800);
    const dialogText = (await taskDialog.innerText()).replace(/\s+/g, " ");
    // The inline amber line: said before the confirmation, so the choice is
    // informed rather than merely interrupted.
    /Assigned to .*record you as the one who closed it/i.test(dialogText)
      ? ok(
          "edit window warns inline once Done is picked",
          dialogText.match(/Assigned to [^.]*\./)?.[0] ?? "",
        )
      : bad("edit window warns inline once Done is picked", dialogText.slice(0, 200));
    await page.screenshot({ path: `${SHOTS}/02-edit-inline-warning.png` });

    await taskDialog.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(2000);

    if (!(await shown(alertDialog))) {
      bad("edit window warns on save", "no confirmation was raised - this is the reported bug");
      await page.screenshot({ path: `${SHOTS}/03-no-warning.png` });
    } else {
      ok(
        "edit window warns on save",
        (await alertDialog.innerText()).replace(/\s+/g, " ").slice(0, 160),
      );
      await page.screenshot({ path: `${SHOTS}/03-edit-save-warning.png` });

      /*
       * The whole reason for driving a browser: two modals at once. If the
       * confirmation were painted under the dialog that raised it, its buttons
       * would not be hittable and the save would hang instead of warning.
       */
      const stacked = await alertDialog.evaluate((el) => {
        const box = el.getBoundingClientRect();
        const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 20);
        return el.contains(hit);
      });
      stacked
        ? ok("confirmation sits above the edit dialog", "hit test lands inside the alert")
        : bad("confirmation sits above the edit dialog", "another layer is painted over it");

      // Cancelling must leave the task exactly as it was.
      await alertDialog.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(1500);
      (await shown(taskDialog))
        ? ok("cancel returns to the edit window")
        : bad("cancel returns to the edit window", "the dialog closed instead");

      await taskDialog.getByRole("button", { name: "Save", exact: true }).click();
      await alertDialog.waitFor({ state: "visible", timeout: 20000 });
      await alertDialog.getByRole("button", { name: /Save and complete/ }).click();
      await page.waitForTimeout(3500);
      const closed = !(await shown(taskDialog));
      const label = await rowStatus();
      closed && /Status: Done/i.test(label)
        ? ok("confirming completes the task", label)
        : bad("confirming completes the task", `dialog closed: ${closed}; row says: ${label}`);
      await page.screenshot({ path: `${SHOTS}/04-completed.png` });
    }
  }

  /* --------------------------------------------- the creation window, too */
  current = "creation window";
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: "Add task" }).click();
  await taskDialog.waitFor({ state: "visible", timeout: 30000 });
  await taskDialog.locator('input[placeholder^="e.g. Fix gutter"]').fill(`${TITLE} (creation)`);
  // Cancelled at the confirmation below, so this title never reaches the table.
  {
    const a = await assigneePicker();
    await a.click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: assignee, exact: false }).first().click();
    await page.waitForTimeout(500);
    await taskDialog.locator("button[role='combobox']").first().click();
    await page.waitForTimeout(500);
    await page.getByRole("option", { name: "Done" }).click();
    await page.waitForTimeout(600);
    await taskDialog.getByRole("button", { name: "Create task" }).click();
    await page.waitForTimeout(2000);
    if (await shown(alertDialog)) {
      ok(
        "creation window warns before filing work as done",
        (await alertDialog.innerText()).replace(/\s+/g, " ").slice(0, 160),
      );
      await page.screenshot({ path: `${SHOTS}/05-creation-warning.png` });
      // Cancelled: this run does not need a second row to exist.
      await alertDialog.getByRole("button", { name: "Cancel" }).click();
      await page.waitForTimeout(800);
    } else {
      bad("creation window warns before filing work as done", "no confirmation was raised");
      await page.screenshot({ path: `${SHOTS}/05-creation-no-warning.png` });
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1000);
  }

  /* ---------------------------------------------------------------- tidy up */
  await page.goto(`${BASE}${project}?panel=tasks`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Add task" })
    .waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(2500);
  let removed = 0;
  while (await deleteTask("QA assignment warning")) removed++;
  removed > 0
    ? ok("test tasks deleted", String(removed))
    : bad("test tasks deleted", "nothing was removable");
  await page.waitForTimeout(1500);
  const leftover = await page.getByText("QA assignment warning", { exact: false }).count();
  leftover === 0
    ? ok("nothing left behind", "no row matching the run title")
    : bad("nothing left behind", `${leftover} element(s) still show the title`);

  await browser.close();
};

/** Delete anything this run created, whatever went wrong on the way. */
const sweep = async (page, project) => {
  try {
    await page.goto(`${BASE}${project}?panel=tasks`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Add task" })
      .waitFor({ state: "visible", timeout: 60000 });
    await page.waitForTimeout(2500);
    for (let i = 0; i < 4; i++) {
      const li = page.locator("li").filter({ hasText: TITLE }).first();
      if ((await li.count()) === 0) break;
      await li.hover();
      await li.getByRole("button", { name: "Delete task" }).click({ force: true });
      const alert = page.locator('[role="alertdialog"]');
      await alert.waitFor({ state: "visible", timeout: 15000 });
      await alert
        .getByRole("button", { name: /Continue|Delete/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
    }
  } catch {
    /* best effort - the report says what was left */
  }
};

run()
  .then(() => {
    const failed = checks.filter((c) => !c.pass);
    for (const c of checks)
      console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
    if (problems.length) {
      console.log("\nconsole/page errors:");
      for (const p of problems) console.log(`  [${p.where}] ${p.kind}: ${p.detail}`);
    }
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((e) => {
    for (const c of checks)
      console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
    console.error("\nrun failed:", e.message);
    process.exit(1);
  });
