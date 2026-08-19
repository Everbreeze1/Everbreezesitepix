/**
 * Verification that 20260919000000_project_assignment_notifications.sql landed,
 * and that staffing a job end-to-end actually writes what it claims to.
 *
 * The migration is applied by hand in the Supabase SQL editor, so "did it run"
 * and "did every part of it run" are different questions. This one widens two
 * CHECK constraints, and a constraint is the least visible thing in a database:
 * nothing about the app looks different until somebody assigns their first
 * teammate, at which point the notification insert is rejected, the API logs it
 * and swallows it, and the person who was staffed is simply never told. That is
 * a silent failure with no symptom on either screen.
 *
 * So the checks are behavioural rather than structural. Reading
 * `pg_get_constraintdef` would prove the text of the constraint; inserting a
 * row proves the constraint accepts what the API is about to send it.
 *
 * === WHAT IT WRITES =======================================================
 * All of it on the workspace owner's OWN account, and all of it deleted in a
 * finally block:
 *
 *   - one `notifications` row of type 'project_assigned', entity_type 'project'
 *   - one `project_assignments` row putting the owner on one of their own jobs,
 *     and only if they were not already on it
 *
 * The owner is used deliberately: they already see every project, so the
 * assignment row grants nothing while it exists, and the only bell that flashes
 * for a moment belongs to the person running this.
 *
 * No email is sent. Delivery is the API's job and this never calls it.
 *
 * Run with: node scripts/verify-project-assignment.mjs
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

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const bad = (name, detail) => results.push({ pass: false, name, detail });
const skip = (name, detail) => results.push({ pass: true, skipped: true, name, detail });

const TITLE = "[verify] project assignment probe";

async function main() {
  let notificationId = null;
  let assignmentId = null;

  try {
    /* ------------------------------------------------ pick a team and a job */
    const { data: members } = await db.from("team_members").select("team_id, user_id, role");
    const owner = (members ?? []).find((m) => m.role === "owner");
    if (!owner) {
      bad("setup", "no team owner to test against");
      return report();
    }

    const teamUserIds = (members ?? [])
      .filter((m) => m.team_id === owner.team_id)
      .map((m) => m.user_id);
    const { data: projects } = await db
      .from("projects")
      .select("id, name")
      .in("created_by", teamUserIds)
      .is("deleted_at", null)
      .limit(1);
    const project = (projects ?? [])[0];
    if (!project) {
      skip("setup", "the owner's team has no projects yet");
      return report();
    }

    /* ---------------------------------- 1. the type list accepts the new value */
    // This is the whole migration, asked the way the API asks it.
    {
      const { data, error } = await db
        .from("notifications")
        .insert({
          recipient_id: owner.user_id,
          actor_id: null,
          type: "project_assigned",
          title: TITLE,
          body: "Written and removed by scripts/verify-project-assignment.mjs",
          link_path: `/projects/${project.id}`,
          project_id: project.id,
          entity_type: "project",
          entity_id: project.id,
        })
        .select("id")
        .maybeSingle();
      if (error) {
        // 23514 is check_violation: the migration did not run, or ran only
        // as far as the first of its two constraints.
        bad(
          "notifications accepts type 'project_assigned' and entity_type 'project'",
          `${error.code ?? ""} ${error.message}`.trim(),
        );
      } else {
        notificationId = data?.id ?? null;
        ok("notifications accepts type 'project_assigned' and entity_type 'project'");
      }
    }

    /* ------------------------------------- 2. the older types still get through */
    // A DROP/ADD that restates the list can drop a value by omission, and the
    // symptom would land on a feature nobody was testing.
    {
      const { data, error } = await db
        .from("notifications")
        .insert({
          recipient_id: owner.user_id,
          actor_id: null,
          type: "task_assigned",
          title: TITLE,
          entity_type: "task",
          entity_id: project.id,
        })
        .select("id")
        .maybeSingle();
      if (error) bad("the pre-existing notification types still pass", error.message);
      else {
        ok("the pre-existing notification types still pass");
        await db.from("notifications").delete().eq("id", data.id);
      }
    }

    /* ------------------------------- 3. a non-Restricted member can be staffed */
    // `project_assignments` never constrained the role, but the product used to
    // only ever write Restricted rows into it. This is the assertion that the
    // table is genuinely a crew list now.
    {
      const { data: existing } = await db
        .from("project_assignments")
        .select("id")
        .eq("project_id", project.id)
        .eq("user_id", owner.user_id)
        .maybeSingle();
      if (existing) {
        skip("an owner can be staffed on a job", "already on it, nothing written");
      } else {
        const { data, error } = await db
          .from("project_assignments")
          .insert({
            project_id: project.id,
            user_id: owner.user_id,
            assigned_by: owner.user_id,
          })
          .select("id")
          .maybeSingle();
        if (error) bad("an owner can be staffed on a job", error.message);
        else {
          assignmentId = data?.id ?? null;
          ok("an owner can be staffed on a job");
        }
      }
    }

    /* ----------------------------------- 4. the crew reads back from the job */
    // The shape `getProjectAssignees` returns, asked of the database directly.
    {
      const { data, error } = await db
        .from("project_assignments")
        .select("project_id, user_id")
        .eq("project_id", project.id);
      if (error) bad("the crew is readable from the project side", error.message);
      else if (!(data ?? []).some((r) => r.user_id === owner.user_id))
        bad("the crew is readable from the project side", "the row just written is not there");
      else ok("the crew is readable from the project side");
    }

    /* ------------------------------ 5. one person cannot be staffed twice */
    // UNIQUE (project_id, user_id) from 20260911000000. `setProjectAssignees`
    // de-duplicates before inserting, and this is the backstop under it.
    {
      const { error } = await db.from("project_assignments").insert({
        project_id: project.id,
        user_id: owner.user_id,
        assigned_by: owner.user_id,
      });
      if (error?.code === "23505") ok("a duplicate assignment is refused by the database");
      else if (error) bad("a duplicate assignment is refused by the database", error.message);
      else
        bad(
          "a duplicate assignment is refused by the database",
          "the second insert succeeded - the UNIQUE constraint is missing",
        );
    }
  } finally {
    /* ------------------------------------------------------------- cleanup */
    if (notificationId) await db.from("notifications").delete().eq("id", notificationId);
    if (assignmentId) await db.from("project_assignments").delete().eq("id", assignmentId);
    // Belt and braces: anything left carrying the probe's title.
    await db.from("notifications").delete().eq("title", TITLE);
  }

  report();
}

function report() {
  console.log("");
  let failures = 0;
  for (const r of results) {
    const mark = r.skipped ? "-" : r.pass ? "PASS" : "FAIL";
    if (!r.pass) failures++;
    console.log(`  ${mark.padEnd(4)}  ${r.name}${r.detail ? `  (${r.detail})` : ""}`);
  }
  console.log("");
  console.log(failures === 0 ? "Project assignment verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  report();
});
