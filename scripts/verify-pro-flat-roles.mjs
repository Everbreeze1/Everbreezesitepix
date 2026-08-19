/**
 * The one part of the client's ask that had never been SEEN working.
 *
 * "For Pro, keep it deliberately flat - just Admin and Member, no Manager tier
 * and no per-user job-scoping picker."
 *
 * `assignableRoles("pro")` is unit-tested, but a unit test cannot say what the
 * Manage menu renders, and the account this project develops against is on
 * Team - so every browser run so far has exercised the four-role hierarchy and
 * none of them has looked at the flat one. Flipping the live team's `plan`
 * column to find out is not acceptable: it is a real billing row.
 *
 * So this builds a throwaway Pro workspace, looks at it, and removes it.
 *
 * === WHAT THIS RUN WRITES, AND DELETES AGAIN =============================
 *   - two auth users, pro-probe-owner+<stamp>@ and pro-probe-crew+<stamp>@
 *     sitepix.test
 *   - one `teams` row, plan 'pro', and two `team_members` rows
 *
 * All of it torn down in a finally block, including on failure. Nothing touches
 * Stripe: `plan` and `subscription_status` are plain columns here, set
 * directly, and no billing endpoint is called. It never opens the real
 * workspace, so the account you develop with is not read or modified.
 *
 * WHAT IT PROVES, which is precisely what a unit test cannot:
 *   - the Manage menu on Pro offers Admin and Member and nothing else
 *   - Manager and Restricted are absent, not merely disabled
 *   - the base seat is called "Member" on Pro, where Team calls it "Standard"
 *   - "Choose their jobs" - the per-user scoping picker - is absent
 *   - the Team upsell names what is missing rather than the plan
 *
 * Run with: node scripts/verify-pro-flat-roles.mjs
 * Screenshots land in artifacts/team-roles/.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL ?? "http://localhost:8080";
const SHOTS = "artifacts/team-roles";
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

const cfg = env("apps/api/.env");
const db = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

const stamp = Date.now();
const PASSWORD = "ProProbe#Pass123";

const main = async () => {
  const made = { users: [], teamId: null };
  let browser;

  try {
    /* ------------------------------------------- a disposable Pro workspace */
    for (const who of ["owner", "crew"]) {
      const { data, error } = await db.auth.admin.createUser({
        email: `pro-probe-${who}+${stamp}@sitepix.test`,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: who === "owner" ? "Pro Probe Owner" : "Pro Probe Crew" },
      });
      if (error) {
        bad(`create the ${who} account`, error.message);
        return;
      }
      made.users.push(data.user.id);
    }
    const [ownerId, crewId] = made.users;

    const { data: team, error: teamErr } = await db
      .from("teams")
      .insert({
        name: `Pro probe ${stamp}`,
        owner_id: ownerId,
        plan: "pro",
        subscription_status: "active",
        member_limit: 3,
      })
      .select("id")
      .maybeSingle();
    if (teamErr) {
      bad("create the Pro team", teamErr.message);
      return;
    }
    made.teamId = team.id;

    const { error: memErr } = await db.from("team_members").insert([
      { team_id: team.id, user_id: ownerId, role: "owner" },
      { team_id: team.id, user_id: crewId, role: "member" },
    ]);
    if (memErr) {
      bad("add the members", memErr.message);
      return;
    }
    ok("a disposable Pro workspace exists", `plan=pro, 2 members`);

    /* ------------------------------------------------------------- browser */
    browser = await chromium.launch();
    const page = await browser
      .newContext({ viewport: { width: 1500, height: 1000 } })
      .then((c) => c.newPage());

    const ownerEmail = `pro-probe-owner+${stamp}@sitepix.test`;
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
    await page.waitForSelector('button[type="submit"]', { state: "visible" });
    for (let i = 0; i < 6; i++) {
      await page.fill('input[type="email"]', "");
      await page.fill('input[type="password"]', "");
      await page.locator('input[type="email"]').pressSequentially(ownerEmail, { delay: 12 });
      await page.locator('input[type="password"]').pressSequentially(PASSWORD, { delay: 12 });
      await page.waitForTimeout(2000);
      if ((await page.inputValue('input[type="email"]')) === ownerEmail) break;
    }
    await page.click('button[type="submit"]');
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(4000);
    if (/\/login/.test(new URL(page.url()).pathname)) {
      bad("sign in as the Pro owner", "still on /login");
      return;
    }
    ok("sign in as the Pro owner");

    await page.goto(`${BASE}/teams`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("text=Team members", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/17-pro-roster.png` });

    /* -------------------------------- the base seat is Member, not Standard */
    const rosterText = await page.locator("body").innerText();
    if (/\bMEMBER\b/.test(rosterText) && !/\bSTANDARD\b/.test(rosterText))
      ok('Pro calls the base seat "Member"', "no STANDARD badge on a Pro roster");
    else bad('Pro calls the base seat "Member"', rosterText.slice(0, 200));

    /* ------------------------------------------------ the flat Manage menu */
    const manage = page.locator("button:not([disabled])", { hasText: /^Manage$/ }).first();
    if (!(await manage.isVisible().catch(() => false))) {
      bad("the Manage menu is flat on Pro", "no Manage button");
      return;
    }
    await manage.click();
    await page.waitForTimeout(900);
    const menu = await page
      .locator("[data-radix-popper-content-wrapper]")
      .last()
      .innerText()
      .catch(() => "");
    await page.screenshot({ path: `${SHOTS}/18-pro-manage-menu.png` });

    const offered = ["Admin", "Manager", "Standard", "Restricted", "Member"].filter((r) =>
      new RegExp(`\\b${r}\\b`).test(menu),
    );
    // The whole point of the tier line: Admin and Member, one level apart.
    if (offered.includes("Admin") && offered.includes("Member"))
      ok("Pro offers Admin and Member", offered.join(", "));
    else
      bad(
        "Pro offers Admin and Member",
        `offered: ${offered.join(", ") || "none"} | ${menu.slice(0, 160)}`,
      );

    if (!offered.includes("Manager")) ok("Manager is absent on Pro");
    else bad("Manager is absent on Pro", menu.slice(0, 200));

    if (!offered.includes("Restricted")) ok("Restricted is absent on Pro");
    else bad("Restricted is absent on Pro", menu.slice(0, 200));

    if (!offered.includes("Standard")) ok('the word "Standard" never appears on Pro');
    else bad('the word "Standard" never appears on Pro', menu.slice(0, 200));

    /* ------------------------------- no per-user job scoping anywhere on Pro */
    if (!/Choose their jobs/i.test(menu)) ok("the job-scoping picker is absent on Pro");
    else bad("the job-scoping picker is absent on Pro", "the Choose their jobs row is present");

    /* ----------------------------------------- the upsell names what is missing */
    if (/Managers, and scoping someone to named jobs, are on Team/i.test(menu))
      ok("the Team upsell names what is missing, not just the plan");
    else bad("the Team upsell names what is missing, not just the plan", menu.slice(0, 240));

    /* ---------------------------- each remaining option still explains itself */
    if (/One level below Admin/i.test(menu))
      ok("Pro's Member option says it is one level below Admin");
    else bad("Pro's Member option says it is one level below Admin", menu.slice(0, 240));
  } catch (e) {
    bad("crashed", String(e).slice(0, 200));
  } finally {
    if (browser) await browser.close();
    /* ------------------------------------------------------------- teardown */
    if (made.teamId) {
      await db.from("team_members").delete().eq("team_id", made.teamId);
      await db.from("teams").delete().eq("id", made.teamId);
    }
    for (const id of made.users) {
      await db.auth.admin.deleteUser(id).catch(() => {});
    }
  }

  console.log("");
  let failures = 0;
  for (const c of checks) {
    if (!c.pass) failures++;
    console.log(
      `  ${(c.pass ? "PASS" : "FAIL").padEnd(4)}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`,
    );
  }
  console.log("");
  console.log(failures === 0 ? "Pro stays flat, in the browser." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
