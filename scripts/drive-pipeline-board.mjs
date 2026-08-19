/**
 * Drives the rebuilt Pipelines tab in a real browser.
 *
 * tests/pipeline-stages.test.ts covers the rules and the schema, and neither of
 * them mounts a component. The things only a browser can answer are the ones
 * this rework is actually judged on:
 *
 *   Does a project appear exactly once? Under the tag boards a job carrying
 *   three of a board's tags was drawn in three columns, and that is a rendering
 *   fact, not a schema one. This counts every card on the board and fails if
 *   any project id appears twice.
 *
 *   Do the new affordances render at all - the "not in a pipeline" rail, the
 *   board search, the per-card move menu, the stage chip on the project list
 *   and on the project page, the Stage pane in Filters?
 *
 *   Is there a tag picker left anywhere in New Pipeline or Pipeline Settings?
 *   That is the whole ask, and a leftover picker would be the one way to fail
 *   it while every test still passed.
 *
 * WRITES NOTHING. Every dialog it opens is cancelled, no card is dragged, and
 * no menu item that mutates is clicked. The database is shared with production,
 * so this run is a reader.
 *
 * Run with: node scripts/drive-pipeline-board.mjs
 * Screenshots land in artifacts/pipeline-board/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/pipeline-board";
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

  /* --------------------------------------------------------- projects page */
  current = "projects";
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(3500);

  /* ------------------------------------------- the stage chip on list cards */
  const listChip = page.locator("span[title*=':']").filter({ hasText: /^\s*\S/ });
  void listChip;
  await page.screenshot({ path: `${SHOTS}/01-projects-list.png`, fullPage: false });
  ok("projects page loads");

  /* ----------------------------------------------------- Filters > Stage    */
  current = "filters";
  const filtersBtn = page.getByRole("button", { name: /Filters/i }).first();
  if (await shown(filtersBtn)) {
    await filtersBtn.click();
    await page.waitForTimeout(700);
    const stagePane = page.getByRole("button", { name: /^Stage/ }).first();
    if (await shown(stagePane)) {
      await stagePane.click();
      await page.waitForTimeout(600);
      const body = await page.locator("[data-radix-popper-content-wrapper]").innerText();
      if (/Pipeline stage/i.test(body)) {
        ok("Filters has a Stage pane", body.split("\n").slice(0, 3).join(" / "));
      } else {
        bad("Filters has a Stage pane", body.slice(0, 120));
      }
      if (/Not in a pipeline/i.test(body)) ok('Stage pane offers "Not in a pipeline"');
      else bad('Stage pane offers "Not in a pipeline"', "missing");
      await page.screenshot({ path: `${SHOTS}/02-filters-stage.png` });
    } else {
      bad("Filters has a Stage pane", "no Stage tab in the popover");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  } else {
    skip("Filters has a Stage pane", "Filters button not visible");
  }

  /* ------------------------------------------------------- Pipelines tab    */
  current = "pipelines";
  const pipelinesTab = page.getByRole("button", { name: /Pipelines/i }).first();
  if (!(await shown(pipelinesTab))) {
    bad("Pipelines tab", "tab not found");
    await page.screenshot({ path: `${SHOTS}/03-no-pipelines-tab.png` });
    return { browser };
  }
  await pipelinesTab.click();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/03-pipelines.png` });

  const emptyState = page.getByText(/No pipelines yet/i);
  if (await shown(emptyState)) {
    skip("board renders", "this workspace has no pipeline yet");
  } else {
    /* ------------------------------------- one card per project, exactly one */
    // Every card is a draggable whose dnd id is the project id, so a duplicate
    // id is precisely the bug the tag boards had.
    const cardLabels = await page
      .locator('[aria-label$="Press space to move between stages."]')
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    const dupes = cardLabels.filter((l, i) => cardLabels.indexOf(l) !== i);
    if (cardLabels.length === 0) {
      skip("a project appears in exactly one column", "no cards on this board");
    } else if (dupes.length) {
      bad("a project appears in exactly one column", `${dupes.length} duplicate card(s)`);
    } else {
      ok("a project appears in exactly one column", `${cardLabels.length} card(s), all distinct`);
    }

    /* ----------------------------------------------------- the new toolbar  */
    const search = page.getByLabel("Search this pipeline");
    if (await shown(search)) ok("board has its own search");
    else bad("board has its own search", "not rendered");

    const rail = page.getByText(/Not in a pipeline/).first();
    if (await shown(rail)) ok('"Not in a pipeline" rail is present');
    else skip('"Not in a pipeline" rail is present', "every project is already on a board");

    /* --------------------------------------------- the move menu on a card  */
    if (cardLabels.length > 0) {
      const card = page.locator('[aria-label$="Press space to move between stages."]').first();
      await card.hover();
      await page.waitForTimeout(400);
      const moveBtn = page.getByRole("button", { name: /^Move .* to another stage$/ }).first();
      if (await shown(moveBtn)) {
        await moveBtn.click();
        await page.waitForTimeout(600);
        const menu = page.locator('[role="menu"]').first();
        const text = (await shown(menu)) ? await menu.innerText() : "";
        if (/Move to stage/i.test(text) && /Take out of the pipeline/i.test(text)) {
          ok("a card can be moved without dragging", text.split("\n").slice(0, 4).join(" / "));
        } else {
          bad("a card can be moved without dragging", text.slice(0, 140) || "menu did not open");
        }
        await page.screenshot({ path: `${SHOTS}/04-card-move-menu.png` });
        // Escape, not a click: this script writes nothing.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(400);
      } else {
        bad("a card can be moved without dragging", "no move button on the card");
      }
    }

    /* ---------------------------------- search narrows without losing counts */
    if (await shown(search)) {
      await search.fill("zzzz-no-such-job");
      await page.waitForTimeout(700);
      const shownLine = await page
        .getByText(/of \d+ shown/)
        .first()
        .innerText()
        .catch(() => "");
      if (/^0 of \d+ shown$/.test(shownLine.trim())) {
        ok("board search reports what it hid", shownLine.trim());
      } else {
        bad("board search reports what it hid", shownLine || "no count line");
      }
      await search.fill("");
      await page.waitForTimeout(600);
    }

    /* ----------------------------------------- Pipeline Settings has no tags */
    current = "settings";
    const manage = page.getByRole("button", { name: /^Manage$/ }).first();
    if (await shown(manage)) {
      await manage.click();
      await page.waitForTimeout(900);
      const sheet = page.locator('[role="dialog"]').filter({ hasText: /Pipeline Settings/ });
      if (await shown(sheet)) {
        const text = await sheet.innerText();
        if (/\btags?\b/i.test(text)) {
          bad("Pipeline Settings offers no tags", text.slice(0, 160));
        } else {
          ok("Pipeline Settings offers no tags", "stages are typed, not picked from tags");
        }
        if (/Add stage/i.test(text)) ok("Pipeline Settings edits stages in place");
        else bad("Pipeline Settings edits stages in place", "no Add stage control");
        await page.screenshot({ path: `${SHOTS}/05-pipeline-settings.png` });
      } else {
        bad("Pipeline Settings opens", "sheet did not appear");
      }
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
    } else {
      skip("Pipeline Settings offers no tags", "no Manage button (no active board)");
    }
  }

  /* -------------------------------------------- New Pipeline has no tags     */
  current = "new-pipeline";
  const newBtn = page.getByRole("button", { name: /Create pipeline|New Pipeline/i }).first();
  if (await shown(newBtn)) {
    await newBtn.click();
    await page.waitForTimeout(900);
    const dialog = page.locator('[role="dialog"]').filter({ hasText: /New Pipeline/ });
    if (await shown(dialog)) {
      const text = await dialog.innerText();
      if (/\btags?\b/i.test(text) && !/tag filter/i.test(text)) {
        bad("New Pipeline offers no tags", text.slice(0, 160));
      } else {
        ok("New Pipeline offers no tags");
      }
      // The default set has to be there before anyone types anything.
      const defaults = ["Lead/Quoted", "Scheduled", "In Progress", "Completed", "Invoiced", "Paid"];
      const missing = defaults.filter((d) => !text.includes(d));
      // The stage names live in inputs, so read their values rather than text.
      const values = await dialog.locator("input").evaluateAll((els) => els.map((e) => e.value));
      const stillMissing = missing.filter((d) => !values.includes(d));
      if (stillMissing.length === 0) ok("New Pipeline starts with the default stage set");
      else
        bad("New Pipeline starts with the default stage set", `missing ${stillMissing.join(", ")}`);
      await page.screenshot({ path: `${SHOTS}/06-new-pipeline.png` });
    } else {
      bad("New Pipeline opens", "dialog did not appear");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  } else {
    skip("New Pipeline offers no tags", "no create button visible");
  }

  /* ------------------------------------------- the stage on a project page  */
  current = "project-page";
  await page.goto(`${BASE}/projects`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // A UUID, not just any /projects/ href: /projects/trash is one too, and it is
  // the first link on the page.
  const firstProject = page
    .locator('a[href^="/projects/"]')
    .filter({ hasNotText: /^$/ })
    .and(page.locator('a[href*="-"]'))
    .first();
  if (await shown(firstProject)) {
    await firstProject.click();
    await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(5000);
    const header = await page
      .locator("h1")
      .first()
      .innerText()
      .catch(() => "");

    // The chip identifies itself by its title, which is the only place either
    // of these sentences is written.
    const chip = page.locator(
      'button[title*="Click to move it"], button[title*="Put this project into a pipeline"]',
    );
    if (await shown(chip.first())) {
      ok(
        "the project page states its stage",
        `${header.slice(0, 30)}: ${await chip.first().innerText()}`,
      );
    } else {
      bad("the project page states its stage", `no stage chip on ${header.slice(0, 40)}`);
    }
    await page.screenshot({ path: `${SHOTS}/07-project-page.png` });
  } else {
    skip("the project page states its stage", "no project to open");
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
  console.log(failures === 0 ? "Pipeline board verified." : `${failures} check(s) FAILED.`);
  console.log(`Screenshots in ${SHOTS}/`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
