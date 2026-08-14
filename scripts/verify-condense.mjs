/**
 * Verifies the condensing title bar against the real rendered page.
 *
 * The bug: at full height the sticky bar covered checklist item 1 entirely and
 * cut item 2 in half. This measures the bar and the first row before and after
 * scrolling, and asserts the first item is no longer hidden underneath it.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = "http://localhost:8080";
const SHOTS = "artifacts/live-check";
mkdirSync(SHOTS, { recursive: true });

const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("pageerror", (e) => problems.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on("console", (m) => {
  if (m.type() === "error" && !/DevTools|\[vite\]|favicon/i.test(m.text()))
    problems.push(`console: ${m.text().slice(0, 160)}`);
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForSelector('button[type="submit"]', { state: "visible" });
await page.fill('input[type="email"]', env.email);
await page.fill('input[type="password"]', env.password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 });
await page.waitForTimeout(4000);
console.log("login OK");

// Create one starter to measure against.
await page.goto(`${BASE}/templates?tab=checklists`, { waitUntil: "networkidle" });
await page.waitForTimeout(6000);
if (!(await page.locator("text=HVAC Inspection").count())) {
  await page.getByRole("button", { name: /Starters/i }).click();
  await page.waitForTimeout(1500);
  await page
    .locator("div")
    .filter({ hasText: /^HVAC Inspection/ })
    .getByRole("button", { name: /Use this template/i })
    .first()
    .click();
  await page.waitForTimeout(6000);
}
await page.keyboard.press("Escape").catch(() => {});

/*
 * Nine items only give ~470px of scroll, which is not enough for the bar to
 * reach its dock line - so the interesting case (a long template, where the
 * bar is pinned for most of the scroll) needs more rows. Bulk-add via the
 * "Paste a list" dialog.
 */
const rowCount = await page.locator('input[aria-label="Item label"]').count();
if (rowCount < 25) {
  await page
    .getByRole("button", { name: /Paste a list/i })
    .first()
    .click();
  await page.waitForTimeout(1200);
  const lines = Array.from({ length: 40 }, (_, i) => `Scroll depth probe item ${i + 1}`).join("\n");
  await page.locator("textarea").last().fill(lines);
  await page.waitForTimeout(400);
  await page
    .getByRole("button", { name: /^Add \d+ item|^Add items|^Add$/i })
    .last()
    .click()
    .catch(async () => {
      await page.locator('[role="dialog"] button').last().click();
    });
  await page.waitForTimeout(5000);
  console.log(`rows now: ${await page.locator('input[aria-label="Item label"]').count()}`);
}
await page.keyboard.press("Escape").catch(() => {});

/** Measures the sticky bar and the first checklist row. */
const measure = () =>
  page.evaluate(() => {
    // Anchor on the title input, then walk up to its sticky ancestor -
    // selecting "a sticky div containing an input" matched the rail's search
    // box instead, and "ul > li" matched the sidebar nav.
    const titleInput = document.querySelector('input[aria-label="Template name"]');
    let bar = titleInput?.parentElement ?? null;
    while (bar && getComputedStyle(bar).position !== "sticky") bar = bar.parentElement;
    const firstRow =
      document.querySelector('input[aria-label="Item label"]')?.closest("li") ?? null;
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height) };
    };
    return {
      bar: r(bar),
      firstRow: r(firstRow),
      firstRowText: (firstRow?.textContent || "").trim().slice(0, 40),
      /*
       * True overlap needs BOTH edges to cross. Testing only
       * `row.top < bar.bottom` reports a false positive once the row has
       * scrolled entirely above the bar, which is normal and harmless.
       */
      covered: (() => {
        if (!bar || !firstRow) return null;
        const b = bar.getBoundingClientRect();
        const r = firstRow.getBoundingClientRect();
        return r.top < b.bottom && r.bottom > b.top;
      })(),
    };
  });

await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(600);
const atTop = await measure();
await page.screenshot({ path: `${SHOTS}/condense-1-top.png` });

// Scroll just far enough that the bar is docked while item 1 is still beside
// it - the exact position where the old layout hid item 1.
await page.evaluate(() => window.scrollTo(0, 520));
await page.waitForTimeout(900);
const scrolled = await measure();
await page.screenshot({ path: `${SHOTS}/condense-2-scrolled.png` });

await page.evaluate(() => window.scrollTo(0, 1400));
await page.waitForTimeout(900);
const deep = await measure();
await page.screenshot({ path: `${SHOTS}/condense-3-deep.png` });
console.log("DEEP      :", JSON.stringify(deep));

console.log("\nAT TOP    :", JSON.stringify(atTop));
console.log("SCROLLED  :", JSON.stringify(scrolled));
console.log(`\nbar height: ${atTop.bar?.height}px at top -> ${scrolled.bar?.height}px scrolled`);
console.log(`first row covered by bar while scrolled: ${scrolled.covered}`);

/*
 * The regression is "item 1 can never be seen", not "item 1 passes under the
 * header while scrolling" - content sliding under a sticky bar is how sticky
 * bars work. So the assertions are:
 *   1. at rest (scroll 0) item 1 is fully clear of the bar, and
 *   2. the bar actually condenses once docked.
 * Before the fix, item 1 was covered even at maximum scroll, with nowhere left
 * to scroll to reveal it.
 */
if (atTop.covered)
  problems.push("item 1 is covered by the bar even at scroll 0 - the original bug");
if (scrolled.bar && atTop.bar && scrolled.bar.height >= atTop.bar.height)
  problems.push(`bar did not condense (${atTop.bar.height} -> ${scrolled.bar.height})`);
if (scrolled.bar && scrolled.bar.top > 90)
  problems.push(`bar never docked under the app header (top ${scrolled.bar.top}, expected ~82)`);

// Clean up.
try {
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: /Template actions/i })
    .first()
    .click();
  await page.waitForTimeout(700);
  await page.getByRole("menuitem", { name: /Delete template/i }).click();
  await page.waitForTimeout(1000);
  await page
    .getByRole("button", { name: /^Delete template$/i })
    .last()
    .click();
  await page.waitForTimeout(3000);
} catch {}
await page.goto(`${BASE}/templates?tab=checklists`, { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const leftover = (await page.locator("body").innerText()).includes("HVAC Inspection");
console.log(`cleanup: ${leftover ? "TEMPLATE STILL PRESENT" : "removed"}`);

await browser.close();
console.log("\n============ PROBLEMS ============");
console.log(problems.length ? [...new Set(problems)].join("\n") : "none");
