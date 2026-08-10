import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:8080";
const env = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.waitForSelector('button[type="submit"]', { state: "visible" });
await page.fill('input[type="email"]', env.email);
await page.fill('input[type="password"]', env.password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 });
await page.waitForTimeout(4000);

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

const info = await page.evaluate(() => {
  const titleInput = document.querySelector('input[aria-label="Template name"]');
  let bar = titleInput?.parentElement ?? null;
  while (bar && getComputedStyle(bar).position !== "sticky") bar = bar.parentElement;

  // Walk every ancestor of the bar and report which ones can scroll.
  const chain = [];
  let n = bar?.parentElement ?? null;
  while (n && n !== document.documentElement) {
    const s = getComputedStyle(n);
    chain.push({
      tag: n.tagName.toLowerCase(),
      cls: n.className.toString().slice(0, 60),
      overflowY: s.overflowY,
      position: s.position,
      scrolls: n.scrollHeight > n.clientHeight + 1,
      rectTop: Math.round(n.getBoundingClientRect().top),
      clientH: n.clientHeight,
      scrollH: n.scrollHeight,
    });
    n = n.parentElement;
  }

  const main = document.querySelector("main");
  return {
    doc: {
      scrollY: Math.round(window.scrollY),
      innerH: window.innerHeight,
      bodyScrollH: document.body.scrollHeight,
      docScrollH: document.documentElement.scrollHeight,
      windowCanScroll: document.documentElement.scrollHeight > window.innerHeight + 1,
    },
    main: main
      ? {
          overflowY: getComputedStyle(main).overflowY,
          rectTop: Math.round(main.getBoundingClientRect().top),
          clientH: main.clientHeight,
          scrollH: main.scrollHeight,
          scrolls: main.scrollHeight > main.clientHeight + 1,
          scrollTop: main.scrollTop,
        }
      : null,
    barTop: bar ? Math.round(bar.getBoundingClientRect().top) : null,
    barStickyTop: bar ? getComputedStyle(bar).top : null,
    ancestors: chain.filter(
      (c) => c.overflowY !== "visible" || c.scrolls || c.position !== "static",
    ),
  };
});

console.log(JSON.stringify(info, null, 2));

// clean up
try {
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
  await page.waitForTimeout(2500);
} catch {}
await browser.close();
