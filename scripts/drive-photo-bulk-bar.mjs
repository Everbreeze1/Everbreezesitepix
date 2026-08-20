/**
 * Drives the photo selection toolbar in a real browser.
 *
 * The review this answers was about pixels and about a spinner, and neither is
 * something a grep can settle:
 *
 *   "the selection toolbar renders as a floating pill directly on top of the
 *    main site header ... it visually covers the search bar and fully hides the
 *    notification bell and account menu, so users lose access to global nav
 *    while selecting photos."
 *
 *   "Share gets stuck in a permanent loading spinner with no result, no popup,
 *    and no error."
 *
 *   "the Move destination picker shows duplicate 'Untitled project' entries."
 *
 * So this run measures. It reads the bounding boxes of the header's search box,
 * the notification bell and the account menu, and the box of the toolbar, and
 * fails if they intersect. Then it opens Share and Move and looks at what
 * actually appeared.
 *
 * WHAT THIS RUN WRITES: nothing. It ticks a photo, opens two dialogs, closes
 * them, and clears the selection. It never presses Hide, Trash, Move photos or
 * Create links, so no row in the shared database is touched.
 *
 * Run with: node scripts/drive-photo-bulk-bar.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/photo-bulk-bar";
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

const PROJECT_HREF = /^\/projects\/[0-9a-f]{8}-[0-9a-f-]{27}$/;

/** Do two DOM rects overlap by more than a hairline? */
const overlaps = (a, b) => {
  if (!a || !b) return false;
  const x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return x > 1 && y > 1;
};

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  /* ------------------------------------------------------------------ login */
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

  /* ------------------------------------------- a project that has photos in */
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

  let opened = null;
  for (const href of hrefs.slice(0, 6)) {
    await page.goto(`${BASE}${href}`, { waitUntil: "domcontentloaded" });
    await page
      .getByRole("button", { name: "Select", exact: true })
      .first()
      .waitFor({ state: "visible", timeout: 90000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    if (
      await page
        .getByRole("button", { name: "Select", exact: true })
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      opened = href;
      break;
    }
  }
  if (!opened) throw new Error("no project with photos and a Select control");
  ok("Select control is on the Photos toolbar", opened);

  /* ------------------------------------------------ turn selection on */
  // The toolbar pill, not a tile tick box: both carry the name "Select", and
  // the toolbar is first in the DOM.
  await page.getByRole("button", { name: "Select", exact: true }).first().click();
  await page.waitForTimeout(600);
  const firstBox = page.getByRole("button", { name: /^(Select|Deselect) photo?$/ }).first();
  await page
    .locator('button[aria-label="Select"]')
    .first()
    .click({ timeout: 15000 })
    .catch(async () => {
      await firstBox.click({ timeout: 15000 });
    });
  await page.waitForTimeout(900);

  const bar = page.locator("div.sticky", { hasText: "Selected" }).first();
  await bar.waitFor({ state: "visible", timeout: 20000 });
  ok("toolbar appears once a photo is ticked");

  /* ------------------------------------ the actual complaint: does it cover */
  await page.screenshot({ path: `${SHOTS}/01-toolbar-docked.png` });
  const barBox = await bar.boundingBox();
  // Visible ones only: the header ships a sidebar trigger inside a `md:hidden`
  // wrapper, which is first in the DOM and has no box on a desktop viewport.
  const headerButtons = page.locator("header button:visible");
  const targets = {
    "header search box": page.locator("header input").first(),
    "notification bell": headerButtons.first(),
    "account menu": headerButtons.nth(1),
  };
  for (const [name, loc] of Object.entries(targets)) {
    const box = await loc.boundingBox().catch(() => null);
    if (!box) {
      bad(`${name} found`, "not on screen at all");
      continue;
    }
    if (overlaps(barBox, box)) bad(`${name} is not covered`, JSON.stringify({ barBox, box }));
    else ok(`${name} is not covered`);
  }
  const header = await page.locator("header").first().boundingBox();
  if (barBox && header && barBox.y >= header.y + header.height - 1)
    ok("toolbar sits below the header");
  else bad("toolbar sits below the header", JSON.stringify({ barBox, header }));

  /* ------------------------------------------------ it also has to stay put */
  /*
   * Sticky, checked as sticky rather than as "still near the top". A project
   * with one photo cannot scroll far enough for the bar to reach its 82px
   * threshold, and asserting a fixed y there would fail on correct behaviour.
   * So: remember where the bar sits in the document, scroll, and expect exactly
   * what `position: sticky` promises - the natural position, floored at 82.
   */
  const docTop = (await bar.boundingBox()).y + (await page.evaluate(() => window.scrollY));
  await page.mouse.move(760, 700);
  await page.mouse.wheel(0, 1600);
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.scrollY);
  const want = Math.max(82, docTop - after);
  const got = (await bar.boundingBox()).y;
  if (Math.abs(got - want) <= 2)
    ok(
      "toolbar sticks where sticky says it should",
      `scrollY=${Math.round(after)} y=${Math.round(got)}`,
    );
  else
    bad(
      "toolbar sticks where sticky says it should",
      `want ${Math.round(want)}, got ${Math.round(got)}, scrollY ${Math.round(after)}`,
    );
  await page.screenshot({ path: `${SHOTS}/02-toolbar-scrolled.png` });

  /* ----------------------------------------------------------------- Share */
  await bar.getByRole("button", { name: "Share" }).click();
  await page.waitForTimeout(2500);
  const dialog = page.locator('[role="dialog"]').first();
  if (await dialog.isVisible().catch(() => false)) {
    ok("Share opens a dialog", (await dialog.innerText()).split("\n")[0]);
    await page.screenshot({ path: `${SHOTS}/03-share-dialog.png` });
  } else {
    bad("Share opens a dialog", "nothing appeared");
    await page.screenshot({ path: `${SHOTS}/03-share-missing.png` });
  }
  const spinning = await bar
    .getByRole("button", { name: "Share" })
    .locator(".animate-spin")
    .count();
  if (spinning === 0) ok("Share button is not left spinning");
  else bad("Share button is not left spinning", `${spinning} spinner(s)`);
  /*
   * Escape must close the dialog and leave the selection alone. This is the one
   * check here that no source test can stand in for: the old guard read
   * correctly and behaved wrongly, because it ran in the bubble phase after
   * Radix had already unmounted the dialog. Closing by the X button always
   * worked, so only the key press proves it.
   */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  const dialogGone = !(await page
    .locator('[role="dialog"]')
    .first()
    .isVisible()
    .catch(() => false));
  const barSurvived = await bar.isVisible().catch(() => false);
  if (dialogGone && barSurvived) ok("Escape closes the dialog without clearing the selection");
  else
    bad(
      "Escape closes the dialog without clearing the selection",
      JSON.stringify({ dialogGone, barSurvived }),
    );

  /* ------------------------------------------------------------------ Move */
  await bar.getByRole("button", { name: "Move" }).click();
  await page.waitForTimeout(3000);
  const move = page.locator('[role="dialog"]').first();
  if (await move.isVisible().catch(() => false)) {
    const rows = await move.locator("button").allInnerTexts();
    const names = rows.map((r) => r.trim()).filter((r) => r && !/^(Cancel|Move photos)$/.test(r));
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length === 0) ok("Move picker has no duplicate rows", `${names.length} destinations`);
    else bad("Move picker has no duplicate rows", `repeated: ${[...new Set(dupes)].join(" | ")}`);
    await page.screenshot({ path: `${SHOTS}/04-move-picker.png` });
  } else {
    bad("Move opens a dialog", "nothing appeared");
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);

  /* --------------------------------------------------------------- tidy up */
  await bar
    .getByRole("button", { name: "Clear selection" })
    .click()
    .catch(() => {});
  await page.waitForTimeout(600);
  if (!(await bar.isVisible().catch(() => false))) ok("Clear puts the toolbar away");
  else bad("Clear puts the toolbar away");

  await browser.close();
};

run()
  .catch((e) => bad("run", String(e)))
  .finally(() => {
    const failed = checks.filter((c) => !c.pass);
    for (const c of checks)
      console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  ${c.detail}` : ""}`);
    console.log(
      `\n${checks.length - failed.length}/${checks.length} passed. Screenshots in ${SHOTS}/`,
    );
    process.exit(failed.length ? 1 : 0);
  });
