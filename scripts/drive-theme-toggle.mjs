/**
 * Drives the day / night toggle that now sits in the app header.
 *
 * The client asked for a light/dark switch "somewhere in the header". The theme
 * machinery already existed (ThemeProvider, the `.dark` token block, the
 * Settings > Appearance picker, the marketing SiteHeader button) - the only
 * header without a control was the authenticated AppHeader. This run proves the
 * new button flips the document class, repaints the page, survives a reload,
 * and stays reachable at phone width.
 *
 * WRITES NOTHING - to the database or anywhere else. Supabase writes are blocked
 * at the network layer; the theme lives in localStorage only.
 *
 * Run with: node scripts/drive-theme-toggle.mjs
 * Screenshots land in artifacts/theme-toggle/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/theme-toggle";
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
const expect = (cond, name, detail = "") => (cond ? ok(name, detail) : bad(name, detail));

/** What the browser actually painted, not what the classes claim. */
const readTheme = (page) =>
  page.evaluate(() => ({
    hasDarkClass: document.documentElement.classList.contains("dark"),
    colorScheme: document.documentElement.style.colorScheme,
    stored: localStorage.getItem("sitepix-theme"),
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));

const run = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();

  await page.route(/\/rest\/v1\//, async (route) => {
    const m = route.request().method();
    if (m === "PATCH" || m === "POST" || m === "DELETE" || m === "PUT") {
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

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200));
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + String(e).slice(0, 200)));

  // Start from a known side of the switch so the run is repeatable.
  await page.evaluate(() => localStorage.setItem("sitepix-theme", "light"));
  await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("header", { timeout: 90000 });
  await page.waitForTimeout(3000);

  const toggle = page.getByRole("button", { name: /Switch to (day|night) mode/ });
  const count = await toggle.count();
  expect(count === 1, "toggle is in the header", `count=${count}`);

  const inHeader = await toggle
    .first()
    .evaluate((el) => !!el.closest("header") && el.closest("header").className.includes("sticky"));
  expect(inHeader, "toggle sits inside the sticky app header");

  const before = await readTheme(page);
  expect(before.hasDarkClass === false, "starts in day mode", JSON.stringify(before));
  expect(
    (await toggle.first().getAttribute("aria-label")) === "Switch to night mode",
    "day mode offers night",
  );
  await page.screenshot({ path: `${SHOTS}/01-day.png` });

  await toggle.first().click();
  await page.waitForTimeout(1200);
  const after = await readTheme(page);
  expect(after.hasDarkClass === true, "click paints night mode", JSON.stringify(after));
  expect(after.colorScheme === "dark", "color-scheme follows", after.colorScheme);
  expect(after.stored === "dark", "choice is remembered", String(after.stored));
  expect(
    after.bodyBg !== before.bodyBg,
    "page actually repaints",
    `${before.bodyBg} -> ${after.bodyBg}`,
  );
  expect(
    (await toggle.first().getAttribute("aria-label")) === "Switch to day mode",
    "night mode offers day",
  );
  await page.screenshot({ path: `${SHOTS}/02-night.png` });

  // A reload is where a theme that only lives in React state falls back to light.
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("header", { timeout: 90000 });
  await page.waitForTimeout(3000);
  const reloaded = await readTheme(page);
  expect(reloaded.hasDarkClass === true, "night mode survives a reload", JSON.stringify(reloaded));
  await page.screenshot({ path: `${SHOTS}/03-night-after-reload.png` });

  // The Settings > Appearance picker writes the same key, so it must agree.
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(3000);
  const appearance = page.getByRole("button", { name: /Appearance/i }).first();
  if ((await appearance.count()) > 0) {
    await appearance.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${SHOTS}/04-settings-appearance.png` });
  } else {
    bad("Appearance tab", "not found on /settings");
  }

  // Back to day, from the header, on a different page than we left it on.
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForSelector("header", { timeout: 90000 });
  await page.waitForTimeout(3000);
  /*
   * This workspace has never finished onboarding, so /dashboard opens the "Set
   * up your account" modal on arrival. Radix marks everything behind a modal
   * aria-hidden, which takes the header out of the accessibility tree and so out
   * of getByRole. Escape dismisses it; the CSS locator below is the belt to that
   * braces, since it reads the DOM rather than the a11y tree.
   */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1500);
  const dayBtn = page.locator('header button[aria-label="Switch to day mode"]');
  expect((await dayBtn.count()) === 1, "night-mode header offers day on /dashboard");
  await dayBtn.first().click();
  await page.waitForTimeout(1200);
  const back = await readTheme(page);
  expect(back.hasDarkClass === false, "toggles back to day", JSON.stringify(back));
  await page.screenshot({ path: `${SHOTS}/05-day-again.png` });

  // Phone width: the header collapses the search box, the toggle must stay.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(1500);
  const mobileVisible = await page
    .locator('header button[aria-label="Switch to night mode"]')
    .first()
    .isVisible();
  expect(mobileVisible, "toggle is still reachable at phone width");
  await page.screenshot({ path: `${SHOTS}/06-phone.png` });

  const hydration = consoleErrors.filter((e) => /hydrat|did not match|#418|#423|#425/i.test(e));
  expect(hydration.length === 0, "no hydration mismatch", JSON.stringify(hydration.slice(0, 3)));

  console.log("console errors:", JSON.stringify(consoleErrors.slice(0, 8), null, 2));
  await browser.close();

  console.log("\n--- checks ---");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} passed`);
  process.exitCode = failed ? 1 : 0;
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
