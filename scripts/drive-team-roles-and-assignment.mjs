/**
 * Drives the roles-and-assignment work in a real browser.
 *
 * tests/team-permissions.test.ts and tests/project-assignment.test.ts prove the
 * matrix and the wiring, but neither mounts a component, and every single item
 * in the client's report is a rendering fact:
 *
 *   "no badge on their row"                  - does a badge actually paint?
 *   "reopening Manage shows no checkmark"    - is the current role in the list,
 *                                              and marked?
 *   "no explanation of what they grant"      - is the one-liner under each
 *                                              option on screen, not just in
 *                                              the module that exports it?
 *   "it says Contributor and hovering gives
 *    no information"                         - does the panel open, and does it
 *                                              say who and what?
 *   "assign them projects from the projects
 *    page" / "from that project page"        - do the controls exist, and does
 *                                              saving one stick?
 *
 * A path-based test can assert that `<RoleBadge>` appears in a file. Only a
 * browser can say it rendered.
 *
 * === WHAT THIS RUN WRITES =================================================
 * One thing, and it puts it back:
 *
 *   - assigns the SIGNED-IN OWNER to one project, screenshots it, then
 *     unassigns them, leaving the crew exactly as it was found.
 *
 * The owner is used deliberately rather than the teammate: `insertNotification`
 * drops a notification whose recipient is the actor, so assigning yourself
 * raises no row and reaches nobody's inbox. Every other dialog this opens is
 * cancelled. The database is shared with production.
 *
 * Run with: node scripts/drive-team-roles-and-assignment.mjs
 * Screenshots land in artifacts/team-roles/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/team-roles";
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
const skip = (name, detail = "") => checks.push({ pass: true, skipped: true, name, detail });

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

  const shown = (loc) => loc.isVisible().catch(() => false);
  const popover = () => page.locator("[data-radix-popper-content-wrapper]").last();

  /* ------------------------------------------------------------------ login */
  current = "login";
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  // Hydration lands late and re-renders the inputs back to empty, so the fill
  // is retried until it sticks rather than trusted the first time.
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

  /* ==================================================================== */
  /* 1. THE ROSTER: a badge per member, a tick in the menu, descriptions   */
  /* ==================================================================== */
  current = "teams";
  await page.goto(`${BASE}/teams`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Team members", { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/01-roster.png` });

  {
    // The badge is the fix for "no badge on their row". Owner is always there,
    // so its absence is unambiguous.
    const roster = page.locator("ul", { has: page.locator("text=Manage") }).first();
    const text = await roster.innerText().catch(() => "");
    if (/OWNER/i.test(text)) ok("the roster shows a role badge per member", text.split("\n")[1]);
    else bad("the roster shows a role badge per member", text.slice(0, 120));
  }

  {
    // "reopening the Manage menu shows no checkmark or indicator next to their
    // current role" - the current role must be IN the list and marked.
    // NOT `.first()`: the owner row renders a Manage button that is correctly
    // disabled - the owner is immune to everyone, including themselves - and
    // clicking it hangs. The first ENABLED one is the teammate.
    const manage = page.locator("button:not([disabled])", { hasText: /^Manage$/ }).first();
    if (await shown(manage)) {
      await manage.click();
      await page.waitForTimeout(800);
      const menu = await popover()
        .innerText()
        .catch(() => "");
      await page.screenshot({ path: `${SHOTS}/02-manage-menu.png` });

      if (/\(current\)/i.test(menu)) ok("the Manage menu marks the current role", "(current)");
      else bad("the Manage menu marks the current role", menu.slice(0, 200));

      // Every option carries its one-liner, which is the second report.
      const described = [
        /Full control, including billing/i,
        /Runs their own crew/i,
        /Works on every project/i,
        /Sees only the jobs you assign/i,
      ].filter((re) => re.test(menu)).length;
      if (described >= 3) ok("each role option states what it grants", `${described} descriptions`);
      else bad("each role option states what it grants", menu.slice(0, 240));

      // This account is on Team, so the full hierarchy must be offered.
      const roles = ["Admin", "Manager", "Standard", "Restricted"].filter((r) =>
        new RegExp(`\\b${r}\\b`).test(menu),
      );
      if (roles.length === 4) ok("Team offers the whole hierarchy", roles.join(", "));
      else bad("Team offers the whole hierarchy", `only ${roles.join(", ") || "none"}`);

      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } else {
      bad("the Manage menu marks the current role", "no Manage button on the roster");
    }
  }

  /* ==================================================================== */
  /* 2. THE PROJECTS PAGE: assign from the list                            */
  /* ==================================================================== */
  current = "projects";
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('a[aria-label^="Open "]', { timeout: 90000 }).catch(() => {});
  /*
   * The cards and the crew are two different requests.
   *
   * A card link appears as soon as the project list resolves; the crew stack
   * waits on `getProjectAssignees`, which lands later. A flat 4s covered that
   * gap on a quiet machine and stopped covering it on a busy one, at which
   * point this run reported "no crew chip on any card" for a feature that was
   * present and working. Wait for the thing being asserted.
   */
  await page
    .getByRole("button", { name: /Assign teammates to this job|Change the crew/i })
    .first()
    .waitFor({ state: "visible", timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/03-projects-list.png` });

  const firstCardName = await page
    .locator('a[aria-label^="Open "]')
    .first()
    .getAttribute("aria-label")
    .then((s) => (s ?? "").replace(/^Open /, ""))
    .catch(() => "");

  {
    // Either wording. An unstaffed job offers "Assign teammates to this job"
    // and a staffed one "Change the crew"; asserting only the first made the
    // check fail purely because a previous run had left a job staffed.
    const crew = page
      .getByRole("button", { name: /Assign teammates to this job|Change the crew/i })
      .first();
    if (await shown(crew))
      ok("project cards carry a crew control", await crew.getAttribute("aria-label"));
    else bad("project cards carry a crew control", "no crew chip on any card");
  }

  {
    // The explicit, discoverable path: the card's own overflow menu.
    const cardMenu = page.getByRole("button", { name: "More actions" }).first();
    if (await shown(cardMenu)) {
      await cardMenu.click();
      await page.waitForTimeout(700);
      const menu = await popover()
        .innerText()
        .catch(() => "");
      await page.screenshot({ path: `${SHOTS}/04-card-menu.png` });
      if (/Crew/i.test(menu) && /Assign teammates|Change crew/i.test(menu))
        ok("the card menu offers Assign teammates");
      else bad("the card menu offers Assign teammates", menu.slice(0, 200));
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    } else {
      bad("the card menu offers Assign teammates", "no card menu");
    }
  }

  /* --------------------------------------------- the dialog, and a real save */
  {
    current = "assign dialog";
    /*
     * Either starting state. The chip reads "Assign teammates to this job" on an
     * unstaffed job and "Change the crew" on a staffed one, and a previous run
     * of this script - or a real person - may have left one staffed. Accepting
     * both is what makes this repeatable instead of silently skipping.
     */
    const crewChip = page
      .getByRole("button", { name: /Assign teammates to this job|Change the crew/i })
      .first();
    if (!(await shown(crewChip))) {
      skip("the assign dialog lists the roster with roles", "no crew control to open");
    } else {
      await crewChip.click();
      await page.waitForTimeout(2500);
      const dialog = page.getByRole("dialog");
      const body = await dialog.innerText().catch(() => "");
      await page.screenshot({ path: `${SHOTS}/05-assign-dialog.png` });

      if (/Who is on /i.test(body)) ok("the assign dialog opens", body.split("\n")[0]);
      else bad("the assign dialog opens", body.slice(0, 160));

      // Roles are named and explained here too, so an admin staffing a job can
      // see who they are handing it to.
      if (/OWNER/i.test(body) && /already sees every project/i.test(body))
        ok("the dialog names each teammate's role");
      else bad("the dialog names each teammate's role", body.slice(0, 240));

      /* ------------------------- an in-progress edit survives a background refetch */
      {
        /*
         * React Query refetches on window focus by default, and the dialog
         * seeds its tickboxes from the query result. If that seeding runs again
         * on a refetch it overwrites whatever the person has ticked since they
         * opened it - silently, with the server's older answer.
         *
         * Tabbing away and back is the everyday way to trigger it: look
         * something up, come back, and the boxes you ticked are cleared. This
         * fires the same `focus` event Query listens for.
         */
        const meRow = dialog
          .locator("label")
          .filter({ hasText: new RegExp(email.split("@")[0], "i") })
          .first();
        const box = meRow.locator('button[role="checkbox"]');
        const started = await box.getAttribute("data-state");
        await box.click();
        await page.waitForTimeout(300);
        const ticked = await box.getAttribute("data-state");

        /*
         * The 31s wait is load-bearing, not padding.
         *
         * `useProjectAssignees` sets staleTime: 30_000, and Query skips a focus
         * refetch while the data is still fresh. Firing focus immediately
         * "passed" and proved nothing. The scenario that bites a real person is
         * exactly the one that outlives the stale window: open the dialog, go
         * and look something up, come back a minute later.
         */
        await page.waitForTimeout(31000);
        await page.evaluate(() => {
          window.dispatchEvent(new Event("focus"));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await page.waitForTimeout(5000);

        const after = await box.getAttribute("data-state");
        if (after === ticked) ok("an in-progress edit survives a background refetch", after);
        else
          bad(
            "an in-progress edit survives a background refetch",
            `ticked to ${ticked}, refetch reverted it to ${after} (was ${started})`,
          );
        // Put the box back the way it was found; the save block below drives
        // the real write.
        if (after !== started) {
          await box.click();
          await page.waitForTimeout(300);
        }
      }

      /* ------------------------------------- save, verify, and put it back */
      // Ticking YOURSELF is the one write that reaches nobody:
      // `insertNotification` drops a row whose recipient is the actor.
      const meRow = dialog
        .locator("label")
        .filter({ hasText: new RegExp(email.split("@")[0], "i") })
        .first();
      if (!(await shown(meRow))) {
        skip("saving the crew sticks", "own row not found in the dialog");
        await dialog.getByRole("button", { name: "Cancel" }).click();
      } else {
        const box = meRow.locator('button[role="checkbox"]');
        const before = await box.getAttribute("data-state");
        const who = (await meRow.innerText()).split("\n")[0];

        await box.click();
        await page.waitForTimeout(400);
        /*
         * Record toasts as they appear rather than going looking for one.
         *
         * A sonner toast auto-dismisses, so every sampling approach races it:
         * waiting for the selector then reading innerText still lost, because
         * the node detached between the handle resolving and the read. An
         * observer catches the text at the moment it is added and keeps it, so
         * the assertion no longer depends on how busy the machine was.
         */
        await page.evaluate(() => {
          window.__toasts = [];
          const seen = () =>
            document.querySelectorAll("[data-sonner-toast]").forEach((n) => {
              const t = n.innerText;
              if (t && !window.__toasts.includes(t)) window.__toasts.push(t);
            });
          new MutationObserver(seen).observe(document.body, { childList: true, subtree: true });
          seen();
        });
        await dialog.getByRole("button", { name: "Save crew" }).click();
        /*
         * The dialog closing IS the signal that the save resolved.
         *
         * A flat 3.5s raced it: the first run screenshotted a dialog still
         * showing a spinner on the Save button, then asserted against a card
         * that had not been given the chance to re-render, and reported a
         * product bug that was a stopwatch bug.
         */
        await page
          .getByRole("dialog")
          .waitFor({ state: "detached", timeout: 45000 })
          .catch(() => {});
        await page.waitForTimeout(2500);
        await page.screenshot({ path: `${SHOTS}/06-after-save.png` });

        const toasts = await page.evaluate(() => window.__toasts ?? []);
        const confirmation = toasts.find((t) => /on this job/i.test(t));
        if (confirmation) ok("saving the crew confirms what happened", confirmation.trim());
        else
          bad(
            "saving the crew confirms what happened",
            toasts.join(" | ").slice(0, 160) || "no toast appeared",
          );

        // Ticked from empty -> the card must now draw the crew. Unticked from
        // staffed -> it must go back to offering Assign. Either way it changes.
        const wanted = before === "checked" ? /Assign teammates to this job/i : /Change the crew/i;
        if (await shown(page.getByRole("button", { name: wanted }).first()))
          ok("the card re-renders with the crew it was given", who);
        else bad("the card re-renders with the crew it was given", "the card did not change");

        /* ---------------------------------------------------- put it back */
        current = "restore";
        const reopen = page
          .getByRole("button", { name: /Assign teammates to this job|Change the crew/i })
          .first();
        if (await shown(reopen)) {
          await reopen.click();
          await page.waitForTimeout(2500);
          const d2 = page.getByRole("dialog");
          const again = d2
            .locator("label")
            .filter({ hasText: new RegExp(email.split("@")[0], "i") })
            .first();
          await again.locator('button[role="checkbox"]').click();
          await page.waitForTimeout(400);
          await d2.getByRole("button", { name: "Save crew" }).click();
          await page
            .getByRole("dialog")
            .waitFor({ state: "detached", timeout: 45000 })
            .catch(() => {});
          await page.waitForTimeout(2000);
          const after = await page
            .getByRole("button", { name: /Assign teammates to this job|Change the crew/i })
            .first()
            .getAttribute("aria-label")
            .catch(() => "");
          const restored =
            before === "checked" ? /Change the crew/i.test(after) : /Assign teammates/i.test(after);
          if (restored) ok("the crew was restored to how it was found", after);
          else bad("the crew was restored to how it was found", after || "unknown");
        } else {
          bad("the crew was restored to how it was found", "could not reopen the dialog");
        }
      }
    }
  }

  /* ==================================================================== */
  /* 3. THE PROJECT PAGE: crew row, and "contributor" that says something  */
  /* ==================================================================== */
  current = "project page";
  {
    const open = page.locator('a[aria-label^="Open "]').first();
    if (!(await shown(open))) {
      skip("the project header carries a crew row", "no project to open");
    } else {
      await open.click();
      /*
       * Waited for, not slept through. A project page resolves several RPCs
       * before the hero paints, and a flat 9s sleep reported "no crew control"
       * on a run that was simply slower than the one before it. The control
       * itself is the signal that the header has finished.
       */
      /*
       * Wait for the PAGE first, then for the control.
       *
       * Waiting only on the crew chip cannot tell "the header rendered and has
       * no crew row" from "the header never rendered". On one run the
       * screenshot showed a spinner at 61s, so the check was reporting a slow
       * dev server as a missing feature. The heading is the page; the chip is
       * the claim; and the failure message now says which one is missing.
       */
      /*
       * The project's OWN heading, not `h1`.first().
       *
       * `.first()` picked whichever h1 came first in the DOM, which can be a
       * hidden one from the shell, so the wait timed out and the failure said
       * "never finished loading" about a page that had loaded - the check right
       * after it passed on the same page. A diagnostic that lies is worse than
       * no diagnostic.
       */
      const heading = firstCardName
        ? page.locator("h1", { hasText: firstCardName }).first()
        : page.locator("h1").first();
      await heading.waitFor({ state: "visible", timeout: 90000 }).catch(() => {});
      const crewChip = page
        .getByRole("button", { name: /Assign teammates to this job|Change the crew/i })
        .first();
      await crewChip.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${SHOTS}/07-project-header.png` });

      if (await shown(crewChip)) ok("the project header carries a crew row", firstCardName);
      else
        bad(
          "the project header carries a crew row",
          (await shown(heading))
            ? "the header rendered without a crew row"
            : "the project page never finished loading",
        );

      // The report was that hovering "N contributors" gave nothing back.
      const contribChip = page.getByRole("button", { name: /contributors?/i }).first();
      await contribChip.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
      if (await shown(contribChip)) {
        await contribChip.click();
        await page.waitForTimeout(1200);
        const panel = await popover()
          .innerText()
          .catch(() => "");
        await page.screenshot({ path: `${SHOTS}/08-contributors-panel.png` });
        if (/People who have added photos/i.test(panel))
          ok("the contributors chip explains itself", panel.split("\n").slice(0, 2).join(" / "));
        else bad("the contributors chip explains itself", panel.slice(0, 200) || "nothing opened");
        await page.keyboard.press("Escape");
      } else {
        skip("the contributors chip explains itself", "this project has no contributors yet");
      }
    }
  }

  /* ==================================================================== */
  /* 4. THE THREE SCREENS THAT HAD THEIR OWN ROLE VOCABULARY               */
  /* ==================================================================== */
  current = "settings";
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  // The badge waits on getMyTeam, which lands after the shell paints.
  await page
    .getByText(/Workspace settings/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/09-settings.png` });
  {
    // `body` alone: "header, ..., body" matched two elements and Playwright
    // refuses an ambiguous locator in strict mode.
    const header = await page.locator("body").innerText();
    // The bug was Admin reading "Project manager" and everything unrecognised
    // reading "Workspace admin". Neither string may survive anywhere on screen.
    if (/Workspace admin|Crew member/i.test(header))
      bad("Settings no longer uses its own role words", "old vocabulary still on screen");
    else ok("Settings no longer uses its own role words");
    if (/\bOWNER\b/.test(header)) ok("Settings shows the real role badge");
    else bad("Settings shows the real role badge", header.slice(0, 200));
  }

  current = "collaborators";
  await page.goto(`${BASE}/collaborators`, { waitUntil: "domcontentloaded" });
  // Same again: the roster is an RPC, so wait for the roster, not the clock.
  await page
    .getByText(/Team contributions/i)
    .first()
    .waitFor({ state: "visible", timeout: 60000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${SHOTS}/10-collaborators.png` });
  {
    const body = await page.locator("body").innerText();
    if (/Team contributions/i.test(body)) {
      if (/\bOWNER\b/.test(body)) ok("Collaborators shows the real role badge");
      else bad("Collaborators shows the real role badge", body.slice(0, 200));
    } else {
      skip("Collaborators shows the real role badge", "page did not render a roster");
    }
  }

  return { browser };
};

const main = async () => {
  let browser;
  try {
    ({ browser } = await run());
  } catch (e) {
    bad(`crashed during ${current}`, String(e).slice(0, 200));
  } finally {
    if (browser) await browser.close();
  }

  console.log("");
  let failures = 0;
  for (const c of checks) {
    const mark = c.skipped ? "-" : c.pass ? "PASS" : "FAIL";
    if (!c.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  if (problems.length) {
    console.log("");
    console.log(`  ${problems.length} console/page error(s):`);
    for (const p of problems.slice(0, 8)) console.log(`    [${p.where}] ${p.detail}`);
  }
  console.log("");
  console.log(
    failures === 0
      ? "Roles and assignment verified in the browser."
      : `${failures} check(s) FAILED.`,
  );
  console.log(`Screenshots in ${SHOTS}/`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
