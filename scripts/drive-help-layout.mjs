/**
 * Drives the Knowledge base page after the layout change: the page used to sit
 * hard against the left edge with a third of a wide window empty, and now
 * centres with a sticky category rail in the space that was blank.
 *
 * Measures rather than eyeballs: the gap either side of the page shell, whether
 * the rail is present per breakpoint, whether it actually sticks under the 82px
 * header, whether jump links land the section clear of that header, and whether
 * the current-section marker follows the scroll.
 *
 * WRITES NOTHING - every non-GET to the API is blocked at the network layer.
 *
 * Run with: node scripts/drive-help-layout.mjs
 * Screenshots land in artifacts/help-layout/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/help-layout";
mkdirSync(SHOTS, { recursive: true });

const env = (p) => {
  const out = {};
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
};

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

// The page shell, the reading column and the rail, measured against the width
// the app actually gives the page (everything right of the sidebar).
const measure = (page) =>
  page.evaluate(() => {
    const main = document.querySelector("main");
    const shell = main?.querySelector("div");
    const grid = shell?.querySelector(".grid");
    const rail = document.querySelector('nav[aria-label="Help categories"]');
    const r = (el) => (el ? el.getBoundingClientRect() : null);
    const mr = r(main);
    const sr = r(shell);
    const rr = r(rail);
    const cr = r(grid?.firstElementChild);
    return {
      main: mr && { left: Math.round(mr.left), right: Math.round(mr.right) },
      shell: sr && { left: Math.round(sr.left), right: Math.round(sr.right) },
      gapLeft: mr && sr ? Math.round(sr.left - mr.left) : null,
      gapRight: mr && sr ? Math.round(mr.right - sr.right) : null,
      gridCols: grid ? getComputedStyle(grid).gridTemplateColumns : null,
      colWidth: cr ? Math.round(cr.width) : null,
      railVisible: !!rr && rr.width > 0,
      railWidth: rr ? Math.round(rr.width) : 0,
      railTop: rr ? Math.round(rr.top) : null,
      railPosition: rail ? getComputedStyle(rail).position : null,
      railLinks: document.querySelectorAll('nav[aria-label="Help categories"] a').length,
      // The widest thing on the page tells us if anything overflows sideways.
      docScrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });

const activeRailLabel = (page) =>
  page.evaluate(() => {
    const a = document.querySelector('nav[aria-label="Help categories"] a.border-primary');
    return a ? a.textContent.trim().replace(/\s+/g, " ") : null;
  });

const run = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1640, height: 950 } });
  const page = await ctx.newPage();

  await page.route(/\/rest\/v1\//, async (route) => {
    const m = route.request().method();
    if (m !== "GET" && m !== "HEAD") {
      console.log(`BLOCKED a ${m} to ${route.request().url().slice(0, 90)}`);
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    }
    return route.continue();
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
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
  if (/\/login/.test(new URL(page.url()).pathname)) {
    bad("login", "still on /login");
    await browser.close();
    return;
  }
  ok("login");

  await page.goto(`${BASE}/help`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("text=Knowledge base", { timeout: 60000 });
  await page.waitForTimeout(2500);

  // 1. The reported width, 1640. Centred, rail present, nothing overflowing.
  const wide = await measure(page);
  console.log("1640:", JSON.stringify(wide));
  await page.screenshot({ path: `${SHOTS}/01-1640-top.png` });
  if (wide.gapLeft === null) bad("1640 shell", "shell not found");
  else if (Math.abs(wide.gapLeft - wide.gapRight) <= 2)
    ok("1640 centred", `${wide.gapLeft}px each side`);
  else bad("1640 centred", `left ${wide.gapLeft} vs right ${wide.gapRight}`);
  if (wide.railVisible && wide.railLinks > 0)
    ok("1640 rail", `${wide.railWidth}px, ${wide.railLinks} links`);
  else bad("1640 rail", `visible=${wide.railVisible} links=${wide.railLinks}`);
  if (wide.colWidth >= 600 && wide.colWidth <= 900) ok("1640 reading column", `${wide.colWidth}px`);
  else bad("1640 reading column", `${wide.colWidth}px is outside a comfortable range`);
  if (wide.docScrollW <= wide.clientW) ok("1640 no sideways overflow");
  else bad("1640 no sideways overflow", `scrollW ${wide.docScrollW} > clientW ${wide.clientW}`);

  // 2. The rail has to stay under the 82px header while the page scrolls.
  await page.evaluate(() => window.scrollTo(0, 1800));
  await page.waitForTimeout(1200);
  const scrolled = await measure(page);
  console.log("scrolled:", JSON.stringify(scrolled));
  await page.screenshot({ path: `${SHOTS}/02-1640-scrolled.png` });
  if (scrolled.railTop !== null && scrolled.railTop >= 90 && scrolled.railTop <= 110)
    ok("rail sticks", `top ${scrolled.railTop}px, clear of the 82px header`);
  else bad("rail sticks", `top ${scrolled.railTop}px`);
  const active = await activeRailLabel(page);
  if (active) ok("current section marked", active);
  else bad("current section marked", "no highlighted rail row");

  // 3. A jump link has to land the heading below the header, not under it.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(600);
  await page.click('nav[aria-label="Help categories"] a[href="#reports"]');
  await page.waitForTimeout(1500);
  const jump = await page.evaluate(() => {
    const el = document.getElementById("reports");
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  });
  await page.screenshot({ path: `${SHOTS}/03-jump-to-reports.png` });
  if (jump !== null && jump >= 82) ok("jump link clears the header", `section top ${jump}px`);
  else bad("jump link clears the header", `section top ${jump}px`);
  const afterJump = await activeRailLabel(page);
  if (afterJump && /Reports/i.test(afterJump)) ok("jump marks its rail row", afterJump);
  else bad("jump marks its rail row", String(afterJump));

  // 4. Search filters the rail as well as the list.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.fill('input[aria-label="Search help topics"]', "blueprint");
  await page.waitForTimeout(1500);
  const filtered = await measure(page);
  await page.screenshot({ path: `${SHOTS}/04-search-blueprint.png` });
  if (filtered.railLinks > 0 && filtered.railLinks < wide.railLinks)
    ok("rail follows search", `${wide.railLinks} -> ${filtered.railLinks} categories`);
  else bad("rail follows search", `${wide.railLinks} -> ${filtered.railLinks}`);
  await page.fill('input[aria-label="Search help topics"]', "");
  await page.waitForTimeout(1200);

  // 5. Other widths. Below xl the rail goes away and the page is one column.
  for (const width of [1920, 1440, 1279, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 950 });
    await page.waitForTimeout(1200);
    const m = await measure(page);
    console.log(`${width}:`, JSON.stringify(m));
    await page.screenshot({ path: `${SHOTS}/05-w${width}.png` });
    const expectRail = width >= 1280;
    if (m.railVisible === expectRail) ok(`w${width} rail ${expectRail ? "shown" : "hidden"}`);
    else bad(`w${width} rail`, `visible=${m.railVisible}, expected ${expectRail}`);
    if (m.docScrollW <= m.clientW + 1) ok(`w${width} no sideways overflow`);
    else bad(`w${width} no sideways overflow`, `${m.docScrollW} > ${m.clientW}`);
  }

  await browser.close();
  console.log("\n--- checks ---");
  for (const c of checks) console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}  ${c.detail}`);
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exit(failed ? 1 : 0);
};

run();
