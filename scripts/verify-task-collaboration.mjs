/**
 * Read-mostly verification that the two task-collaboration migrations landed:
 *
 *   20260915000000_task_collaboration.sql
 *   20260916000000_notification_preferences.sql
 *
 * Both are applied by hand in the Supabase SQL editor, so "did it run" and "did
 * every part of it run" are different questions. A statement that errored
 * halfway down the file leaves a database with the tables but not the trigger,
 * and nothing in the app would say so - the assignment would save, the bell
 * would stay empty, and that is precisely the bug this release exists to fix.
 *
 * The headline check is behavioural rather than structural: the reason
 * assignment notifications never fired was a trigger body that read OLD on an
 * INSERT, which no amount of "does the function exist" would have caught. So
 * this inserts a task with an assignee and looks for the notification row.
 *
 * === WHAT IT WRITES =======================================================
 * One throwaway task, one watcher row, one comment - all on the workspace
 * owner's OWN account, and all deleted in a finally block along with every
 * notification they raised. Assigning to the owner rather than to a crew member
 * is deliberate: the trigger still fires (the actor is NULL under the
 * service-role key, so it is not a self-notification), but the only bell that
 * flashes for a moment belongs to the person running this.
 *
 * No email is sent. Delivery is the API's job and this never calls it.
 *
 * Run with: node scripts/verify-task-collaboration.mjs
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
/** The key that ships in the browser bundle. Used only to prove it cannot read. */
const anonKey =
  cfg.SITEPIX_SUPABASE_PUBLISHABLE_KEY ?? cfg.SITEPIX_SUPABASE_ANON_KEY ?? cfg.SUPABASE_ANON_KEY;
const anon = anonKey
  ? createClient(cfg.SITEPIX_SUPABASE_URL, anonKey, { auth: { persistSession: false } })
  : null;

const results = [];
const ok = (name, detail = "") => results.push({ pass: true, name, detail });
const bad = (name, detail) => results.push({ pass: false, name, detail });
const skip = (name, detail) => results.push({ pass: true, skipped: true, name, detail });

/** A select that only has to not-error to prove the columns exist. */
async function columnsExist(table, columns, label) {
  const { error } = await db.from(table).select(columns).limit(1);
  if (error) bad(label, `${error.code ?? ""} ${error.message}`.trim());
  else ok(label);
  return !error;
}

const TITLE = "[verify] task collaboration probe";

async function main() {
  let taskId = null;
  let projectId = null;
  let ownerId = null;

  try {
    /* ------------------------------------------------ structure: 20260915 */
    const haveWatchers = await columnsExist(
      "task_watchers",
      "task_id, user_id, added_by, created_at",
      "task_watchers exists with every column",
    );
    const haveComments = await columnsExist(
      "task_comments",
      "id, task_id, project_id, author_id, body, mentions, created_at",
      "task_comments exists with every column",
    );
    const haveEmailedAt = await columnsExist(
      "notifications",
      "id, emailed_at",
      "notifications gained emailed_at",
    );

    /* ------------------------------------------------ structure: 20260916 */
    const havePrefs = await columnsExist(
      "profiles",
      "id, notification_prefs",
      "profiles gained notification_prefs",
    );

    // Every existing row must read as "no preference expressed", not as off. A
    // DEFAULT applied wrongly here would unsubscribe the whole workspace and
    // nothing would say so.
    if (havePrefs) {
      const { data, error } = await db.from("profiles").select("notification_prefs").limit(500);
      if (error) bad("existing accounts read as no-preference", error.message);
      else {
        const odd = (data ?? []).filter(
          (r) => r.notification_prefs == null || typeof r.notification_prefs !== "object",
        );
        if (odd.length) bad("existing accounts read as no-preference", `${odd.length} odd row(s)`);
        else ok("existing accounts read as no-preference", `${data?.length ?? 0} profile(s)`);
      }
    }

    /* ------------------------------------------------- the anon key cannot */
    if (!anon) {
      skip("the browser key cannot read the new tables", "no publishable key in apps/api/.env");
    } else {
      // Supabase grants anon ALL on new public tables by default. Both
      // migrations revoke it; this is the proof, because getting it wrong is
      // silent and total.
      const leaks = [];
      for (const table of ["task_watchers", "task_comments"]) {
        const { data, error } = await anon.from(table).select("*").limit(1);
        if (!error && Array.isArray(data)) leaks.push(table);
      }
      if (leaks.length) bad("the browser key cannot read the new tables", leaks.join(", "));
      else ok("the browser key cannot read the new tables");
    }

    if (!haveWatchers || !haveComments || !haveEmailedAt) {
      bad("behavioural checks", "skipped - 20260915000000 is not fully applied");
      return;
    }

    /* ---------------------------------------------- a project to write on */
    {
      const { data, error } = await db
        .from("projects")
        .select("id, created_by")
        .not("created_by", "is", null)
        .limit(1)
        .maybeSingle();
      if (error || !data) {
        skip("behavioural checks", "no project to probe against");
        return;
      }
      projectId = data.id;
      ownerId = data.created_by;
    }

    /* ============ THE ONE THAT MATTERS: assignment on INSERT ============ */
    // The old trigger body read OLD.assignee_user_id on an INSERT, where OLD is
    // unassigned. Creating a task with an assignee already filled in is how the
    // dialog assigns, so this is the exact path that was broken.
    {
      const { data, error } = await db
        .from("tasks")
        .insert({
          project_id: projectId,
          created_by: ownerId,
          title: TITLE,
          status: "open",
          priority: "normal",
          assignee_user_id: ownerId,
          assigned_by: ownerId,
          photo_ids: [],
        })
        .select("id")
        .single();
      if (error) {
        // `record "old" is not assigned yet` would surface right here.
        bad(
          "a task can be created with an assignee",
          `${error.code ?? ""} ${error.message}`.trim(),
        );
        return;
      }
      taskId = data.id;
      ok("a task can be created with an assignee");
    }

    {
      const { data, error } = await db
        .from("notifications")
        .select("id, type, title, link_path, emailed_at")
        .eq("entity_id", taskId)
        .eq("type", "task_assigned");
      if (error) bad("assigning on INSERT raises a notification", error.message);
      else if (!data?.length)
        bad("assigning on INSERT raises a notification", "no task_assigned row was written");
      else {
        ok("assigning on INSERT raises a notification", data[0].title);
        // A task with no photo must now deep-link to the task itself, not to
        // the project's photo grid.
        if (String(data[0].link_path ?? "").includes("?task="))
          ok("the notification links to the task");
        else bad("the notification links to the task", `link_path = ${data[0].link_path}`);
        // Nothing has been emailed: this script never calls the sender.
        if (data[0].emailed_at == null) ok("emailed_at starts null, as the sender expects");
        else bad("emailed_at starts null, as the sender expects", String(data[0].emailed_at));
      }
    }

    /* ------------------------------------------------- watchers and thread */
    {
      const { error } = await db
        .from("task_watchers")
        .insert({ task_id: taskId, user_id: ownerId, added_by: ownerId });
      if (error) bad("somebody can be copied in on a task", error.message);
      else {
        const { data } = await db
          .from("notifications")
          .select("id, title")
          .eq("entity_id", taskId)
          .eq("type", "task_watching");
        if (data?.length) ok("somebody can be copied in on a task", data[0].title);
        else bad("somebody can be copied in on a task", "no task_watching notification");
      }
    }

    {
      const { data, error } = await db
        .from("task_comments")
        .insert({
          task_id: taskId,
          project_id: projectId,
          author_id: ownerId,
          body: "Verification probe - waiting on part.",
          mentions: [],
        })
        .select("id")
        .single();
      if (error) bad("a note can be left on a task", error.message);
      else {
        ok("a note can be left on a task");
        // The author is excluded, and on this probe the author is also the
        // assignee and the only watcher - so zero rows is the CORRECT answer
        // and proves nobody is notified about their own message.
        const { data: notes } = await db
          .from("notifications")
          .select("id, recipient_id")
          .eq("entity_id", data.id)
          .eq("type", "task_comment");
        if ((notes?.length ?? 0) === 0) ok("a comment does not notify its own author");
        else bad("a comment does not notify its own author", `${notes.length} row(s)`);
      }
    }

    /* --------------------------------- reassignment/closure reaches the CC */
    // The watcher here is the assignee, whom the trigger deliberately excludes
    // (they have their own message), so this asserts the trigger RUNS without
    // error rather than that it produced a row.
    {
      const { error } = await db
        .from("tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .eq("id", taskId);
      if (error) bad("closing a task runs the watcher trigger", error.message);
      else ok("closing a task runs the watcher trigger");
    }
  } finally {
    /* ------------------------------------------------------------- cleanup */
    if (taskId) {
      // Comments and watchers cascade off the task; notifications do not, so
      // they are removed by hand. Everything this script created, gone.
      const { data: comments } = await db.from("task_comments").select("id").eq("task_id", taskId);
      const ids = [taskId, ...(comments ?? []).map((c) => c.id)];
      await db.from("notifications").delete().in("entity_id", ids);
      await db.from("tasks").delete().eq("id", taskId);
      // Belt and braces: anything left carrying the probe's title.
      await db.from("tasks").delete().eq("title", TITLE);
    }
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
  console.log(failures === 0 ? "Task collaboration verified." : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  report();
});
