import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const MIGRATION = read("supabase/migrations/20260915000000_task_collaboration.sql");
const OLD_NOTIFICATIONS = read("supabase/migrations/20260728120000_notifications.sql");
const API_SERVICE = read("apps/api/src/domains/tasks/service.ts");
const REGISTRY = read("apps/api/src/domains/rpc/registry.ts");
const PROJECT_TASKS = read("apps/web/src/features/projects/components/ProjectTasks.tsx");
const PHOTO_TASKS = read("apps/web/src/features/photos/components/PhotoTasksPanel.tsx");
const COLLAB_UI = read("apps/web/src/features/projects/components/TaskCollaboration.tsx");
const TASK_FNS = read("apps/web/src/lib/tasks.functions.ts");
const ROUTE = read("apps/web/src/routes/_app.projects.$projectId.tsx");

/**
 * The client's review of the Tasks tab, and what each finding is pinned by.
 *
 * These are structural tests over four languages - PL/pgSQL, the API service,
 * the RPC registry and two React panels - because the feature only works if all
 * four agree, and each one looks perfectly fine on its own when another has
 * drifted. That is exactly how the assignment notification came to be missing:
 * the trigger existed, the bell existed, the tab existed, and nothing arrived.
 */

describe("assignment actually notifies the assignee", () => {
  /*
   * "No notification fires on assignment. I checked the bell icon right after
   *  assigning the task to Jackson - nothing."
   *
   * The trigger has fired AFTER INSERT OR UPDATE since 20260728120000, but its
   * body reads OLD:
   *
   *     IF NEW.assignee_user_id IS DISTINCT FROM COALESCE(OLD.assignee_user_id, NULL)
   *
   * In a PL/pgSQL trigger fired by INSERT, OLD is not assigned - touching a
   * field of it raises `record "old" is not assigned yet`. Creating a task with
   * the assignee already filled in is how the dialog assigns, so that is the
   * path it broke.
   */
  it("the old migration is the one that read OLD on an INSERT trigger", () => {
    // Guards the premise. If this ever stops being true, the fix below is
    // solving a problem that no longer exists and should be re-read.
    expect(OLD_NOTIFICATIONS).toContain("COALESCE(OLD.assignee_user_id, NULL)");
    expect(OLD_NOTIFICATIONS).toContain("AFTER INSERT OR UPDATE OF assignee_user_id");
  });

  it("the new function asks TG_OP instead of asking OLD", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("FUNCTION public.notify_task_assignee()"),
      MIGRATION.indexOf("FUNCTION public.notify_checklist_assignee()"),
    );
    expect(fn).toContain("TG_OP");
    expect(fn).toContain("WHEN 'INSERT' THEN NEW.assignee_user_id IS NOT NULL");
    expect(fn).not.toContain("COALESCE(OLD.assignee_user_id");
  });

  it("fixes the two siblings that copied the same construct", () => {
    /*
     * Read out of the function bodies rather than off the whole file: the
     * migration quotes the broken construct at length in the comment that
     * explains why it is broken, and matching the file would fail on its own
     * explanation.
     */
    const bodyOf = (name: string) => {
      const start = MIGRATION.indexOf(`FUNCTION public.${name}()`);
      expect(start).toBeGreaterThan(-1);
      // Up to the dollar-quote that closes the function body.
      const end = MIGRATION.indexOf("$" + "$;", start);
      expect(end).toBeGreaterThan(start);
      return MIGRATION.slice(start, end);
    };
    for (const name of ["notify_checklist_assignee", "notify_workflow_assignee"]) {
      const fn = bodyOf(name);
      expect(fn).toContain("TG_OP");
      expect(fn).not.toContain("COALESCE(OLD.");
    }
  });

  it("keeps the photo deep link 20260905000000 added", () => {
    // Re-declaring a function is how a later migration silently reverts an
    // earlier one. The link has to survive this file.
    expect(MIGRATION).toContain("'?photo=' || _photo::text");
  });

  it("a task with no photo now opens the task instead of the photo grid", () => {
    // The bare `/projects/<id>` fallback dropped the reader on a wall of
    // thumbnails with nothing saying the message was about a task.
    expect(MIGRATION).toContain("'?task=' || NEW.id::text");
  });
});

describe("the notification leaves the app", () => {
  /*
   * "If a task doesn't push a notification, email, or SMS to the assignee, crew
   *  members have no way to know new work landed on them unless they're
   *  manually refreshing the app."
   *
   * Postgres has no outbound HTTP here, so the trigger decides WHO is owed a
   * message and the API delivers it. `emailed_at` is what makes that split
   * safe: it is the record of what was sent, so a retry is a no-op.
   */
  it("notifications carry a delivery marker the client cannot write", () => {
    expect(MIGRATION).toContain("ADD COLUMN IF NOT EXISTS emailed_at timestamptz");
    // 20260728120000 grants the client UPDATE on read_at alone. Nothing here
    // may widen that.
    expect(MIGRATION).not.toMatch(/GRANT UPDATE\s*\(\s*emailed_at/);
  });

  it("the sender is driven off the notification rows, not off the event", () => {
    expect(API_SERVICE).toContain('.is("emailed_at", null)');
    expect(API_SERVICE).toContain("emailed_at: new Date().toISOString()");
  });

  it("every entry point checks the caller can see the task first", () => {
    // The admin client further down would read any task in the database.
    expect(API_SERVICE).toContain("async function requireVisibleTask");
    for (const fn of [
      "dispatchTaskNotificationsService",
      "addTaskWatchersService",
      "createTaskCommentService",
    ]) {
      const body = API_SERVICE.slice(API_SERVICE.indexOf(`export async function ${fn}`));
      expect(body.slice(0, 600)).toContain("requireVisibleTask");
    }
  });

  it("is registered as RPC so the browser can reach it", () => {
    for (const op of [
      "listTaskCollaboration",
      "createTaskComment",
      "deleteTaskComment",
      "addTaskWatchers",
      "removeTaskWatcher",
      "dispatchTaskNotifications",
    ]) {
      expect(REGISTRY).toContain(`${op}: authed(`);
      expect(TASK_FNS).toContain(`"${op}"`);
    }
  });

  it("every surface that changes an assignment or closes a task dispatches", () => {
    // One helper, so a second surface cannot quietly skip delivery.
    expect(TASK_FNS).toContain("export function notifyTaskChanged");
    expect(PROJECT_TASKS).toContain("notifyTaskChanged");
    expect(PHOTO_TASKS).toContain("notifyTaskChanged");
  });
});

describe("watchers - the CC line", () => {
  /*
   * "Single assignee only, no watchers/CC. You can't loop in a second person
   *  (e.g., assign to a tech but keep the office manager on the task)."
   */
  it("has a table, gated on being able to see the task", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.task_watchers");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.can_see_task");
    expect(MIGRATION).toContain('CREATE POLICY "Watchers visible with the task"');
  });

  it("does NOT make a watcher able to close the work", () => {
    /*
     * A watcher holds nothing. The completion rule is
     * `may_complete_assignment` and its BEFORE UPDATE guards, all declared in
     * 20260819000000, and this migration must not redeclare, drop or grant
     * around any of them. Naming them in a comment is fine; replacing them is
     * not.
     */
    expect(MIGRATION).not.toMatch(
      /(CREATE OR REPLACE|DROP)\s+FUNCTION\s+(IF EXISTS\s+)?public\.may_complete_assignment/,
    );
    expect(MIGRATION).not.toMatch(/FUNCTION public\.enforce_task_completer\(\)/);
    expect(MIGRATION).not.toMatch(/DROP TRIGGER IF EXISTS tasks_enforce_completer/);
  });

  it("tells watchers when the task is reassigned or closed, and nobody twice", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("FUNCTION public.notify_task_watchers()"),
      MIGRATION.indexOf("DROP TRIGGER IF EXISTS tasks_notify_watchers"),
    );
    expect(fn).toContain("_reassigned");
    expect(fn).toContain("_completed");
    // The assignee has task_assigned; the assignor has task_completed.
    expect(fn).toContain("w.user_id IS DISTINCT FROM NEW.assignee_user_id");
    expect(fn).toContain("COALESCE(NEW.assigned_by, NEW.created_by)");
  });

  it("the watcher trigger is UPDATE-only, so it never reads OLD on an insert", () => {
    // The same trap the assignment notification fell into.
    expect(MIGRATION).toContain(
      "AFTER UPDATE OF assignee_user_id, status ON public.tasks\n  FOR EACH ROW EXECUTE FUNCTION public.notify_task_watchers()",
    );
  });

  it("can be filled a whole role at a time", () => {
    // "as the crew grows, one-by-one dropdown assignment won't scale to
    //  'assign all HVAC installs to the HVAC team'."
    expect(COLLAB_UI).toContain("addableRoles");
    expect(COLLAB_UI).toContain("Everyone with");
  });
});

describe("comments - the thread", () => {
  /*
   * "There's nowhere to leave a note like 'waiting on part' or ask a question
   *  without editing the description field, which overwrites rather than logs."
   */
  it("has a table with an author and a time", () => {
    expect(MIGRATION).toContain("CREATE TABLE IF NOT EXISTS public.task_comments");
    expect(MIGRATION).toContain("author_id  uuid NOT NULL REFERENCES auth.users(id)");
  });

  it("only the author can delete their own words", () => {
    expect(MIGRATION).toContain('CREATE POLICY "Authors delete their own comments"');
    expect(MIGRATION).toContain("FOR DELETE TO authenticated USING (author_id = auth.uid())");
  });

  it("reaches everyone on the task, and not the person writing", () => {
    const fn = MIGRATION.slice(
      MIGRATION.indexOf("FUNCTION public.notify_task_comment()"),
      MIGRATION.indexOf("DROP TRIGGER IF EXISTS task_comments_notify"),
    );
    for (const source of ["assignee_user_id", "assigned_by", "created_by", "task_watchers"]) {
      expect(fn).toContain(source);
    }
    expect(fn).toContain("x.user_id <> NEW.author_id");
  });

  it("the project id comes off the task, never off the request", () => {
    const body = API_SERVICE.slice(
      API_SERVICE.indexOf("export async function createTaskCommentService"),
    );
    expect(body).toContain("project_id: task.project_id");
  });
});

describe("assigning to somebody who cannot sign in", () => {
  /*
   * "The existing 'Check Refrigerant Pressure' task is assigned to Gumaro
   *  vazquez, whose email is unconfirmed. The task UI doesn't warn you when
   *  assigning to a pending/unconfirmed teammate."
   *
   * `getMyTeam` has resolved `emailConfirmed` per member since the Teams page
   * grew its warning; the tasks panel simply dropped the field on the way in.
   */
  it("carries emailConfirmed through from the roster", () => {
    expect(PROJECT_TASKS).toContain("emailConfirmed");
    expect(PROJECT_TASKS).toContain('typeof m.emailConfirmed === "boolean"');
  });

  it("warns rather than blocks, and only on false", () => {
    expect(PROJECT_TASKS).toContain("function unconfirmedAssigneeConfirm");
    expect(PROJECT_TASKS).toContain("Assign anyway");
    // null is "the lookup failed", which must never be rendered as a warning.
    expect(PROJECT_TASKS).toContain("emailConfirmed === false");
    expect(PROJECT_TASKS).not.toContain("!m.emailConfirmed");
  });

  it("says it on the row too, not only inside the dialog", () => {
    // The whole problem was that nothing about the list looked wrong.
    expect(PROJECT_TASKS).toContain("Cannot sign in");
  });
});

describe("a task notification arrives at the task", () => {
  it("the link carries ?task= and the route accepts it", () => {
    expect(MIGRATION).toContain("'?task=' || NEW.task_id::text");
    expect(ROUTE).toContain("search.task");
    // Same uuid shape check as ?photo=, so a junk value is a lookup that finds
    // nothing rather than something handed onward.
    expect(ROUTE).toMatch(/test\(search\.task\)/);
  });

  it("the panel opens that task once the rows are in", () => {
    expect(PROJECT_TASKS).toContain("openTaskId");
    expect(PROJECT_TASKS).toContain("onOpenedTask");
  });
});
