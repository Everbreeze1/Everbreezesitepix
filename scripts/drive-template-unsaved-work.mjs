/**
 * Does an accidental click still throw away what you typed?
 *
 * The client, after filling a document in: "i just opened one to fill it out,
 * when i clicked out of it accidentally the whole thing disappeared. I was
 * filling out the header field etc."
 *
 * Two surfaces in this flow held unsaved typing, and this drives both.
 *
 *   1. The "Use in a project" fill-in step. A centred dialog with a 320px
 *      column of boxes and a wide margin of overlay around it, dismissing on
 *      any click that landed in the margin. This is almost certainly the one
 *      the client hit: it is the screen you "open to fill out", its boxes are
 *      the document's header fields, and reopening resets every one of them.
 *
 *   2. The template editor. It is w-screen/h-screen, so there is no overlay to
 *      click - but Escape discarded an ordinary edit without a word, which is
 *      the same loss through a different key.
 *
 * What it writes: on an account whose library is all examples, opening the
 * editor inserts a copy (see drive-template-editor-polish.mjs). This one
 * answers "Discard" on the way out, which deletes it, and counts the cards
 * before and after to prove it.
 *
 * Run with: node scripts/drive-template-unsaved-work.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/template-unsaved-work";
mkdirSync(SHOTS, { recursive: true });

function env() {
  const out = {};
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const results = [];
const check = (name, pass) => {
  results.push({ name, pass });
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}`);
};

/*
 * Which templates the team OWNS, by name.
 *
 * The card count cannot answer "did this run leave a row behind": a copy of an
 * example records `copiedFrom` and shadows the example it came from, so the
 * library is exactly the same length with the stray row as without it. A run
 * that stranded a copy reported "30 before, 30 after (clean)" and was believed.
 *
 * The "..." menu renders only under `canManage && !isExample`, so its labels
 * are a precise list of the rows this account can create - and therefore of the
 * rows a driver can leave behind.
 */
async function ownedTemplates(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('button[aria-label^="More actions for"]')]
      .map((b) => b.getAttribute("aria-label").replace("More actions for ", ""))
      .sort(),
  );
}

/**
 * Delete any team-owned template that was not there when this run started.
 *
 * Opening the editor on an example INSERTS a copy, and only leaving the editor
 * cleanly deletes it again - so any crash between those two points strands a
 * row in a database shared with production. That has now happened twice, both
 * times because the network to Supabase went flaky mid-run, and both times it
 * went unnoticed because the card count is blind to it (a copy shadows the
 * example it was made from).
 *
 * Called from a `finally`, so a timeout cleans up after itself. Best effort by
 * design: it reports what it could not remove rather than throwing over it.
 */
async function deleteStranded(page, ownedBefore, base) {
  try {
    await page.goto(`${base}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Use in a project", { timeout: 60000 });
    await page.waitForTimeout(2000);
    const stranded = (await ownedTemplates(page)).filter((n) => !ownedBefore.includes(n));
    if (!stranded.length) return;
    console.log(`\ncleaning up ${stranded.length} stranded row(s): ${stranded.join(", ")}`);
    for (const name of stranded) {
      await page.locator(`button[aria-label="More actions for ${name}"]`).first().click();
      await page.waitForTimeout(500);
      await page.getByRole("menuitem", { name: /Delete/ }).click();
      await page.waitForTimeout(700);
      // confirm() is called without a confirmText, so the button says Continue.
      await page
        .locator('[role="alertdialog"] button')
        .filter({ hasText: /^Continue$/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
    }
    const left = (await ownedTemplates(page)).filter((n) => !ownedBefore.includes(n));
    console.log(
      left.length
        ? `STILL STRANDED: ${left.join(", ")} - run scripts/cleanup-stray-template-copy.mjs`
        : "cleaned up",
    );
  } catch (e) {
    console.log(
      `cleanup could not run (${e.message.split("\n")[0]}) - run scripts/cleanup-stray-template-copy.mjs`,
    );
  }
}

const run = async () => {
  const { email, password } = env();
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });
  const page = await ctx.newPage();

  // ---------- login ----------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let i = 0; i < 5; i += 1) {
    await page.locator('input[type="email"]').fill("");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 8 });
    await page.locator('input[type="password"]').fill("");
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 8 });
    await page.waitForTimeout(2000);
    if ((await page.locator('input[type="email"]').inputValue()) === email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  if (/\/login/.test(new URL(page.url()).pathname)) throw new Error("login failed");
  console.log("login OK\n");

  await page.goto(`${BASE}/templates?tab=documents`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Use in a project", { timeout: 90000 });
  await page.waitForTimeout(1500);
  const cardsBefore = await page.getByRole("button", { name: "Use in a project" }).count();
  const ownedBefore = await ownedTemplates(page);

  try {
    // =========================================================================
    // 1. The fill-in step
    // =========================================================================
    console.log("Use in a project - the fill-in step");
    await page.getByRole("button", { name: "Use in a project" }).first().click();
    await page.waitForSelector("text=Pick a project", { timeout: 30000 });
    await page.waitForTimeout(800);
    // The project rows are the only buttons inside the picker's list.
    await page.locator('[role="dialog"] button').filter({ hasText: /,/ }).first().click();
    await page.waitForSelector("text=Document name", { timeout: 60000 });
    await page.waitForTimeout(2500);

    const nameBox = page.locator('[role="dialog"] input').first();
    await nameBox.fill("");
    await nameBox.pressSequentially("Roof survey - unit 4", { delay: 10 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/01-filled-in.png` });

    // The accident: a click out in the margin beside the dialog.
    await page.mouse.click(40, 450);
    await page.waitForTimeout(1200);
    check(
      "a click outside leaves the fill-in dialog open",
      await page.locator("text=Document name").isVisible(),
    );
    check(
      "and what was typed is still there",
      (await nameBox.inputValue()) === "Roof survey - unit 4",
    );

    // Escape is a deliberate act, so it asks rather than ignoring.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    const asked = await page.locator('[role="alertdialog"]').isVisible();
    check("Escape asks before discarding", asked);
    await page.screenshot({ path: `${SHOTS}/02-escape-asks.png` });

    if (asked) {
      await page.getByRole("button", { name: "Keep filling it in" }).click();
      await page.waitForTimeout(1200);
      check(
        "declining keeps the dialog and the typing",
        (await page.locator("text=Document name").isVisible()) &&
          (await nameBox.inputValue()) === "Roof survey - unit 4",
      );
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      await page
        .getByRole("button", { name: "Discard", exact: true })
        .click()
        .catch(() => {});
      await page.waitForTimeout(1500);
      check("accepting closes it", !(await page.locator("text=Document name").isVisible()));
    }

    // An untouched dialog should not nag on the way out.
    await page.getByRole("button", { name: "Use in a project" }).first().click();
    await page.waitForSelector("text=Pick a project", { timeout: 30000 });
    await page.waitForTimeout(800);
    await page.locator('[role="dialog"] button').filter({ hasText: /,/ }).first().click();
    await page.waitForSelector("text=Document name", { timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    check(
      "an untouched fill-in closes on the first Escape, no question asked",
      !(await page.locator('[role="alertdialog"]').isVisible()) &&
        !(await page.locator("text=Document name").isVisible()),
    );

    // =========================================================================
    // 2. The template editor
    // =========================================================================
    console.log("\nThe template editor");
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: "Edit", exact: true }).first().click();
    await page.waitForSelector("text=Save template", { timeout: 60000 });
    await page.waitForTimeout(3000);

    // Type into the document itself.
    await page.locator(".doc-page .ProseMirror").click();
    await page.keyboard.press("End");
    await page.keyboard.type("UNSAVED EDIT MARKER", { delay: 12 });
    await page.waitForTimeout(800);
    check(
      "the edit landed in the document",
      (await page.locator(".doc-page .ProseMirror").innerText()).includes("UNSAVED EDIT MARKER"),
    );

    await page.keyboard.press("Escape");
    await page.waitForTimeout(1200);
    const editorAsked = await page.locator('[role="alertdialog"]').isVisible();
    check("Escape asks before discarding an unsaved edit", editorAsked);
    await page.screenshot({ path: `${SHOTS}/03-editor-escape-asks.png` });

    if (editorAsked) {
      await page.getByRole("button", { name: "Keep editing" }).click();
      await page.waitForTimeout(1200);
      check(
        "declining keeps the editor and the edit",
        (await page.locator("text=Save template").isVisible()) &&
          (await page.locator(".doc-page .ProseMirror").innerText()).includes(
            "UNSAVED EDIT MARKER",
          ),
      );
    }

    // Leave for real, discarding - which also deletes the copy that opening an
    // example created.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.waitForTimeout(1200);
    await page
      .getByRole("button", { name: /^Discard/ })
      .click()
      .catch(() => {});
    await page.waitForTimeout(4000);

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Use in a project", { timeout: 90000 });
    await page.waitForTimeout(2000);
    const cardsAfter = await page.getByRole("button", { name: "Use in a project" }).count();
    const ownedAfter = await ownedTemplates(page);
    check(`library back to ${cardsBefore} cards (was ${cardsAfter})`, cardsAfter === cardsBefore);
    const stranded = ownedAfter.filter((n) => !ownedBefore.includes(n));
    check(
      "no template row left behind",
      stranded.length === 0,
      stranded.length ? `stranded: ${stranded.join(", ")}` : "",
    );

    const failed = results.filter((r) => !r.pass);
    console.log(
      `\n${results.length - failed.length}/${results.length} checks passed${
        failed.length ? ` - FAILED: ${failed.map((f) => f.name).join("; ")}` : ""
      }`,
    );
  } finally {
    await deleteStranded(page, ownedBefore, BASE);
  }

  await browser.close();
  // Recomputed from `results` rather than reusing `failed`: that is declared
  // inside the try block the cleanup handler wrapped around this run.
  if (results.some((r) => !r.pass)) process.exit(1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
