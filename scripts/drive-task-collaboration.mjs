/**
 * Drives the two task-collaboration paths that have never been opened in a
 * browser: the comment thread, and the `?task=` deep link.
 *
 * Both are verified at the database level by
 * scripts/verify-task-collaboration.mjs - the triggers fire, the rows land, the
 * policies hold. Neither of those answers the question a person asks, which is
 * whether the thread renders next to the task and whether the link in a
 * notification email actually opens the thing it names.
 *
 * The deep link matters most. Every notification a task raises now carries
 * `/projects/<id>?task=<uuid>`, so a crew member tapping "Mark commented on a
 * task" in their inbox lands here. If the route's search param, the panel's
 * openTaskId effect and the dialog disagree, that link silently drops them on a
 * grid of photos - which is the exact failure the link was added to remove, and
 * nothing on screen would say so.
 *
 * WHAT THIS RUN WRITES:
 *
 *   - ONE task, titled "QA collab <timestamp>", deleted through the UI at the
 *     end of the run.
 *   - ONE comment on it, which the task's deletion cascades away.
 *
 * It does NOT add a watcher. Adding one notifies that person and mails them,
 * and a real teammate must not get a QA email. The watcher picker is opened and
 * inspected, then dismissed without choosing anybody.
 *
 * Run with: node scripts/drive-task-collaboration.mjs
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/task-collab";
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
const TITLE = `QA collab ${STAMP}`;
const NOTE = "Waiting on part.";
const PROJECT_HREF = /^\/projects\/[0-9a-f]{8}-[0-9a-f-]{27}$/;

const cfg = env("apps/api/.env");
const admin = createClient(cfg.EVERLUMEN_SUPABASE_URL, cfg.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

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

  const taskDialog = page.locator('[role="dialog"]').filter({ hasText: /Edit task|New task/ });
  let taskId = null;

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
  if (/\/login/.test(new URL(page.url()).pathname)) throw new Error("login did not leave /login");
  ok("login", new URL(page.url()).pathname);

  /* ---------------------------------------------------------- find a project */
  current = "projects";
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
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
  const href = hrefs[0];

  current = "tasks panel";
  await page.goto(`${BASE}${href}?panel=tasks`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Add task" })
    .waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(2500);

  try {
    /* --------------------------------------------------------- create a task */
    current = "create";
    const quickAdd = page.getByPlaceholder(/Add a task and press Enter/i);
    await quickAdd.click();
    await quickAdd.fill(TITLE);
    await quickAdd.press("Enter");
    await page.getByText(TITLE, { exact: true }).waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(1200);
    ok("task created");

    // Its id, so the deep link below is the real thing a notification carries
    // rather than a guess.
    {
      const { data } = await admin.from("tasks").select("id").eq("title", TITLE).maybeSingle();
      taskId = data?.id ?? null;
      if (!taskId) bad("task id readable", "could not find the row");
    }

    /* --------------------------------------------------------- open the task */
    current = "open";
    await page.getByText(TITLE, { exact: true }).click();
    await taskDialog.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(2500);
    ok("the task dialog opens");

    /* ------------------------------------------------------------ the thread */
    current = "thread";
    const activity = taskDialog.getByText(/^Activity/);
    if (await activity.isVisible().catch(() => false)) ok("the Activity thread is on the dialog");
    else bad("the Activity thread is on the dialog", "not rendered");

    const composer = taskDialog.getByPlaceholder(/Leave a note/i);
    if (await composer.isVisible().catch(() => false)) {
      await composer.click();
      await composer.fill(NOTE);
      await composer.press("Enter");
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${SHOTS}/10-comment.png`, fullPage: true });

      const posted = await taskDialog
        .getByText(NOTE, { exact: true })
        .isVisible()
        .catch(() => false);
      if (posted) ok("a note posts and appears in the thread", NOTE);
      else bad("a note posts and appears in the thread", "not visible after posting");

      // It has to be a logged message with an author, not an edit.
      if (taskId) {
        const { data } = await admin
          .from("task_comments")
          .select("id, body, author_id")
          .eq("task_id", taskId);
        if ((data ?? []).length === 1 && data[0].body === NOTE)
          ok("the note is stored as its own row", `author ${data[0].author_id.slice(0, 8)}`);
        else bad("the note is stored as its own row", `${(data ?? []).length} row(s)`);
      }
    } else {
      bad("the note composer is on the dialog", "not rendered");
    }

    /* ------------------------------------------------- the watcher picker */
    current = "watchers";
    const addPeople = taskDialog.getByRole("button", { name: /Add people/i });
    if (await addPeople.isVisible().catch(() => false)) {
      await addPeople.click();
      await page.waitForTimeout(1200);
      // Inspected, never chosen: adding a watcher mails a real teammate.
      const options = await page
        .locator('[role="dialog"] button, [data-radix-popper-content-wrapper] button')
        .count();
      await page.screenshot({ path: `${SHOTS}/20-watchers.png`, fullPage: true });
      if (options > 0) ok("the watcher picker opens", `${options} control(s)`);
      else bad("the watcher picker opens", "empty");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    } else {
      bad("the Add people control is on the dialog", "not rendered");
    }

    // Close the dialog before the deep-link leg, so what opens next is the link
    // doing the work rather than a dialog that was already up.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1500);

    /* =================== THE DEEP LINK EVERY NOTIFICATION CARRIES ========== */
    current = "deep link";
    if (taskId) {
      await page.goto(`${BASE}${href}?task=${taskId}`, { waitUntil: "domcontentloaded" });
      const opened = await taskDialog
        .waitFor({ state: "visible", timeout: 45000 })
        .then(() => true)
        .catch(() => false);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/30-deep-link.png`, fullPage: true });
      if (!opened) {
        bad("?task= opens the task", "the dialog never appeared");
      } else {
        const showsIt = await taskDialog
          .getByText(TITLE, { exact: false })
          .first()
          .isVisible()
          .catch(() => false);
        if (showsIt) ok("?task= opens the task it names");
        else bad("?task= opens the task it names", "a dialog opened on something else");

        // The thread has to come with it - the link exists so a "commented on a
        // task" notification lands on the conversation.
        const note = await taskDialog
          .getByText(NOTE, { exact: true })
          .isVisible()
          .catch(() => false);
        if (note) ok("the thread comes with it");
        else bad("the thread comes with it", "the note is not shown");
      }

      // The id must not survive in the address bar, or every back-nav reopens
      // the task.
      const url = new URL(page.url());
      if (!url.searchParams.get("task")) ok("the link is consumed, not left in the URL");
      else bad("the link is consumed, not left in the URL", url.search);
      if (url.searchParams.get("panel") === "tasks") ok("it lands on the Tasks tab");
      else bad("it lands on the Tasks tab", url.search || "(no panel)");
    }
  } finally {
    /* --------------------------------------------------------------- cleanup */
    current = "cleanup";
    try {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(500);
      if (taskId) {
        // Through the database rather than the UI: the UI leg is already
        // covered by drive-task-bulk-bar.mjs, and cleanup that depends on a
        // working UI is cleanup that fails exactly when the run found a bug.
        await admin.from("notifications").delete().eq("entity_id", taskId);
        const { data: cs } = await admin.from("task_comments").select("id").eq("task_id", taskId);
        if ((cs ?? []).length)
          await admin
            .from("notifications")
            .delete()
            .in(
              "entity_id",
              cs.map((c) => c.id),
            );
        await admin.from("tasks").delete().eq("id", taskId);
        const { data: left } = await admin.from("tasks").select("id").eq("title", TITLE);
        if ((left ?? []).length === 0) ok("cleanup: task and thread removed");
        else bad("cleanup", `REMOVE "${TITLE}" BY HAND`);
      }
    } catch (e) {
      bad("cleanup", `${String(e).slice(0, 120)} - REMOVE "${TITLE}" BY HAND`);
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
      failures === 0 ? "Task collaboration verified in a browser." : `${failures} check(s) FAILED.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
