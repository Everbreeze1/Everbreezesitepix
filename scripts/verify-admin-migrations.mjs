/**
 * Read-only verification that the two admin-console migrations landed:
 *
 *   20260822120000_admin_team_rollups.sql
 *   20260822130000_feedback_triage.sql
 *   20260822140000_admin_observability.sql
 *   20260822150000_admin_roles.sql
 *   20260822160000_email_confirmed_lookup.sql
 *
 * They are applied by hand in the Supabase SQL editor, so "did it run" and "did
 * every part of it run" are different questions - a statement that errored
 * halfway down the file leaves the function present but its GRANT missing, and
 * nothing in the app would say so. The same reasoning as
 * verify-blueprint-migration.mjs, which this follows.
 *
 * Destructive actions: one throwaway `issue_reports` row, inserted to prove the
 * CHECK constraint rejects a bad status, and deleted in a finally block. It is
 * only written if the constraint is MISSING (a working constraint rejects the
 * insert, so nothing lands).
 *
 * Run with: node scripts/verify-admin-migrations.mjs
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
const db = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(cfg.SITEPIX_SUPABASE_URL, cfg.SITEPIX_SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: false },
});

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const bad = (name, detail) => results.push({ pass: false, name, detail });

const isMissingFunction = (e) =>
  e?.code === "PGRST202" ||
  e?.code === "42883" ||
  /could not find the function/i.test(e?.message ?? "");

// ---------------------------------------------------------------------------
// 20260822120000_admin_team_rollups.sql
// ---------------------------------------------------------------------------

async function checkRollups() {
  const { data: teams, error: teamErr } = await db
    .from("teams")
    .select("id, name")
    .order("created_at", { ascending: false })
    .limit(5);
  if (teamErr) {
    bad("read teams", `${teamErr.code ?? ""} ${teamErr.message}`.trim());
    return;
  }
  const teamIds = (teams ?? []).map((t) => t.id);
  ok("read teams", `${teamIds.length} sampled`);

  // 1. The function exists and is executable by the service role.
  const { data: rollups, error: rollupErr } = await db.rpc("admin_team_rollups", {
    team_ids: teamIds,
  });
  if (rollupErr) {
    bad(
      "admin_team_rollups exists",
      isMissingFunction(rollupErr)
        ? "NOT FOUND - migration 20260822120000 has not run"
        : `${rollupErr.code ?? ""} ${rollupErr.message}`.trim(),
    );
    return;
  }
  ok("admin_team_rollups exists", `${rollups?.length ?? 0} rows`);

  // 2. One row per requested id, including teams with no members. A team that
  //    silently drops out of the result renders as "failed to load".
  if ((rollups?.length ?? 0) === teamIds.length) {
    ok("returns one row per team id");
  } else {
    bad("returns one row per team id", `asked ${teamIds.length}, got ${rollups?.length ?? 0}`);
  }

  // 3. Shape. A missing column here means the app reads undefined and renders 0.
  const first = rollups?.[0];
  const expected = ["team_id", "member_count", "project_count", "photo_count", "storage_bytes"];
  const missing = first ? expected.filter((k) => !(k in first)) : expected;
  if (!first) bad("rollup columns", "no rows to inspect");
  else if (missing.length) bad("rollup columns", `missing: ${missing.join(", ")}`);
  else ok("rollup columns", expected.join(", "));

  // 4. An unknown uuid must come back as zeroes, not as an absent row - the
  //    unnest()-driven shape the migration deliberately chose.
  const { data: unknownRows, error: unknownErr } = await db.rpc("admin_team_rollups", {
    team_ids: ["00000000-0000-0000-0000-000000000000"],
  });
  if (unknownErr) bad("unknown id returns a zero row", unknownErr.message);
  else if (unknownRows?.length === 1 && Number(unknownRows[0].member_count) === 0)
    ok("unknown id returns a zero row");
  else bad("unknown id returns a zero row", JSON.stringify(unknownRows));

  // 5. The per-project sibling.
  const { data: projects } = await db.from("projects").select("id").limit(5);
  const projectIds = (projects ?? []).map((p) => p.id);
  const { data: projRollups, error: projErr } = await db.rpc("admin_project_rollups", {
    project_ids: projectIds,
  });
  if (projErr) {
    bad(
      "admin_project_rollups exists",
      isMissingFunction(projErr)
        ? "NOT FOUND - migration 20260822120000 ran only partially"
        : `${projErr.code ?? ""} ${projErr.message}`.trim(),
    );
  } else {
    ok("admin_project_rollups exists", `${projRollups?.length ?? 0} rows`);
  }

  // 6. Agreement with the independent count. These functions replaced an
  //    in-process computation; if they disagree with a direct count, the admin
  //    dashboard is now confidently wrong, which is worse than being slow.
  await crossCheck(rollups ?? []);

  // 7. The REVOKE. SECURITY DEFINER reads past RLS, so an anon caller reaching
  //    this is a full cross-tenant leak - the exact class of bug
  //    20260811000000_lock_down_anon_reads.sql was written for.
  const { data: anonData, error: anonErr } = await anon.rpc("admin_team_rollups", {
    team_ids: teamIds,
  });
  if (anonErr)
    ok("anon cannot execute the rollup", `${anonErr.code ?? ""} ${anonErr.message}`.trim());
  else bad("anon cannot execute the rollup", `LEAK - returned ${anonData?.length ?? 0} rows`);
}

/** Recompute one team's numbers the long way and compare. */
async function crossCheck(rollups) {
  const target = rollups.find((r) => Number(r.member_count) > 0) ?? rollups[0];
  if (!target) {
    bad("rollup agrees with a direct count", "no team to check");
    return;
  }

  const { data: members } = await db
    .from("team_members")
    .select("user_id")
    .eq("team_id", target.team_id);
  const memberIds = (members ?? []).map((m) => m.user_id);

  if (Number(target.member_count) !== memberIds.length) {
    bad(
      "rollup member_count agrees",
      `function ${target.member_count}, direct ${memberIds.length}`,
    );
  } else {
    ok("rollup member_count agrees", `${memberIds.length}`);
  }

  if (!memberIds.length) return;
  const { data: projects } = await db
    .from("projects")
    .select("id")
    .in("created_by", memberIds)
    .is("deleted_at", null);
  const projectCount = (projects ?? []).length;

  if (Number(target.project_count) !== projectCount) {
    bad("rollup project_count agrees", `function ${target.project_count}, direct ${projectCount}`);
  } else {
    ok("rollup project_count agrees", `${projectCount}`);
  }
}

// ---------------------------------------------------------------------------
// 20260822130000_feedback_triage.sql
// ---------------------------------------------------------------------------

async function checkFeedbackTriage() {
  const { error: readErr, count } = await db
    .from("issue_reports")
    .select("id", { count: "exact", head: true });
  if (readErr) {
    bad("read issue_reports", `${readErr.code ?? ""} ${readErr.message}`.trim());
    return;
  }
  ok("read issue_reports", `${count ?? 0} reports on file`);

  // Status distribution - the point of the whole feature.
  const statuses = ["new", "triaged", "resolved", "dismissed"];
  const tallies = [];
  for (const s of statuses) {
    const { count: n } = await db
      .from("issue_reports")
      .select("id", { count: "exact", head: true })
      .eq("status", s);
    tallies.push(`${s}=${n ?? 0}`);
  }
  ok("status distribution", tallies.join("  "));

  // Every row must already be inside the vocabulary, or step 1 of the
  // migration did not run and step 2 would have failed.
  const { count: strays } = await db
    .from("issue_reports")
    .select("id", { count: "exact", head: true })
    .not("status", "in", `(${statuses.join(",")})`);
  if ((strays ?? 0) === 0) ok("no rows outside the status vocabulary");
  else bad("no rows outside the status vocabulary", `${strays} stray rows`);

  // The CHECK constraint. A working constraint rejects this insert, so the
  // throwaway row only exists if the constraint is missing.
  let strayId = null;
  try {
    const { data: inserted, error: insertErr } = await db
      .from("issue_reports")
      .insert({ status: "not_a_real_status", kind: "bug", source: "page", description: null })
      .select("id")
      .single();

    if (insertErr) {
      const isCheck =
        insertErr.code === "23514" || /issue_reports_status_check/.test(insertErr.message);
      if (isCheck) ok("status CHECK constraint rejects a bad value");
      else
        bad(
          "status CHECK constraint rejects a bad value",
          `unexpected: ${insertErr.code} ${insertErr.message}`,
        );
    } else {
      strayId = inserted?.id ?? null;
      bad(
        "status CHECK constraint rejects a bad value",
        "MISSING - the bad status was accepted (cleaning up the row)",
      );
    }
  } finally {
    if (strayId) await db.from("issue_reports").delete().eq("id", strayId);
  }
}

// ---------------------------------------------------------------------------
// 20260822140000_admin_observability.sql
// ---------------------------------------------------------------------------

async function checkObservability() {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: health, error: healthErr } = await db.rpc("admin_api_health", { since });
  if (healthErr) {
    bad(
      "admin_api_health exists",
      isMissingFunction(healthErr)
        ? "NOT FOUND - migration 20260822140000 has not run"
        : `${healthErr.code ?? ""} ${healthErr.message}`.trim(),
    );
    return;
  }
  const h = (health ?? [])[0] ?? {};
  ok(
    "admin_api_health exists",
    `24h: ${h.total_requests ?? 0} requests, ${h.error_5xx ?? 0} server errors, p95 ${h.p95_ms ?? "-"} ms`,
  );

  const { data: ops, error: opsErr } = await db.rpc("admin_api_op_stats", {
    since,
    max_rows: 5,
  });
  if (opsErr) bad("admin_api_op_stats exists", opsErr.message);
  else ok("admin_api_op_stats exists", `${ops?.length ?? 0} ops`);

  const { error: seriesErr } = await db.rpc("admin_api_timeseries", { since });
  if (seriesErr) bad("admin_api_timeseries exists", seriesErr.message);
  else ok("admin_api_timeseries exists");

  // job_runs must exist AND be denied to anon - a new public table is
  // anon-readable by default, which is how the original exposure happened.
  const { error: jobErr, count } = await db
    .from("job_runs")
    .select("id", { count: "exact", head: true });
  if (jobErr) bad("job_runs table exists", `${jobErr.code ?? ""} ${jobErr.message}`.trim());
  else ok("job_runs table exists", `${count ?? 0} recorded runs`);

  const { data: anonJobs, error: anonJobErr } = await anon.from("job_runs").select("id").limit(1);
  if (anonJobErr)
    ok("anon cannot read job_runs", `${anonJobErr.code ?? ""} ${anonJobErr.message}`.trim());
  else bad("anon cannot read job_runs", `LEAK - returned ${anonJobs?.length ?? 0} rows`);

  const { data: anonHealth, error: anonHealthErr } = await anon.rpc("admin_api_health", { since });
  if (anonHealthErr)
    ok(
      "anon cannot execute admin_api_health",
      `${anonHealthErr.code ?? ""} ${anonHealthErr.message}`.trim(),
    );
  else
    bad("anon cannot execute admin_api_health", `LEAK - returned ${anonHealth?.length ?? 0} rows`);

  // Retention function present, NOT invoked - it deletes rows.
  const { error: pruneErr } = await db.rpc("admin_prune_api_audit_logs", { keep_days: 100000 });
  if (pruneErr) bad("admin_prune_api_audit_logs exists", pruneErr.message);
  else ok("admin_prune_api_audit_logs exists", "called with keep_days=100000, deletes nothing");
}

// ---------------------------------------------------------------------------
// 20260822150000_admin_roles.sql
// ---------------------------------------------------------------------------

async function checkAdminRoles() {
  const { data: admins, error } = await db.from("platform_admins").select("user_id, role");
  if (error) {
    bad(
      "platform_admins.role exists",
      /role/.test(error.message)
        ? "NOT FOUND - migration 20260822150000 has not run"
        : `${error.code ?? ""} ${error.message}`.trim(),
    );
    return;
  }
  const rows = admins ?? [];
  ok("platform_admins.role exists", rows.map((r) => r.role).join(", ") || "(no admins)");

  // Nobody may have been silently narrowed by the migration.
  const unexpected = rows.filter((r) => !["support", "billing", "superadmin"].includes(r.role));
  if (unexpected.length === 0) ok("every admin role is a known value");
  else bad("every admin role is a known value", JSON.stringify(unexpected));

  if (rows.length === 0) {
    bad("at least one superadmin exists", "NO PLATFORM ADMINS AT ALL - the console is unreachable");
  } else if (rows.some((r) => r.role === "superadmin")) {
    ok("at least one superadmin exists");
  } else {
    bad("at least one superadmin exists", "nobody can grant admin or delete accounts");
  }
}

// ---------------------------------------------------------------------------
// 20260822160000_email_confirmed_lookup.sql
// ---------------------------------------------------------------------------

async function checkEmailConfirmedLookup() {
  const { data: members } = await db.from("team_members").select("user_id").limit(5);
  const ids = (members ?? []).map((m) => m.user_id);
  if (!ids.length) {
    bad("email_confirmed_for_users", "no team members to check against");
    return;
  }

  const { data, error } = await db.rpc("email_confirmed_for_users", { user_ids: ids });
  if (error) {
    bad(
      "email_confirmed_for_users exists",
      isMissingFunction(error)
        ? "NOT FOUND - migration 20260822160000 has not run"
        : `${error.code ?? ""} ${error.message}`.trim(),
    );
    return;
  }
  ok("email_confirmed_for_users exists", `${data?.length ?? 0} rows`);

  if ((data?.length ?? 0) === ids.length) ok("returns one row per id");
  else bad("returns one row per id", `asked ${ids.length}, got ${data?.length ?? 0}`);

  // Agreement with GoTrue, which is the source it replaces. A faster answer
  // that disagrees would silently block assigning work to valid accounts.
  let agreed = 0;
  let disagreed = [];
  for (const row of data ?? []) {
    const { data: authUser } = await db.auth.admin.getUserById(row.user_id);
    const viaAuth = !!(authUser?.user ?? {}).email_confirmed_at;
    if (viaAuth === row.email_confirmed) agreed += 1;
    else disagreed.push(`${row.user_id}: sql=${row.email_confirmed} auth=${viaAuth}`);
  }
  if (disagreed.length === 0) ok("agrees with auth.admin.getUserById", `${agreed}/${data.length}`);
  else bad("agrees with auth.admin.getUserById", disagreed.join("; "));

  const { data: anonData, error: anonErr } = await anon.rpc("email_confirmed_for_users", {
    user_ids: ids,
  });
  if (anonErr) ok("anon cannot execute it", `${anonErr.code ?? ""} ${anonErr.message}`.trim());
  else bad("anon cannot execute it", `LEAK - returned ${anonData?.length ?? 0} rows`);
}

// ---------------------------------------------------------------------------

await checkRollups();
await checkFeedbackTriage();
await checkObservability();
await checkAdminRoles();
await checkEmailConfirmedLookup();

console.log("");
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  -  ${r.detail}` : ""}`);
}
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
