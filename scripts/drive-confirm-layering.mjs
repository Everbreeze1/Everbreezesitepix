/**
 * Drives the modal-layer guard on the screens the task work did not touch.
 *
 * A confirmation is rendered by the root provider, so it is a SIBLING of any
 * dialog that raises it, not a child. Radix reads the pointerdown that answers
 * it as an interaction outside the dialog underneath and dismisses that dialog
 * too - so "no, keep editing" threw away whatever the dialog was holding. The
 * guard now lives on the shared DialogContent/SheetContent (lib/modal-layers.ts)
 * rather than at each call site, and the photo lightbox - a hand-rolled portal
 * that listens for Escape on the window, not a Radix layer - gets the same
 * question asked its own way.
 *
 * Three cases, chosen because each fails differently:
 *   1. Edit project -> Move to Trash -> Cancel. A dialog raising a destructive
 *      confirmation. Cancelling must leave the edit dialog open.
 *   2. The same, answered with Escape rather than the Cancel button, since the
 *      keyboard path dismisses through a different code path.
 *   3. A task ticked done inside the photo lightbox, cancelled with Escape. The
 *      lightbox must survive, and the photo must stay open.
 *
 * WHAT THIS RUN WRITES. The database is shared with production:
 *
 *   - ONE task against one photo, titled "QA layering <timestamp>", assigned to
 *     a teammate so that ticking it raises the override confirmation. Deleted
 *     through the UI at the end of the run.
 *   - Nothing else. The trash confirmation is always CANCELLED - no project is
 *     ever trashed - and the edit dialog is closed without saving.
 *
 * Run with: node scripts/drive-confirm-layering.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/confirm-layering";
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

const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, "");
const TITLE = `QA layering ${STAMP}`;
const PROJECT_HREF = /^\/projects\/[0-9a-f]{8}-[0-9a-f-]{27}$/;

const run = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  const alert = page.locator('[role="alertdialog"]');
  const shown = (loc) => loc.isVisible().catch(() => false);

  /* ------------------------------------------------------------------ login */
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
  ok("login", new URL(page.url()).pathname);

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
      pattern0(),
    );
  const project = hrefs[0];
  if (!project) throw new Error("no project to drive");

  /* ---------------------------- 1 + 2: a dialog raising a destructive confirm */
  await page.goto(`${BASE}${project}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);

  const editDialog = page.locator('[role="dialog"]').filter({ hasText: /Edit project/i });
  const openEditDialog = async () => {
    // The edit control lives behind the project's actions menu.
    const trigger = page
      .getByRole("button", { name: /Edit project|Edit details|Project settings/i })
      .first();
    if (await trigger.count()) {
      await trigger.click();
    } else {
      await page
        .getByRole("button", { name: /More|Actions|options/i })
        .first()
        .click();
      await page.waitForTimeout(600);
      await page.getByRole("menuitem", { name: /Edit/i }).first().click();
    }
    await editDialog.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForTimeout(800);
  };

  for (const [label, dismiss] of [
    [
      "cancel button",
      async () =>
        alert
          .getByRole("button", { name: /Cancel|Keep/i })
          .first()
          .click(),
    ],
    ["escape key", async () => page.keyboard.press("Escape")],
  ]) {
    try {
      await openEditDialog();
      await editDialog
        .getByRole("button", { name: /Trash|Delete/i })
        .first()
        .click();
      await alert.waitFor({ state: "visible", timeout: 20000 });
      await page.screenshot({ path: `${SHOTS}/01-trash-confirm-${label.split(" ")[0]}.png` });
      await dismiss();
      await page.waitForTimeout(1800);
      const survived = await shown(editDialog);
      survived
        ? ok(`edit dialog survives a confirmation dismissed by ${label}`)
        : bad(`edit dialog survives a confirmation dismissed by ${label}`, "the dialog closed too");
      // Leave without saving anything.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1200);
    } catch (e) {
      bad(`edit dialog survives a confirmation dismissed by ${label}`, e.message.slice(0, 120));
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  /* ------------------------- 3: the hand-rolled lightbox, not a Radix layer */
  await page.goto(`${BASE}${project}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const lightbox = page.locator('[role="dialog"]').filter({ has: page.getByLabel("Close") });

  const tile = page.getByRole("button", { name: "Open photo" }).first();
  await tile.waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  await tile.click({ force: true });
  await page.waitForTimeout(3000);
  const openedLightbox = await shown(lightbox);
  if (!openedLightbox) {
    bad("photo lightbox opens", "could not open a photo, so the lightbox leg did not run");
  } else {
    ok("photo lightbox opens");
    await lightbox
      .getByRole("button", { name: /^Tasks/ })
      .first()
      .click();
    await page.waitForTimeout(1500);

    // A task on this photo, assigned to somebody else so ticking it warns.
    await lightbox.getByPlaceholder("Add a task for this photo…").fill(TITLE);
    await lightbox.getByRole("button", { name: "Assignee" }).first().click();
    await page.waitForTimeout(800);
    const other = page
      .getByRole("option")
      .or(page.locator('[role="dialog"] button, [data-radix-popper-content-wrapper] button'))
      .filter({ hasText: /Miny/i })
      .first();
    await other.click({ force: true });
    await page.waitForTimeout(600);
    await lightbox.getByRole("button", { name: "Add", exact: true }).first().click();
    await page.waitForTimeout(3000);

    const tick = lightbox
      .getByRole("button", { name: /Mark this photo done on this task/i })
      .first();
    await tick.click();
    await page.waitForTimeout(2000);
    if (!(await shown(alert))) {
      bad("ticking a photo on someone else's task warns", "no confirmation appeared");
      await page.screenshot({ path: `${SHOTS}/02-no-photo-warning.png` });
    } else {
      ok(
        "ticking a photo on someone else's task warns",
        (await alert.innerText()).replace(/\s+/g, " ").slice(0, 120),
      );
      await page.screenshot({ path: `${SHOTS}/02-photo-warning.png` });
      // Escape here used to close the lightbox behind the confirmation.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1800);
      const alertGone = !(await shown(alert));
      const lightboxAlive = await shown(lightbox);
      alertGone && lightboxAlive
        ? ok("escape dismisses the confirmation without closing the lightbox")
        : bad(
            "escape dismisses the confirmation without closing the lightbox",
            `alert gone: ${alertGone}; lightbox open: ${lightboxAlive}`,
          );
      await page.screenshot({ path: `${SHOTS}/03-after-escape.png` });
    }

    // Clean up the task from inside the panel, then leave the lightbox.
    const del = lightbox.getByRole("button", { name: "Delete task" }).first();
    if (await del.count()) {
      await del.click({ force: true });
      await page.waitForTimeout(1500);
      if (await shown(alert)) {
        await alert
          .getByRole("button", { name: /Continue|Delete/i })
          .first()
          .click();
        await page.waitForTimeout(1500);
      }
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
  }

  /* ---------------------------------------------------------------- tidy up */
  await page.goto(`${BASE}${project}?panel=tasks`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("button", { name: "Add task" })
    .waitFor({ state: "visible", timeout: 90000 });
  await page.waitForTimeout(2500);
  for (let i = 0; i < 4; i++) {
    const li = page.locator("li").filter({ hasText: "QA layering" }).first();
    if ((await li.count()) === 0) break;
    await li.hover();
    await li.getByRole("button", { name: "Delete task" }).click({ force: true });
    await alert.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    await alert
      .getByRole("button", { name: /Continue|Delete/i })
      .first()
      .click();
    await page.waitForTimeout(2500);
  }
  const leftover = await page.getByText("QA layering", { exact: false }).count();
  leftover === 0
    ? ok("nothing left behind")
    : bad("nothing left behind", `${leftover} still shown`);

  await browser.close();
};

function pattern0() {
  return PROJECT_HREF.source;
}

run()
  .then(() => {
    const failed = checks.filter((c) => !c.pass);
    for (const c of checks)
      console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
    console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
    process.exit(failed.length ? 1 : 0);
  })
  .catch((e) => {
    for (const c of checks)
      console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? ` - ${c.detail}` : ""}`);
    console.error("\nrun failed:", e.message);
    process.exit(1);
  });
