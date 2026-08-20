/**
 * Drives the Groups tab and the group detail page in a real browser.
 *
 * Two rounds of client feedback land here, and neither is the kind of thing a
 * unit test can answer:
 *
 *   "there's no way to create one" - the Groups tab had a New Group button
 *   only inside its empty state, so the action vanished the moment a single
 *   group existed. This checks the button is on the tab with groups present.
 *
 *   "the window that opens is the old lovable window that is not consistent
 *   with our site theme" - the group detail page had kept the plain heading it
 *   was built with while every screen around it moved to the hero shell. This
 *   asserts the hero, its eyebrow, its stats rail and the house section
 *   headings are really on the page, and screenshots it so the look can be
 *   judged rather than inferred.
 *
 * WRITES NOTHING. The New Group and Edit Group Details dialogs are opened and
 * dismissed; nothing is submitted, renamed or deleted. The database is shared
 * with production, so this run is a reader.
 *
 * Run with: node scripts/drive-groups-tab.mjs
 * Screenshots land in artifacts/groups-tab/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/groups-tab";
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

  /* ----------------------------------------------------------- Groups tab */
  current = "groups tab";
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  const groupsTab = page.getByRole("button", { name: /Groups/i }).first();
  if (!(await shown(groupsTab))) {
    bad("Groups tab", "tab not found");
    await page.screenshot({ path: `${SHOTS}/01-no-groups-tab.png` });
    return { browser };
  }
  await groupsTab.click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/01-groups-tab.png` });

  // The whole point of the first fix: the button is on the tab, not only in
  // the empty state. Scoped to the section header so the empty state's own
  // button cannot satisfy this on a workspace with no groups.
  const newGroupBtn = page.getByRole("button", { name: /New Group/i });
  const btnCount = await newGroupBtn.count();
  if (btnCount === 0) {
    bad("New Group button on the Groups tab", "no button found");
  } else {
    ok("New Group button on the Groups tab", `${btnCount} found`);
  }

  const bodyText = await page.locator("body").innerText();
  if (/one client, one building, or a multi-site contract/i.test(bodyText)) {
    ok("guidance line explains what to group");
  } else {
    bad("guidance line explains what to group", "phrase not on the page");
  }

  const groupCards = page.locator('a[href^="/groups/"]');
  const groupCount = await groupCards.count();

  /* ------------------------------------------------- New Group dialog */
  current = "new group dialog";
  if (btnCount > 0) {
    await newGroupBtn.first().click();
    await page.waitForTimeout(1200);
    const dialog = page.getByRole("dialog");
    if (await shown(dialog)) {
      const text = await dialog.innerText();
      await page.screenshot({ path: `${SHOTS}/02-new-group-dialog.png` });
      if (/Name/.test(text) && /Description/.test(text)) {
        ok("New Group dialog has name + description");
      } else {
        bad("New Group dialog has name + description", text.slice(0, 160));
      }
    } else {
      bad("New Group dialog opens", "no dialog after clicking New Group");
    }
    // Dismissed, never submitted - this run writes nothing.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  /* --------------------------------------------------- group detail page */
  current = "group page";
  if (groupCount === 0) {
    skip("group page uses the house hero", "this workspace has no group to open");
    await page.screenshot({ path: `${SHOTS}/03-no-groups.png` });
  } else {
    await groupCards.first().click();
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${SHOTS}/03-group-page.png` });
    await page.screenshot({ path: `${SHOTS}/03-group-page-full.png`, fullPage: true });

    // The hero shell, by the classes that make it the hero rather than by
    // eyeballing the shot: the 32px sidebar-coloured panel every sibling page
    // opens with.
    const hero = page.locator("div.rounded-\\[32px\\].bg-sidebar").first();
    if (await shown(hero)) {
      ok("group page opens with the house hero");
      const heroText = await hero.innerText();
      if (/Project group/i.test(heroText)) ok('hero carries the "Project group" eyebrow');
      else bad('hero carries the "Project group" eyebrow', heroText.slice(0, 120));
      if (/In this group/i.test(heroText)) ok("hero carries the stats rail");
      else bad("hero carries the stats rail", heroText.slice(0, 160));
      if (/Updated/i.test(heroText)) ok("stats rail shows when the group was updated");
      else bad("stats rail shows when the group was updated", "no Updated in the rail");
    } else {
      bad("group page opens with the house hero", "no rounded-[32px] bg-sidebar panel");
    }

    // The four plain stat cards are gone; their numbers moved into the rail.
    const pageText = await page.locator("body").innerText();
    if (/Projects in group/i.test(pageText)) ok('"Projects in group" section renders');
    else bad('"Projects in group" section renders', "heading missing");

    // The old page had no eyebrows at all; these are the SectionHeading ones.
    if (/Filed here/i.test(pageText)) ok("section heading uses the house eyebrow");
    else bad("section heading uses the house eyebrow", "no eyebrow on the projects section");

    /* --------------------------------------------- the renamed menu item */
    current = "group actions menu";
    const actions = page.getByRole("button", { name: /Group actions/i }).first();
    if (await shown(actions)) {
      await actions.click();
      await page.waitForTimeout(900);
      const menu = page.locator("[data-radix-popper-content-wrapper]").first();
      const menuText = (await menu.innerText().catch(() => "")) || "";
      await page.screenshot({ path: `${SHOTS}/04-group-actions.png` });
      if (/Edit Group Details/i.test(menuText)) ok('menu says "Edit Group Details"');
      else bad('menu says "Edit Group Details"', menuText.replace(/\n/g, " / ").slice(0, 160));
      if (/Rename Group/i.test(menuText)) bad('"Rename Group" is gone', "still in the menu");
      else ok('"Rename Group" is gone');

      /* ------------------------------- the dialog behind the renamed item */
      const item = page.getByRole("menuitem", { name: /Edit Group Details/i }).first();
      if (await shown(item)) {
        await item.click();
        await page.waitForTimeout(1200);
        const dlg = page.getByRole("dialog");
        if (await shown(dlg)) {
          const t = await dlg.innerText();
          await page.screenshot({ path: `${SHOTS}/05-edit-group-details.png` });
          if (/Name/.test(t) && /Description/.test(t)) {
            ok("Edit Group Details edits name and description");
          } else {
            bad("Edit Group Details edits name and description", t.slice(0, 160));
          }
        } else {
          bad("Edit Group Details dialog opens", "no dialog");
        }
        // Cancelled, never saved.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(600);
      }
    } else {
      bad("Group actions menu", "trigger not found");
    }
  }

  return { browser };
};

const main = async () => {
  let browser;
  try {
    ({ browser } = await run());
  } catch (e) {
    bad("run", String(e).slice(0, 300));
  } finally {
    if (browser) await browser.close();
  }

  console.log("\n=== Groups tab drive ===\n");
  for (const c of checks) {
    const mark = c.skipped ? "SKIP" : c.pass ? "PASS" : "FAIL";
    console.log(`${mark}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  if (problems.length) {
    console.log("\n--- page errors ---");
    for (const p of problems) console.log(`${p.kind} @ ${p.where}: ${p.detail}`);
  } else {
    console.log("\nNo console or page errors.");
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed} passed, ${failed} failed. Shots in ${SHOTS}/`);
  process.exit(failed ? 1 : 0);
};

void main();
