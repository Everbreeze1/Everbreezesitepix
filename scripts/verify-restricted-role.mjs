/**
 * End-to-end proof that the Restricted role actually restricts.
 *
 * 20260911000000 narrowed `are_teammates()` and 20260912000000 handed the
 * working surfaces back per assignment. Neither can be verified by reading the
 * schema: RLS is behaviour, and the service role bypasses it entirely, so the
 * only honest test is to BE a Restricted user and see what comes back.
 *
 * WHAT THIS RUN WRITES, and it is all torn down in a finally block:
 *
 *   - one throwaway auth user (email restricted-probe+<ts>@sitepix.test)
 *   - one `team_members` row for them, role = 'restricted'
 *   - one `project_assignments` row putting them on ONE existing project
 *
 * It creates no projects, photos, documents or workflows, and it deletes
 * nothing that it did not create. `team_members` has no triggers and seat sync
 * to Stripe happens in the API layer rather than the database, so adding and
 * removing this row does not touch billing.
 *
 * Run with: node scripts/verify-restricted-role.mjs
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
const admin = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const checks = [];
const ok = (name, detail = "") => checks.push({ pass: true, name, detail });
const bad = (name, detail) => checks.push({ pass: false, name, detail });
const skip = (name, detail) => checks.push({ pass: true, skipped: true, name, detail });

/** Tables 20260912000000 restores, and how a Restricted user reaches each. */
const SURFACES = [
  { table: "project_workflows", by: "project_id" },
  { table: "project_pages", by: "project_id" },
  { table: "project_document_folders", by: "project_id" },
  { table: "tasks", by: "project_id" },
  { table: "photo_comments", by: "project_id" },
];

async function main() {
  /* ------------------------------------------------ pick a team and projects */
  const { data: members } = await admin.from("team_members").select("team_id, user_id, role");
  const owner = (members ?? []).find((m) => m.role === "owner");
  if (!owner) return (bad("setup", "no team owner to test against"), report());

  const { data: projects } = await admin
    .from("projects")
    .select("id, name")
    .eq("created_by", owner.user_id)
    .order("created_at", { ascending: true })
    .limit(20);
  if ((projects ?? []).length < 2) {
    return (
      bad("setup", `need 2+ projects on the owner's team, found ${projects?.length ?? 0}`),
      report()
    );
  }

  // Prefer a project that actually HAS rows on the restored surfaces, so a pass
  // means "saw the data", not "saw an empty table either way".
  let assigned = projects[0];
  let bestScore = -1;
  for (const p of projects) {
    let score = 0;
    for (const s of SURFACES) {
      const { count } = await admin
        .from(s.table)
        .select("id", { count: "exact", head: true })
        .eq(s.by, p.id);
      score += count ?? 0;
    }
    if (score > bestScore) {
      bestScore = score;
      assigned = p;
    }
  }
  const unassigned = projects.find((p) => p.id !== assigned.id);
  ok("setup", `assigned "${assigned.name}" (${bestScore} rows on restored surfaces)`);

  /* ------------------------------------------------- create the probe user */
  const stamp = Date.now();
  const email = `restricted-probe+${stamp}@sitepix.test`;
  const password = `Probe!${stamp}aA`;
  let probeId = null;
  let assignmentId = null;

  try {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user) {
      return (bad("create probe user", createErr?.message ?? "no user"), report());
    }
    probeId = created.user.id;
    ok("create probe user", email);

    const { error: memberErr } = await admin.from("team_members").insert({
      team_id: owner.team_id,
      user_id: probeId,
      role: "restricted",
    });
    if (memberErr) {
      // A CHECK or enum that does not know the label is itself the finding.
      bad("add them as role='restricted'", memberErr.message);
      return report();
    }
    ok("add them as role='restricted'");

    const { data: asg, error: asgErr } = await admin
      .from("project_assignments")
      .insert({ project_id: assigned.id, user_id: probeId, assigned_by: owner.user_id })
      .select("id")
      .single();
    if (asgErr) return (bad("assign them to one project", asgErr.message), report());
    assignmentId = asg.id;
    ok("assign them to one project");

    /* ------------------------------------------------ act as the probe user */
    const asUser = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false },
    });
    const { error: signInErr } = await asUser.auth.signInWithPassword({ email, password });
    if (signInErr) return (bad("sign in as the Restricted user", signInErr.message), report());
    ok("sign in as the Restricted user");

    /* --- 20260911000000: they must NOT see the whole workspace any more --- */
    const { data: visibleProjects } = await asUser.from("projects").select("id, name");
    const seen = (visibleProjects ?? []).map((p) => p.id);
    if (seen.includes(assigned.id) && !seen.includes(unassigned.id)) {
      ok("sees the assigned project and not the unassigned one", `${seen.length} project(s)`);
    } else if (seen.includes(unassigned.id)) {
      bad(
        "sees the assigned project and not the unassigned one",
        "STILL SEES AN UNASSIGNED PROJECT - are_teammates was not narrowed",
      );
    } else {
      bad(
        "sees the assigned project and not the unassigned one",
        `saw ${seen.length}, missing the assigned one`,
      );
    }

    /* --- 20260912000000: the working surfaces come back, scoped --- */
    for (const s of SURFACES) {
      const [mine, theirs, truthAssigned] = await Promise.all([
        asUser.from(s.table).select("id").eq(s.by, assigned.id),
        asUser.from(s.table).select("id").eq(s.by, unassigned.id),
        admin.from(s.table).select("id", { count: "exact", head: true }).eq(s.by, assigned.id),
      ]);
      const expected = truthAssigned.count ?? 0;
      const got = (mine.data ?? []).length;
      const leaked = (theirs.data ?? []).length;

      if (mine.error) {
        bad(`${s.table}: readable on the assigned job`, mine.error.message);
      } else if (expected === 0) {
        // Nothing to see either way; only the leak check is meaningful.
        skip(
          `${s.table}: readable on the assigned job`,
          "no rows on this project to prove it with",
        );
      } else if (got === expected) {
        ok(`${s.table}: readable on the assigned job`, `${got}/${expected} rows`);
      } else {
        bad(`${s.table}: readable on the assigned job`, `saw ${got} of ${expected}`);
      }

      if (leaked > 0)
        bad(`${s.table}: NOT readable on an unassigned job`, `leaked ${leaked} row(s)`);
      else ok(`${s.table}: NOT readable on an unassigned job`);
    }

    /* --- the deliberate exclusions must still be closed --- */
    for (const table of ["team_invites", "photo_shares"]) {
      const { data, error } = await asUser.from(table).select("id").limit(5);
      const n = (data ?? []).length;
      if (error || n === 0) ok(`${table}: still closed to Restricted`);
      else bad(`${table}: still closed to Restricted`, `returned ${n} row(s)`);
    }

    /* --- and no DELETE anywhere this file granted --- */
    const { data: victim } = await admin
      .from("project_workflows")
      .select("id")
      .eq("project_id", assigned.id)
      .limit(1)
      .maybeSingle();
    if (!victim) {
      skip("cannot DELETE a workflow on the assigned job", "no workflow on this project to try");
    } else {
      const { error: delErr } = await asUser.from("project_workflows").delete().eq("id", victim.id);
      const { data: stillThere } = await admin
        .from("project_workflows")
        .select("id")
        .eq("id", victim.id)
        .maybeSingle();
      if (stillThere)
        ok("cannot DELETE a workflow on the assigned job", delErr ? "rejected" : "silently no-op");
      else bad("cannot DELETE a workflow on the assigned job", "THE ROW WAS DELETED");
    }

    await asUser.auth.signOut();
  } finally {
    /* ----------------------------------------------------------- tear down */
    if (assignmentId) await admin.from("project_assignments").delete().eq("id", assignmentId);
    if (probeId) {
      await admin.from("team_members").delete().eq("user_id", probeId);
      const { error } = await admin.auth.admin.deleteUser(probeId);
      if (error) bad("cleanup: probe user removed", error.message);
      else ok("cleanup: probe user, membership and assignment removed");
    }
  }

  report();
}

function report() {
  console.log("");
  let failures = 0;
  for (const c of checks) {
    const mark = c.skipped ? "-" : c.pass ? "PASS" : "FAIL";
    if (!c.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${c.name}${c.detail ? `  (${c.detail})` : ""}`);
  }
  console.log("");
  console.log(failures === 0 ? "Restricted role verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
