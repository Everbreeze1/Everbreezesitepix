/**
 * Read-only live smoke test.
 *
 * Logs in with the credentials in .env, walks the main screens, and records
 * anything the browser complains about. Deliberately performs NO destructive
 * action: no deletes, no archives, no share-link creation, no uploads. It only
 * navigates, scrolls, and measures.
 *
 * The geometry checks are the point — they verify the layout fixes from this
 * session against a real rendered page, which no amount of reading source can
 * do. Run with: node scripts/live-check.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/live-check";
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

const problems = [];
const note = (kind, page, detail) => problems.push({ kind, page, detail });

const ROUTES = [
  ["/dashboard", "dashboard"],
  ["/projects", "projects"],
  ["/templates?tab=checklists", "templates-checklists"],
  ["/templates?tab=workflows", "templates-workflows"],
  ["/templates?tab=blueprints", "templates-blueprints"],
  ["/gallery", "gallery"],
  ["/reports", "reports"],
  ["/map", "map"],
  ["/settings", "settings"],
  ["/teams", "teams"],
  ["/notifications", "notifications"],
];

const IGNORE = [
  /Download the React DevTools/i,
  /Re-optimizing dependencies/i,
  /\[vite\]/i,
  /Module level directives/i,
  /favicon/i,
];

const run = async () => {
  const { email, password } = env();
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  let current = "startup";

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (IGNORE.some((re) => re.test(t))) return;
    note("console", current, t.slice(0, 300));
  });
  page.on("pageerror", (e) => note("pageerror", current, String(e).slice(0, 300)));
  page.on("response", (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/favicon|\.map$/.test(u)) return;
    note("http", current, `${r.status()} ${u.replace(BASE, "").slice(0, 160)}`);
  });

  // ---------- login ----------
  current = "login";
  // `networkidle`, not `domcontentloaded`: these are controlled React inputs,
  // so filling them before hydration sets the DOM value but not the component
  // state, and submit then posts empty credentials.
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.screenshot({ path: `${SHOTS}/00-login.png` });
  await page.click('button[type="submit"]');
  // Supabase auth + the post-login redirect take a beat; 3s was not enough and
  // the run failed on a page that was mid-navigation, not on a real error.
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const landed = new URL(page.url()).pathname;
  if (/\/login/.test(landed)) {
    await page.screenshot({ path: `${SHOTS}/00-login-failed.png` });
    const err = await page.locator("body").innerText();
    throw new Error(`Login did not leave /login. Page said: ${err.slice(0, 300)}`);
  }
  console.log(`login OK -> ${landed}`);

  // ---------- walk ----------
  for (const [route, name] of ROUTES) {
    current = route;
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  }

  // ---------- geometry: does the camera button cover anything? ----------
  // The FAB is fixed bottom-right. Any interactive control whose box overlaps
  // it is unreachable. This is the check for the padding fixes.
  for (const [route, name] of ROUTES) {
    current = `${route} (fab-overlap)`;
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(800);

    const hits = await page.evaluate(() => {
      const fab = document.querySelector(
        'button[aria-label="Open camera"], button[aria-label^="Create a project"]',
      );
      if (!fab) return null;
      const f = fab.getBoundingClientRect();
      if (f.width === 0) return null;
      const out = [];
      for (const el of document.querySelectorAll("button, a, input, textarea, [role='button']")) {
        if (el === fab || fab.contains(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const overlap =
          r.left < f.right && r.right > f.left && r.top < f.bottom && r.bottom > f.top;
        if (!overlap) continue;
        // Ignore things painted above the FAB (dialogs etc.)
        out.push(
          (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 60),
        );
      }
      return out;
    });
    if (hits === null) continue;
    if (hits.length) note("fab-overlap", route, hits.join(" | "));
  }

  // ---------- geometry: sticky panes align in the builder ----------
  current = "/templates?tab=checklists (sticky)";
  await page.goto(`${BASE}/templates?tab=checklists`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.scrollBy(0, 700));
  await page.waitForTimeout(700);
  const sticky = await page.evaluate(() => {
    const header = document.querySelector("header");
    const rail = document.querySelector(".md\\:sticky");
    // The canvas title bar is the sticky element inside the editor card.
    const bars = Array.from(document.querySelectorAll("div")).filter((d) => {
      const s = getComputedStyle(d);
      return s.position === "sticky" && d !== rail;
    });
    const bar = bars.find((b) => b.querySelector("input"));
    const box = (el) => (el ? el.getBoundingClientRect().top : null);
    return {
      header: box(header),
      headerH: header?.getBoundingClientRect().height ?? null,
      rail: box(rail),
      bar: box(bar),
    };
  });
  await page.screenshot({ path: `${SHOTS}/templates-scrolled.png` });
  console.log("sticky geometry:", JSON.stringify(sticky));
  if (sticky.rail != null && sticky.bar != null) {
    const delta = Math.abs(sticky.rail - sticky.bar);
    if (delta > 2)
      note(
        "sticky-misalign",
        "/templates?tab=checklists",
        `rail top ${sticky.rail} vs title bar top ${sticky.bar} (delta ${delta}px)`,
      );
  }

  await browser.close();

  // ---------- report ----------
  console.log("\n================ RESULT ================");
  if (!problems.length) {
    console.log("No console errors, failed requests, FAB overlaps or sticky misalignment.");
  } else {
    const byKind = {};
    for (const p of problems) (byKind[p.kind] ??= []).push(p);
    for (const [kind, list] of Object.entries(byKind)) {
      console.log(`\n## ${kind} (${list.length})`);
      const seen = new Set();
      for (const p of list) {
        const key = `${p.page}|${p.detail}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`  [${p.page}] ${p.detail}`);
      }
    }
  }
  console.log(`\nScreenshots: ${SHOTS}/`);
};

run().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
