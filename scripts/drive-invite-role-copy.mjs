/**
 * What the invite page tells somebody they are accepting.
 *
 * `/invite/$token` used to print `invite.role` straight from the column under a
 * CSS capitalize, and then promise - for every role alike - "access to all of
 * the team's projects, photos, and reports". For a Restricted invite that
 * sentence was false: they get the jobs they are ticked into and nothing else.
 * It is the one screen a person reads while deciding whether to accept, so a
 * wrong promise there is the worst version of that bug rather than the mildest.
 *
 * The page cannot be reached without a valid token, so this mints two, reads
 * what they say, and removes them.
 *
 * === WHAT THIS RUN WRITES =================================================
 *   - two `team_invites` rows on the signed-in owner's team, addressed to
 *     invite-probe+<stamp>@sitepix.test, one Standard and one Restricted
 *
 * Both are deleted in a finally block. The rows are INSERTED DIRECTLY rather
 * than through `inviteMember`, which is what keeps this from sending anybody an
 * email; nothing is accepted, so no seat is taken and no member row is created.
 *
 * Run with: node scripts/drive-invite-role-copy.mjs
 * Screenshots land in artifacts/team-roles/.
 */
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";

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

const main = async () => {
  const { email } = env(".env");
  const stamp = Date.now();
  const made = [];
  let browser;

  try {
    /* ------------------------------------------------ find the owner's team */
    const { data: prof } = await db.from("profiles").select("id").eq("email", email).maybeSingle();
    const { data: me } = await db
      .from("team_members")
      .select("team_id")
      .eq("user_id", prof.id)
      .maybeSingle();
    const teamId = me.team_id;
    const { data: team } = await db.from("teams").select("name, plan").eq("id", teamId).single();

    /* ------------------------------------------------------- mint the tokens */
    for (const role of ["member", "restricted"]) {
      const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
      const { data, error } = await db
        .from("team_invites")
        .insert({
          team_id: teamId,
          email: `invite-probe+${role}-${stamp}@sitepix.test`,
          role,
          token,
          invited_by: prof.id,
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        })
        .select("id, token, role")
        .maybeSingle();
      if (error) {
        bad(`mint a ${role} invite`, error.message);
        continue;
      }
      made.push(data);
    }
    if (!made.length) return;

    browser = await chromium.launch();
    const page = await browser
      .newContext({ viewport: { width: 1500, height: 1000 } })
      .then((c) => c.newPage());

    for (const inv of made) {
      // Signed out on purpose: this is what an invitee sees, and most of them
      // have no account yet.
      await page.goto(`${BASE}/invite/${inv.token}`, { waitUntil: "domcontentloaded" });
      await page
        .getByText(/Your role will be/i)
        .first()
        .waitFor({ state: "visible", timeout: 60000 })
        .catch(() => {});
      await page.waitForTimeout(1200);
      const body = await page.locator("body").innerText();
      await page.screenshot({ path: `${SHOTS}/15-invite-${inv.role}.png` });

      const line = (body.match(/Your role will be[^\n]*/i) ?? [""])[0];

      if (inv.role === "member") {
        // This team is on Team, which calls the base seat Standard. The old
        // page printed the raw column and said "Member".
        const want = team.plan === "team" ? "Standard" : "Member";
        if (new RegExp(`\\b${want}\\b`).test(line))
          ok(`a base-seat invite is named for the ${team.plan} tier`, line.slice(0, 110));
        else bad(`a base-seat invite is named for the ${team.plan} tier`, line.slice(0, 160));

        if (/access to all of/i.test(body))
          ok("a base-seat invite is promised the whole workspace");
        else bad("a base-seat invite is promised the whole workspace", line.slice(0, 160));
      } else {
        if (/\bRestricted\b/.test(line))
          ok("a Restricted invite is named Restricted", line.slice(0, 110));
        else bad("a Restricted invite is named Restricted", line.slice(0, 160));

        // The whole point: this used to promise the entire workspace.
        if (/access to all of/i.test(body))
          bad(
            "a Restricted invite is NOT promised the whole workspace",
            "still says 'access to all of'",
          );
        else ok("a Restricted invite is NOT promised the whole workspace");

        if (/jobs .* puts you on/i.test(body))
          ok("a Restricted invite is told what it actually gets");
        else bad("a Restricted invite is told what it actually gets", body.slice(0, 200));
      }

      /*
       * The role's limits, in the reader's own voice.
       *
       * This used to look for ROLE_DESCRIPTION verbatim, which is written for
       * the admin doing the assigning - so the page passed this check while
       * telling a Restricted invitee "Sees only the jobs you assign them".
       * Matching the second-person copy is what makes the check test the thing
       * that matters.
       */
      if (
        /You won't be able to manage the team or billing|You'll be able to manage the team/i.test(
          body,
        )
      )
        ok(`the ${inv.role} invite explains the role`);
      else bad(`the ${inv.role} invite explains the role`, body.slice(0, 200));

      /*
       * Case-SENSITIVE on purpose. The raw column values are lower case
       * (`restricted`, `member`); the matrix labels are capitalised. An `i`
       * flag here flagged the correct "Restricted" as if it were the raw
       * value, which is the check failing to make the exact distinction it
       * exists to make.
       */
      if (/will be (restricted|member|standard|admin|manager)\b/.test(line))
        bad("no raw role value on screen", line.slice(0, 160));
      else ok("no raw role value on screen");
    }
  } catch (e) {
    bad("crashed", String(e).slice(0, 200));
  } finally {
    if (browser) await browser.close();
    for (const inv of made) await db.from("team_invites").delete().eq("id", inv.id);
    // Belt and braces: anything this run addressed.
    await db.from("team_invites").delete().like("email", "invite-probe+%@sitepix.test");
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
  console.log(failures === 0 ? "Invite copy verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
