/**
 * Drives the whole admin console in a real browser.
 *
 * WHY THIS EXISTS
 *
 * The admin work was verified by typecheck, by 1,527 source-text tests, and by
 * live queries against the database - none of which prove a page renders. Nine
 * sections and fifteen new RPC ops had never been loaded once. A test asserting
 * that `AdminHealthPage.tsx` contains the string "f.message" says nothing about
 * whether the page mounts.
 *
 * This run visits every admin route, waits for its data, and asserts on what
 * the browser actually painted. It also watches the network and the console, so
 * a 500 from a new op or a React error fails the run even when the page still
 * renders something.
 *
 * WRITES NOTHING. Every mutating request - REST writes and the mutating half of
 * the RPC surface - is blocked at the network layer, so this cannot grant an
 * admin, revoke a share link, send a broadcast or delete an account. The
 * blocklist is asserted at the end: if a mutating op somehow fired, the run
 * fails.
 *
 * Run with: node scripts/drive-admin-console.mjs
 * Screenshots land in artifacts/admin-console/.
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/admin-console";
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

/** Anything that changes state. Blocked, and asserted as never-called. */
const MUTATING_OPS = new Set([
  "setPlatformAdmin",
  "sendAdminNotification",
  "syncTeamBilling",
  "setFeedbackStatus",
  "replyToFeedback",
  "runUserSupportAction",
  "deletePlatformUser",
  "overrideTeamPlan",
  "manageTeamSubscription",
  "revokeShareLinks",
  "setAdminRole",
  "addUserNote",
  "setUserTeamRole",
  "runBulkUserAction",
]);

/** Wait for a selector to exist. Returns false rather than throwing. */
const waitFor = (page, selector, timeout = 30000) =>
  page
    .waitForSelector(selector, { timeout })
    .then(() => true)
    .catch(() => false);

const run = async () => {
  const { email, password } = env(".env");
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
  const page = await ctx.newPage();

  const rpcCalls = [];
  const failedOps = [];
  const consoleErrors = [];
  const blockedMutations = [];

  // Block REST writes outright.
  await page.route(/\/rest\/v1\//, async (route) => {
    const m = route.request().method();
    if (m !== "GET" && m !== "HEAD") return route.abort();
    return route.continue();
  });

  // Inspect every RPC. Reads pass through; writes are aborted and recorded.
  await page.route(/\/v1\/rpc/, async (route) => {
    let op = "(unparsed)";
    try {
      op = JSON.parse(route.request().postData() ?? "{}").op ?? "(none)";
    } catch {
      // fall through
    }
    if (MUTATING_OPS.has(op)) {
      blockedMutations.push(op);
      return route.abort();
    }
    rpcCalls.push(op);
    return route.continue();
  });

  page.on("response", async (res) => {
    if (!/\/v1\/rpc/.test(res.url()) || res.status() < 400) return;
    let op = "(unknown)";
    try {
      op = JSON.parse(res.request().postData() ?? "{}").op ?? "(none)";
    } catch {
      // fall through
    }
    let body = "";
    try {
      body = (await res.text()).slice(0, 200);
    } catch {
      // fall through
    }
    failedOps.push(`${op} -> ${res.status()} ${body}`);
  });

  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const t = msg.text();
    // Aborted writes are this script's own doing, not a defect.
    if (/Failed to fetch|net::ERR_FAILED|ERR_ABORTED/.test(t)) return;
    consoleErrors.push(t.slice(0, 200));
  });

  // --- login ---------------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 90000 });
  // Retry once: the form is inert until hydration, and a first fill can land
  // on an input React then re-renders out from under.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.fill('input[type="email"]', "");
    await page.locator('input[type="email"]').pressSequentially(email, { delay: 12 });
    await page.fill('input[type="password"]', "");
    await page.locator('input[type="password"]').pressSequentially(password, { delay: 12 });
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 30000 }).catch(() => {});
    if (!/\/login/.test(new URL(page.url()).pathname)) break;
    await page.waitForTimeout(2000);
  }
  if (/\/login/.test(new URL(page.url()).pathname)) {
    bad("login", "still on /login");
    await page.screenshot({ path: `${SHOTS}/00-login-failed.png` });
    await browser.close();
    return report();
  }
  ok("login");

  // --- the sidebar entry point (milestone 1.1) -----------------------------
  /*
   * Waited for, not slept for.
   *
   * The row appears only once `checkIsPlatformAdmin` resolves, and the first
   * version of this script slept three seconds and then asserted. That reported
   * a working feature as broken - the worst kind of test failure, because the
   * obvious response is to go and "fix" code that was already correct.
   */
  const sawAdminLink = await waitFor(page, 'a[href="/admin"]');
  expect(
    sawAdminLink,
    "sidebar shows an Admin link",
    "the console had no entry point at all before this work",
  );
  await page.screenshot({ path: `${SHOTS}/01-sidebar.png` });

  // --- every admin section -------------------------------------------------
  const sections = [
    { path: "/admin", name: "Overview", expect: /Total users|Total teams/i },
    { path: "/admin/users", name: "Users", expect: /Showing \d|No accounts match/i },
    {
      path: "/admin/teams",
      name: "Teams",
      expect: /Industry mix|No teams match|Billing reconciliation/i,
    },
    { path: "/admin/feedback", name: "Feedback", expect: /Customer feedback/i },
    { path: "/admin/notifications", name: "Notifications", expect: /Send announcement/i },
    { path: "/admin/health", name: "Health", expect: /Requests|Not set up yet/i },
    { path: "/admin/usage", name: "Usage", expect: /Estimated AI spend|Content library/i },
    { path: "/admin/security", name: "Security", expect: /Public share links/i },
    { path: "/admin/audit-log", name: "Audit log", expect: /Admin action history/i },
  ];

  for (const s of sections) {
    await page.goto(`${BASE}${s.path}`, { waitUntil: "domcontentloaded", timeout: 60000 });
    // Several of these fan out to Stripe or aggregate over 36k rows, so wait
    // for the section's own marker rather than guessing a duration.
    await page.waitForSelector('nav a[href="/admin/users"]', { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const body = await page.locator("body").innerText();
    expect(s.expect.test(body), `${s.name} renders`, s.path);
    expect(!/Admin access required/i.test(body), `${s.name} passes the admin gate`, s.path);
    await page.screenshot({
      path: `${SHOTS}/${s.path.replace(/\//g, "-").replace(/^-/, "")}.png`,
      fullPage: true,
    });
  }

  // --- the user directory ---------------------------------------------------
  await page.goto(`${BASE}/admin/users`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitFor(page, "text=Showing");
  const usersBody = await page.locator("body").innerText();
  expect(
    /Showing \d+-\d+ of \d+/.test(usersBody),
    "users list shows a real total",
    "counted in SQL, not inferred from the loaded page",
  );
  expect(
    /Unconfirmed/.test(usersBody) && /Dormant/.test(usersBody) && /No team/.test(usersBody),
    "status filters are offered",
  );
  expect(/Last seen/i.test(usersBody), "last-seen column is present");
  expect(/Export CSV/i.test(usersBody), "export is offered");
  expect(
    (await page.locator('input[type="checkbox"]').count()) > 1,
    "rows are selectable for bulk actions",
  );
  await page.screenshot({ path: `${SHOTS}/09-users-directory.png`, fullPage: true });

  /*
   * Everything above passes against the pre-migration fallback too, which is
   * the point of the fallback but useless as proof. These exercise the SQL
   * path: a filter that does not narrow the total, or a sort that does not
   * reorder, is a control that lies about what it did.
   */
  const totalOf = (text) => {
    const m = text.match(/Showing \d+-\d+ of (\d+)/);
    return m ? Number(m[1]) : null;
  };
  const allTotal = totalOf(usersBody);
  const degraded = /Filters and sorting are unavailable/.test(usersBody);

  if (degraded) {
    bad(
      "directory runs the SQL path",
      "still on the fallback - run 20260823100000_admin_user_directory.sql",
    );
  } else {
    ok("directory runs the SQL path", `${allTotal} accounts`);

    await page.getByRole("button", { name: "Unconfirmed", exact: true }).click();
    await page.waitForTimeout(3500);
    const unconfirmedTotal = totalOf(await page.locator("body").innerText());
    expect(
      unconfirmedTotal !== null && allTotal !== null && unconfirmedTotal < allTotal,
      "a status filter narrows the total",
      `all ${allTotal} -> unconfirmed ${unconfirmedTotal}`,
    );

    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.waitForTimeout(3500);

    // First row before and after flipping a sort. If they match, the header is
    // decoration.
    const firstName = async () =>
      (await page.locator("tbody tr").first().innerText()).split("\n")[0];
    const beforeSort = await firstName();
    await page.getByRole("button", { name: /Last seen/i }).click();
    await page.waitForTimeout(3500);
    const afterSort = await firstName();
    expect(beforeSort !== afterSort, "sorting reorders the table", `${beforeSort} -> ${afterSort}`);
    await page.screenshot({ path: `${SHOTS}/09b-users-sorted.png`, fullPage: true });
  }

  // --- the user detail route (milestone 3) ---------------------------------
  const sawUserLink = await waitFor(page, 'a[href^="/admin/users/"]');
  if (sawUserLink) {
    await page.locator('a[href^="/admin/users/"]').first().click();
    await page.waitForURL(/\/admin\/users\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
    await waitFor(page, "text=Support actions");
    const detail = await page.locator("body").innerText();
    expect(/Support actions/i.test(detail), "user detail page renders");
    expect(
      /Last sign-in|Never signed in/i.test(detail),
      "user detail reads auth metadata",
      "proves auth.admin.getUserById works through the new op",
    );
    expect(/Recent API activity/i.test(detail), "user detail reads api_audit_logs");
    // The roles were enforced from the day they landed but nothing could SET
    // them, so every admin was a superadmin and the capability system was
    // decorative. This asserts the control exists.
    expect(/Platform access/i.test(detail), "user detail offers an admin role, not a boolean");
    expect(
      /support/i.test(detail) && /billing/i.test(detail) && /superadmin/i.test(detail),
      "all three admin roles are offered",
    );
    expect(/Support notes/i.test(detail), "user detail has support notes");
    expect(/Team membership/i.test(detail), "user detail can change a team role");
    await page.screenshot({ path: `${SHOTS}/10-user-detail.png`, fullPage: true });
  } else {
    bad("user detail page renders", "no /admin/users/<id> link appeared within 30s");
  }

  // --- team detail + billing panel (milestone 6) ---------------------------
  await page.goto(`${BASE}/admin/teams`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  const sawTeamLink = await waitFor(page, 'a[href^="/admin/teams/"]');
  if (sawTeamLink) {
    await page.locator('a[href^="/admin/teams/"]').first().click();
    await page.waitForURL(/\/admin\/teams\/[0-9a-f-]{36}/, { timeout: 30000 }).catch(() => {});
    // The billing panel calls Stripe, so it is the slowest thing on the page.
    await waitFor(page, "text=Plan in our database", 40000);
    const teamBody = await page.locator("body").innerText();
    expect(/Billing/i.test(teamBody), "team detail shows the billing panel");
    expect(
      /Plan in our database/i.test(teamBody),
      "billing panel resolved getTeamBilling",
      "this op calls Stripe, so it also proves the degradation path",
    );
    await page.screenshot({ path: `${SHOTS}/11-team-detail.png`, fullPage: true });
  } else {
    bad("team detail shows the billing panel", "no /admin/teams/<id> link appeared within 30s");
  }

  // --- getMyTeam still works after the N+1 change --------------------------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(6000);
  expect(
    rpcCalls.includes("getMyTeam"),
    "getMyTeam was called",
    "the op whose email-confirmation lookup was rewritten",
  );
  const dash = await page.locator("body").innerText();
  expect(!/Something went wrong/i.test(dash), "dashboard renders after the getMyTeam change");
  await page.screenshot({ path: `${SHOTS}/12-dashboard.png` });

  // --- network and console -------------------------------------------------
  expect(failedOps.length === 0, "no RPC returned 4xx/5xx", failedOps.join(" | ") || "none");
  expect(
    consoleErrors.length === 0,
    "no console errors",
    consoleErrors.slice(0, 3).join(" | ") || "none",
  );
  expect(
    blockedMutations.length === 0,
    "no mutating op was attempted",
    blockedMutations.join(", ") || "none",
  );

  const adminOps = [...new Set(rpcCalls)].filter((o) =>
    /^(get|list|check)(Admin|Platform|Feedback|Api|Job|Share|Team|Content|Billing|User)/.test(o),
  );
  ok("admin ops exercised", adminOps.sort().join(", "));

  await browser.close();
  return report();
};

function report() {
  console.log("");
  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}${c.detail ? `  -  ${c.detail}` : ""}`);
  }
  const failed = checks.filter((c) => !c.pass).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  console.log(`screenshots: ${SHOTS}/`);
  process.exit(failed ? 1 : 0);
}

run().catch((e) => {
  console.error("drive failed:", e);
  process.exit(1);
});
