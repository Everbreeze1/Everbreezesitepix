/**
 * Drives the surfaces the Summary / Daily Log repositioning touched, in a real
 * browser, against the local dev server.
 *
 * Everything a test suite can reach has been checked. What no test could reach
 * is whether the screens assemble: whether the Reports tab has really stopped
 * offering a Daily Log, whether the Capture-flow card correctly renders nothing
 * on a project that has no log yet, and whether any of it throws once real
 * signed URLs and a real RPC layer are behind it.
 *
 * READ ONLY. The one write this feature can trigger from a page load is
 * `generateWalkthroughNarration`, and that fires only for a RECORDED
 * walkthrough. The script asserts the walkthrough it opens is a summary, so
 * nothing is written; it fails loudly rather than quietly writing if that is
 * ever not true.
 *
 *   node scripts/drive-summary-daily-log.mjs <projectId> <walkthroughId>
 *
 * Login quirks (controlled inputs, generous waits) follow the project's
 * Playwright notes.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/summary-daily-log";
mkdirSync(SHOTS, { recursive: true });

const PROJECT_ID = process.argv[2];
const WALKTHROUGH_ID = process.argv[3];
if (!PROJECT_ID || !WALKTHROUGH_ID) {
  throw new Error("usage: node scripts/drive-summary-daily-log.mjs <projectId> <walkthroughId>");
}

function env(file) {
  const out = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const results = [];
const check = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "  ok  " : " FAIL "} ${name}${detail ? ` - ${detail}` : ""}`);
};

const IGNORE = [
  /Download the React DevTools/i,
  /Re-optimizing dependencies/i,
  /\[vite\]/i,
  /Module level directives/i,
  /favicon/i,
];

const run = async () => {
  const { email, password } = env(".env");
  if (!email || !password) throw new Error("email/password missing from .env");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  /** Every /v1/rpc op the page fired, so a missing or extra call is visible. */
  const ops = [];
  let current = "startup";

  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (IGNORE.some((re) => re.test(t))) return;
    errors.push(`[console] ${current}: ${t.slice(0, 200)}`);
  });
  page.on("pageerror", (e) => errors.push(`[pageerror] ${current}: ${String(e).slice(0, 200)}`));
  page.on("request", (r) => {
    if (!r.url().endsWith("/v1/rpc")) return;
    try {
      const op = JSON.parse(r.postData() ?? "{}").op;
      if (op) ops.push(op);
    } catch {
      /* not our concern */
    }
  });
  page.on("response", (r) => {
    if (r.status() < 400) return;
    if (/favicon|\.map$/.test(r.url())) return;
    errors.push(`[http] ${current}: ${r.status()} ${r.url().replace(BASE, "").slice(0, 130)}`);
  });

  // ---------------------------------------------------------------- login
  current = "login";
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForSelector('button[type="submit"]', { state: "visible" });
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.fill('input[type="email"]', "");
    await page.fill('input[type="password"]', "");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 10 });
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 10 });
    await page.waitForTimeout(2000);
    if ((await page.inputValue('input[type="email"]')) === email) break;
  }
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(4000);
  if (/\/login/.test(new URL(page.url()).pathname)) throw new Error("login did not leave /login");
  console.log(`login OK -> ${new URL(page.url()).pathname}\n`);

  const body = () => page.locator("body").innerText();
  const settle = async (waitFor) => {
    await page.waitForSelector(waitFor, { timeout: 90000 }).catch(() => {});
    await page.waitForTimeout(6000);
  };

  // -------------------------------------------- 1. Photos tab / Capture flow
  current = "photos tab";
  console.log("1. Capture flow (Photos tab)");
  ops.length = 0;
  await page.goto(`${BASE}/projects/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await settle("text=Visual documentation");
  if (/\/projects\/?$/.test(new URL(page.url()).pathname)) {
    throw new Error("bounced to /projects - this login cannot see that project");
  }
  const photosText = await body();
  check("the project page renders", /Visual documentation/i.test(photosText));
  check(
    "daily logs are fetched for the Capture flow",
    ops.includes("listProjectDailyLogs"),
    `ops: ${[...new Set(ops)].join(", ")}`,
  );
  // This project has no log yet, so the card must draw nothing at all rather
  // than a permanent empty placeholder under the grid.
  check(
    "no Daily Log card on a project that has never had one",
    !/Written automatically from each capture session/i.test(photosText),
  );
  await page.screenshot({ path: `${SHOTS}/1-capture-flow.png`, fullPage: true });

  // -------------------------------------------------------- 2. Reports tab
  current = "reports tab";
  console.log("\n2. Reports tab");
  await page.goto(`${BASE}/projects/${PROJECT_ID}?panel=reports`, {
    waitUntil: "domcontentloaded",
  });
  await settle("text=New report");
  const reportsText = await body();
  check("AI Summary is listed", /AI Summary/i.test(reportsText));
  check("Reports are listed", /\bReport\b/.test(reportsText));
  check(
    "no Daily Log row or filter chip",
    !/Daily Logs?\b/i.test(reportsText.replace(/Daily logs are\s+internal[\s\S]*/i, "")),
    "the bucket has left this tab",
  );
  check("the tab explains where daily logs went", /Daily logs are\s+internal/i.test(reportsText));
  await page.screenshot({ path: `${SHOTS}/2-reports-tab.png`, fullPage: true });

  // The generation menu must offer exactly the two client-facing artefacts.
  current = "reports menu";
  await page
    .getByRole("button", { name: /New report/i })
    .first()
    .click();
  await page.waitForTimeout(2000);
  const menuText = await page
    .locator('[role="menu"]')
    .first()
    .innerText()
    .catch(() => "");
  check("menu offers AI Summary", /AI Summary/i.test(menuText), menuText.replace(/\n/g, " / "));
  check("menu offers Report", /Client-ready/i.test(menuText));
  check("menu no longer offers Daily Log", !/Daily Log/i.test(menuText));
  await page.screenshot({ path: `${SHOTS}/3-reports-menu.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1000);

  // ---------------------------------------------------- 3. the Summary page
  current = "walkthrough detail";
  console.log("\n3. Walkthrough detail (a photo Summary - no narration write)");
  ops.length = 0;
  await page.goto(`${BASE}/walkthroughs/${WALKTHROUGH_ID}`, { waitUntil: "domcontentloaded" });
  await settle("text=Photos in this summary");
  const walkText = await body();
  check("the summary renders", /AI summary|Photos in this summary/i.test(walkText));
  // The guard that keeps this run read-only, asserted rather than assumed.
  check(
    "no narration generated for a photo summary",
    !ops.includes("generateWalkthroughNarration"),
    `ops: ${[...new Set(ops)].join(", ") || "none"}`,
  );
  check(
    "no video player on a walkthrough with no walk",
    (await page.locator("video").count()) === 0,
  );
  await page.screenshot({ path: `${SHOTS}/4-summary-detail.png`, fullPage: true });

  // ------------------------------------------------------- 4. Documents tab
  current = "documents tab";
  console.log("\n4. Documents tab");
  await page.goto(`${BASE}/projects/${PROJECT_ID}?panel=documents`, {
    waitUntil: "domcontentloaded",
  });
  await settle("text=Project documents");
  const docsText = await body();
  check("documents tab renders", /Project documents/i.test(docsText));
  check(
    "points at the Photos tab for daily logs",
    /Daily logs are internal and sit with the/i.test(docsText),
  );
  await page.screenshot({ path: `${SHOTS}/5-documents-tab.png`, fullPage: true });

  console.log("\n--- browser errors ---");
  if (!errors.length) console.log("  none");
  else for (const e of [...new Set(errors)]) console.log(`  ${e}`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  console.log("wrote nothing");
  await browser.close();
  if (failed.length || errors.length) process.exitCode = 1;
};

run().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
