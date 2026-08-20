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
        (await page.locator(".doc-page .ProseMirror").innerText()).includes("UNSAVED EDIT MARKER"),
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
  check(`library back to ${cardsBefore} cards (was ${cardsAfter})`, cardsAfter === cardsBefore);

  const failed = results.filter((r) => !r.pass);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed${
      failed.length ? ` - FAILED: ${failed.map((f) => f.name).join("; ")}` : ""
    }`,
  );
  await browser.close();
  if (failed.length) process.exit(1);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
