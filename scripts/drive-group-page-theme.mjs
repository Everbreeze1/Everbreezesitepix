/**
 * Drives the restyled group detail page in a real browser.
 *
 * The client's verdict on the previous round was about how the page looks:
 * "when i click on the group the window that opens is the old lovable window
 * that is not consistent with our site theme". GroupPage was the last screen in
 * the projects area still on the plain shadcn shell it was built with, so this
 * checks the house hero really is on the page and screenshots it so the look
 * can be judged rather than inferred.
 *
 * UNLIKE THE OTHER drive-* SCRIPTS, THIS ONE WRITES. A workspace with no group
 * has nothing to open, so it creates one, photographs it and deletes it again.
 * The throwaway is named with the ZZ_PREFIX below so it is obvious in any list,
 * and the delete runs from a finally block so a failed assertion cannot leave it
 * behind. Deleting a group removes the group and its membership rows only; the
 * projects filed under it are untouched.
 *
 * Run with: node scripts/drive-group-page-theme.mjs
 * Screenshots land in artifacts/group-page-theme/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/group-page-theme";
const ZZ_NAME = "zz-theme-check (delete me)";
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

let browser;
let page;
let createdUrl = null;

const shown = (loc) => loc.isVisible().catch(() => false);

/** Deletes the throwaway group through the UI. Runs even when a check fails. */
async function cleanup() {
  if (!createdUrl || !page) return;
  current = "cleanup";
  try {
    await page.goto(createdUrl, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const actions = page.getByRole("button", { name: /Group actions/i }).first();
    if (!(await shown(actions))) {
      bad("cleanup: throwaway group deleted", "actions menu not found - DELETE IT BY HAND");
      return;
    }
    await actions.click();
    await page.waitForTimeout(800);
    await page.getByRole("menuitem", { name: /Delete Group/i }).first().click();
    await page.waitForTimeout(1000);
    // The confirm is an AlertDialog; its action button is the plain "Delete".
    await page.getByRole("button", { name: /^Delete$/ }).first().click();
    await page.waitForTimeout(3000);

    // Confirm it is really gone rather than trusting the click.
    await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2500);
    const groupsTab = page.getByRole("button", { name: /Groups/i }).first();
    if (await shown(groupsTab)) {
      await groupsTab.click();
      await page.waitForTimeout(2500);
    }
    const body = await page.locator("body").innerText();
    if (body.includes(ZZ_NAME)) {
      bad("cleanup: throwaway group deleted", "still listed - DELETE IT BY HAND");
      await page.screenshot({ path: `${SHOTS}/99-cleanup-failed.png` });
    } else {
      ok("cleanup: throwaway group deleted");
      await page.screenshot({ path: `${SHOTS}/98-after-cleanup.png` });
    }
  } catch (e) {
    bad("cleanup: throwaway group deleted", `${String(e).slice(0, 160)} - DELETE IT BY HAND`);
  }
}

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  page = await ctx.newPage();

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
    bad("login", "still on /login");
    return;
  }
  ok("login");

  /* ------------------------------------------------- create the throwaway */
  current = "create group";
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: /Groups/i }).first().click();
  await page.waitForTimeout(2000);

  await page.getByRole("button", { name: /New Group/i }).first().click();
  await page.waitForTimeout(1200);
  await page.locator("#group-name").fill(ZZ_NAME);
  await page.locator("#group-desc").fill("Temporary group for a theme check. Safe to delete.");
  // Give it a project so the page has something to render in its list.
  const firstProject = page.getByRole("dialog").locator('button[role="checkbox"]').first();
  if (await shown(firstProject)) {
    await firstProject.click();
    await page.waitForTimeout(400);
  }
  await page.getByRole("button", { name: /Create Group/i }).first().click();
  await page.waitForTimeout(4000);

  const gate = page.getByText(/Subscribe to create project groups/i);
  if (await shown(gate)) {
    bad("create throwaway group", "blocked by the subscription gate on this account");
    await page.screenshot({ path: `${SHOTS}/01-gated.png` });
    return;
  }

  const card = page.locator('a[href^="/groups/"]').first();
  if (!(await shown(card))) {
    bad("create throwaway group", "no group card after Create Group");
    await page.screenshot({ path: `${SHOTS}/01-create-failed.png` });
    return;
  }
  ok("create throwaway group");
  await page.screenshot({ path: `${SHOTS}/01-groups-tab-with-card.png` });

  /* ------------------------------------------------------ the group page */
  current = "group page";
  await card.click();
  await page.waitForTimeout(1500);
  createdUrl = page.url();
  if (!/\/groups\//.test(createdUrl)) {
    bad("open the group page", `landed on ${createdUrl}`);
    return;
  }
  // The group page fetches its projects, photos, checklists and tasks in one
  // round trip and shows a spinner until it lands, which on a cold cache takes
  // well past any fixed wait worth writing. Wait for the hero itself.
  const heroSel = "div.rounded-\\[32px\\].bg-sidebar";
  await page.waitForSelector(heroSel, { state: "visible", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/02-group-page.png` });
  await page.screenshot({ path: `${SHOTS}/03-group-page-full.png`, fullPage: true });

  // The hero, by the classes that make it the hero: the 32px sidebar-coloured
  // panel every sibling page opens with. The old page had no such element.
  const hero = page.locator("div.rounded-\\[32px\\].bg-sidebar").first();
  if (await shown(hero)) {
    ok("group page opens with the house hero");
    const heroText = await hero.innerText();
    if (/Project group/i.test(heroText)) ok('hero carries the "Project group" eyebrow');
    else bad('hero carries the "Project group" eyebrow', heroText.slice(0, 140));
    if (/In this group/i.test(heroText)) ok("hero carries the stats rail");
    else bad("hero carries the stats rail", heroText.slice(0, 200));
    if (/Updated/i.test(heroText)) ok("stats rail shows the updated time");
    else bad("stats rail shows the updated time", "no Updated in the rail");
    if (/photo/i.test(heroText) && /task/i.test(heroText)) ok("stats rail carries the totals");
    else bad("stats rail carries the totals", heroText.slice(0, 200));
  } else {
    bad("group page opens with the house hero", "no rounded-[32px] bg-sidebar panel");
  }

  const pageText = await page.locator("body").innerText();
  if (/Projects in group/i.test(pageText)) ok('"Projects in group" section renders');
  else bad('"Projects in group" section renders', "heading missing");
  if (/Filed here/i.test(pageText)) ok("section heading uses the house eyebrow");
  else bad("section heading uses the house eyebrow", "no eyebrow on the projects section");

  /* --------------------------------------------------- the renamed action */
  current = "group actions menu";
  const actions = page.getByRole("button", { name: /Group actions/i }).first();
  if (await shown(actions)) {
    await actions.click();
    await page.waitForTimeout(900);
    const menuText =
      (await page
        .locator("[data-radix-popper-content-wrapper]")
        .first()
        .innerText()
        .catch(() => "")) || "";
    await page.screenshot({ path: `${SHOTS}/04-group-actions.png` });
    if (/Edit Group Details/i.test(menuText)) ok('menu says "Edit Group Details"');
    else bad('menu says "Edit Group Details"', menuText.replace(/\n/g, " / ").slice(0, 160));
    if (/Rename Group/i.test(menuText)) bad('"Rename Group" is gone', "still in the menu");
    else ok('"Rename Group" is gone');

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
      // Dismissed, never saved.
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    }
  } else {
    bad("Group actions menu", "trigger not found");
  }
};

const main = async () => {
  try {
    await run();
  } catch (e) {
    bad("run", String(e).slice(0, 300));
  } finally {
    await cleanup();
    if (browser) await browser.close();
  }

  console.log("\n=== Group page theme drive ===\n");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
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
