/**
 * Do the guards on the assignment RPCs actually fire?
 *
 * tests/project-assignment.test.ts asserts that the error strings EXIST in
 * apps/api/src/domains/teams/service.ts. That is a grep, not a proof: it would
 * pass just as happily if the checks were written and never reached, which is
 * the exact failure this repo's own test file calls out ("a tested pure
 * function that nothing calls is indistinguishable from a shipped feature").
 *
 * `project_assignments` has no team column, so BOTH ends of a row have to be
 * proved against the caller's own team:
 *
 *   the project - or an admin could paste another company's project id and
 *     quietly attach one of their own people to it
 *   the user    - or a stale id, or somebody else's user id, could be written
 *     into a row nothing would ever clear
 *
 * And the read is scoped separately: `getProjectAssignees` filters through the
 * CALLER's client, because answering "who is on job X" for a job the caller
 * cannot open would hand a Restricted member exactly what their role withholds.
 *
 * This calls the real HTTP endpoint with a real token and checks each refusal.
 *
 * === WHAT THIS RUN WRITES =================================================
 * Nothing that survives it. The one accepted call assigns the signed-in owner
 * to their own project and is immediately reverted to whatever was there
 * before; self-assignment raises no notification. Every other call is expected
 * to be REFUSED, so it writes nothing by definition.
 *
 * Run with: node scripts/verify-assignment-guards.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const API = process.env.API_URL ?? "http://localhost:8787";

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
const creds = env(".env");
const db = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail = "") => checks.push({ pass: false, name, detail });
const skip = (name, detail = "") => checks.push({ pass: true, skipped: true, name, detail });

async function rpc(op, data, token) {
  const r = await fetch(`${API}/v1/rpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, data }),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const main = async () => {
  let restore = null;

  try {
    /* --------------------------------------------------------------- token */
    const anon =
      cfg.SITEPIX_SUPABASE_PUBLISHABLE_KEY ??
      cfg.SITEPIX_SUPABASE_ANON_KEY ??
      cfg.SUPABASE_ANON_KEY;
    const user = createClient(cfg.SITEPIX_SUPABASE_URL, anon, { auth: { persistSession: false } });
    const { data: session, error: signErr } = await user.auth.signInWithPassword({
      email: creds.email,
      password: creds.password,
    });
    if (signErr || !session?.session?.access_token) {
      bad("sign in", signErr?.message ?? "no access token");
      return;
    }
    const token = session.session.access_token;
    ok("sign in as the workspace owner");

    /* ------------------------------------------------- our own team's data */
    const { data: prof } = await db
      .from("profiles")
      .select("id")
      .eq("email", creds.email)
      .maybeSingle();
    const { data: me } = await db
      .from("team_members")
      .select("team_id")
      .eq("user_id", prof.id)
      .maybeSingle();
    const { data: mates } = await db
      .from("team_members")
      .select("user_id")
      .eq("team_id", me.team_id);
    const mineIds = (mates ?? []).map((m) => m.user_id);
    const { data: mine } = await db
      .from("projects")
      .select("id")
      .in("created_by", mineIds)
      .is("deleted_at", null)
      .limit(1);
    const myProject = (mine ?? [])[0];

    /* --------------------------------------- somebody ELSE's team and data */
    const { data: others } = await db
      .from("team_members")
      .select("team_id, user_id")
      .neq("team_id", me.team_id);
    const otherUser = (others ?? [])[0];
    const otherIds = (others ?? []).map((o) => o.user_id);
    const { data: theirs } = await db
      .from("projects")
      .select("id")
      .in("created_by", otherIds.length ? otherIds : ["00000000-0000-0000-0000-000000000000"])
      .is("deleted_at", null)
      .limit(1);
    const theirProject = (theirs ?? [])[0];

    if (!myProject) {
      bad("setup", "the owner's team has no projects");
      return;
    }

    // What the crew is right now, so the accepted call can be undone exactly.
    const { data: before } = await db
      .from("project_assignments")
      .select("user_id")
      .eq("project_id", myProject.id);
    restore = { projectId: myProject.id, userIds: (before ?? []).map((r) => r.user_id) };

    /* =================================================== 1. the happy path */
    {
      const { status, json } = await rpc(
        "setProjectAssignees",
        { projectId: myProject.id, userIds: [prof.id] },
        token,
      );
      if (status === 200 && json?.count === 1) ok("a legitimate assignment is accepted");
      else bad("a legitimate assignment is accepted", `${status} ${JSON.stringify(json)}`);
    }

    /* ======================================= 2. another team's project id */
    if (!theirProject) {
      skip("another team's project is refused", "no other team has a project");
    } else {
      const { status, json } = await rpc(
        "setProjectAssignees",
        { projectId: theirProject.id, userIds: [prof.id] },
        token,
      );
      if (status === 403 && /not part of your team/i.test(json?.message ?? ""))
        ok("another team's project is refused", `${status} ${json.message}`);
      else bad("another team's project is refused", `${status} ${JSON.stringify(json)}`);
    }

    /* ========================================== 3. a user not on our team */
    if (!otherUser) {
      skip("a stranger cannot be staffed", "no other team exists");
    } else {
      const { status, json } = await rpc(
        "setProjectAssignees",
        { projectId: myProject.id, userIds: [otherUser.user_id] },
        token,
      );
      if (status === 403 && /not on your team/i.test(json?.message ?? ""))
        ok("a stranger cannot be staffed", `${status} ${json.message}`);
      else bad("a stranger cannot be staffed", `${status} ${JSON.stringify(json)}`);
    }

    /* ============================ 4. the read is scoped to what we can see */
    if (!theirProject) {
      skip("another team's crew is not readable", "no other team has a project");
    } else {
      const { status, json } = await rpc(
        "getProjectAssignees",
        { projectIds: [theirProject.id, myProject.id] },
        token,
      );
      const keys = Object.keys(json?.byProject ?? {});
      if (status === 200 && !keys.includes(theirProject.id) && keys.includes(myProject.id))
        ok("another team's crew is not readable", `returned only ${keys.length} of 2 ids`);
      else bad("another team's crew is not readable", `${status} ${JSON.stringify(keys)}`);
    }

    /* ================================ 5. the schema rejects malformed input */
    {
      const { status } = await rpc(
        "setProjectAssignees",
        { projectId: "not-a-uuid", userIds: [] },
        token,
      );
      if (status === 400) ok("a malformed project id is rejected by the schema", String(status));
      else bad("a malformed project id is rejected by the schema", String(status));
    }
  } catch (e) {
    bad("crashed", String(e).slice(0, 200));
  } finally {
    /* ------------------------------------------------------------- restore */
    if (restore) {
      await db.from("project_assignments").delete().eq("project_id", restore.projectId);
      if (restore.userIds.length) {
        await db.from("project_assignments").insert(
          restore.userIds.map((user_id) => ({
            project_id: restore.projectId,
            user_id,
          })),
        );
      }
    }
  }

  console.log("");
  let failures = 0;
  for (const c of checks) {
    const mark = c.skipped ? "-" : c.pass ? "PASS" : "FAIL";
    if (!c.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  console.log("");
  console.log(failures === 0 ? "Assignment guards verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
};

main();
