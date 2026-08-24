/**
 * Does a `project_assigned` notification actually render, and does it go
 * anywhere?
 *
 * This is the one user-facing artifact of the assignment work that had never
 * been looked at. The migration proves the database accepts the row, and the
 * assign dialog proves the row gets written - but "the bell renders it with its
 * title and the click lands on the project" is a rendering fact, and a real
 * customer has already received one of these (ajmalllo@icloud.com -> Salgiya).
 * If it drew blank, or the link went nowhere, nothing so far would have said so.
 *
 * Notifications are also the place where a new `type` most easily goes wrong:
 * a screen that switches on type drops the ones it does not know, silently.
 *
 * === WHAT THIS RUN WRITES =================================================
 *   - one `notifications` row of type project_assigned, addressed to the
 *     SIGNED-IN OWNER, on one of their own projects
 *
 * Deleted in a finally block. Addressed to the person running this so nobody
 * else's bell flashes, and written directly rather than by assigning somebody,
 * so no assignment row is touched.
 *
 * Run with: node scripts/drive-assignment-notification.mjs
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
const db = createClient(cfg.EVERLUMEN_SUPABASE_URL, cfg.EVERLUMEN_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });

const TITLE_MARK = "[probe] You were added to";

const main = async () => {
  const { email, password } = env(".env");
  let notificationId = null;
  let browser;

  try {
    const { data: prof } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    const { data: me } = await db
      .from("team_members")
      .select("team_id")
      .eq("user_id", prof.id)
      .maybeSingle();
    const { data: mates } = await db
      .from("team_members")
      .select("user_id")
      .eq("team_id", me.team_id);
    const { data: projects } = await db
      .from("projects")
      .select("id, name")
      .in(
        "created_by",
        (mates ?? []).map((m) => m.user_id),
      )
      .is("deleted_at", null)
      .limit(1);
    const project = (projects ?? [])[0];
    if (!project) {
      bad("setup", "no project to point a notification at");
      return;
    }

    const { data: n, error } = await db
      .from("notifications")
      .insert({
        recipient_id: prof.id,
        actor_id: null,
        type: "project_assigned",
        title: `${TITLE_MARK} ${project.name}`,
        body: "Open the project to see the photos, tasks and documents on it.",
        link_path: `/projects/${project.id}`,
        project_id: project.id,
        entity_type: "project",
        entity_id: project.id,
      })
      .select("id")
      .maybeSingle();
    if (error) {
      bad("the database accepts a project_assigned notification", error.message);
      return;
    }
    notificationId = n.id;
    ok("the database accepts a project_assigned notification");

    /* ------------------------------------------------------------- browser */
    browser = await chromium.launch();
    const page = await browser
      .newContext({ viewport: { width: 1500, height: 1000 } })
      .then((c) => c.newPage());

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
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

    await page.goto(`${BASE}/projects`, { waitUntil: "domcontentloaded" });
    const bell = page.getByRole("button", { name: "Notifications" }).first();
    await bell.waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    await bell.click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${SHOTS}/16-notification-bell.png` });

    const panel = await page
      .locator("[data-radix-popper-content-wrapper]")
      .last()
      .innerText()
      .catch(() => "");

    // A type the bell does not recognise is the classic way a new notification
    // disappears: rendered as nothing, or filtered out of the list entirely.
    if (panel.includes(TITLE_MARK)) ok("the bell renders it", panel.split("\n")[1] ?? "");
    else bad("the bell renders it", panel.slice(0, 200) || "empty panel");

    if (/Open the project to see/i.test(panel)) ok("the body text renders");
    else bad("the body text renders", panel.slice(0, 200));

    /* ------------------------------------------------ and it goes somewhere */
    const row = page.getByText(TITLE_MARK, { exact: false }).first();
    if (await row.isVisible().catch(() => false)) {
      await row.click();
      await page.waitForTimeout(5000);
      const url = new URL(page.url());
      if (url.pathname === `/projects/${project.id}`)
        ok("clicking it opens the project", url.pathname);
      else bad("clicking it opens the project", `landed on ${url.pathname}`);
    } else {
      bad("clicking it opens the project", "no clickable row");
    }
  } catch (e) {
    bad("crashed", String(e).slice(0, 200));
  } finally {
    if (browser) await browser.close();
    if (notificationId) await db.from("notifications").delete().eq("id", notificationId);
    await db.from("notifications").delete().like("title", `${TITLE_MARK}%`);
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
  console.log(
    failures === 0 ? "Assignment notification verified." : `${failures} check(s) FAILED.`,
  );
  process.exit(failures === 0 ? 0 : 1);
};

main();
