import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  photoIsDone,
  photoPositionInTask,
  taskPhotoIds,
  taskPhotoItemErrorMessage,
  taskPhotoItemPatch,
  taskPhotoItemRows,
  taskPhotoProgress,
  taskStatusFromPhotos,
  taskWorkSummary,
  type TaskPhotoItem,
} from "../apps/web/src/lib/task-photo-items";

/*
 * A task raised against a dozen photos used to have one status covering all
 * twelve, so the photo viewer's circle - which writes for one picture - closed
 * the work on the other eleven, and nothing anywhere could say which photos
 * were handled.
 *
 * The fix splits per-photo state into `task_photo_items` and derives the task's
 * status from it. That derivation now exists twice, in SQL and in TypeScript,
 * for the same reason the completion rule does: the browser writes these tables
 * directly, so the database has to be the authority and the optimistic UI has
 * to agree with it or every tick corrects itself a second later.
 *
 * These lock the TypeScript half's behaviour, and the fact that the SQL half
 * still says the same thing.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
const MIGRATION = "supabase/migrations/20260906000000_task_photo_items.sql";

const item = (
  taskId: string,
  photoId: string,
  status: "open" | "done",
  note: string | null = null,
): TaskPhotoItem => ({
  task_id: taskId,
  photo_id: photoId,
  status,
  note,
  completed_by: status === "done" ? "u1" : null,
  completed_at: status === "done" ? "2026-09-06T00:00:00.000Z" : null,
});

const forTask = (items: TaskPhotoItem[], taskId: string) =>
  indexTaskPhotoItems(items).get(taskId) ?? null;

describe("progress across the photos a task covers", () => {
  it("counts a photo with no row as outstanding", () => {
    // Rows are created lazily, so "no row" is the normal state of unfinished
    // work and not missing data.
    const p = taskPhotoProgress(["a", "b", "c"], null);
    expect(p).toMatchObject({ total: 3, done: 0, remaining: 3, percent: 0 });
    expect(p.label).toBe("0 of 3 photos done");
  });

  it("reports the middle of a job", () => {
    const items = forTask([item("t", "a", "done"), item("t", "b", "open")], "t");
    const p = taskPhotoProgress(["a", "b", "c"], items);
    expect(p).toMatchObject({ done: 1, remaining: 2, percent: 33 });
    expect(p.label).toBe("1 of 3 photos done");
    expect(p.shortLabel).toBe("1/3");
  });

  it("counts only photos the task still carries", () => {
    /*
     * The item table can outlive membership: drop a photo from a task and its
     * row is still there. Counting rows rather than `photo_ids` would show
     * "3 of 2 done" and, worse, hold a task at done after the work moved.
     */
    const items = forTask(
      [item("t", "a", "done"), item("t", "b", "done"), item("t", "gone", "done")],
      "t",
    );
    const p = taskPhotoProgress(["a", "b"], items);
    expect(p.done).toBe(2);
    expect(p.total).toBe(2);
    expect(p.label).toBe("All 2 photos done");
  });

  it("says nothing about a task with no photos", () => {
    // Most tasks. The single status column still owns them end to end.
    expect(taskPhotoProgress([], null)).toMatchObject({ total: 0, isMulti: false, label: "" });
    expect(taskPhotoProgress(undefined, null).label).toBe("");
  });

  it("does not call one photo a set", () => {
    expect(taskPhotoProgress(["a"], null).isMulti).toBe(false);
    expect(taskPhotoProgress(["a", "b"], null).isMulti).toBe(true);
  });

  /*
   * `photo_ids` is a uuid[] with no uniqueness behind it, and this table is
   * keyed (task_id, photo_id) - one photo listed twice can only ever have one
   * row. Walking the array counted it twice while the SQL counted it once, so a
   * task with a duplicated id read as done here and came back from the database
   * as in progress: the tick that corrects itself a second later, which is the
   * exact failure the two halves exist to prevent. Counting distinct photos is
   * also what the sentence "which photos are handled" means.
   */
  it("counts a photo listed twice once", () => {
    const items = forTask([item("t", "a", "done"), item("t", "b", "done")], "t");
    const p = taskPhotoProgress(["a", "a", "b"], items);
    expect(p).toMatchObject({ total: 2, done: 2, remaining: 0, percent: 100 });
    expect(p.label).toBe("All 2 photos done");
  });

  it("cannot leave a duplicated photo permanently uncompletable", () => {
    const items = forTask([item("t", "a", "done"), item("t", "b", "done")], "t");
    expect(taskStatusFromPhotos(["a", "a", "b"], items, "in_progress")).toBe("done");
  });

  it("does not double-report a duplicated photo as outstanding work", () => {
    const items = forTask([item("t", "a", "done", "Resealed the joint")], "t");
    const summary = taskWorkSummary(["a", "a", "b"], items);
    expect(summary.done).toEqual(["Resealed the joint"]);
    expect(summary.remaining).toBe(1);
  });

  it("never numbers a photo past the total", () => {
    expect(photoPositionInTask(["a", "a", "b"], "b", null)).toBe(
      "Photo 2 of 2 in this task, 0 done",
    );
  });
});

describe("the task status the database is about to derive", () => {
  it("closes the task only when every photo is done", () => {
    const two = forTask([item("t", "a", "done")], "t");
    expect(taskStatusFromPhotos(["a", "b"], two, "open")).toBe("in_progress");

    const both = forTask([item("t", "a", "done"), item("t", "b", "done")], "t");
    expect(taskStatusFromPhotos(["a", "b"], both, "in_progress")).toBe("done");
  });

  it("reopens a closed task when a photo is reopened", () => {
    // The bug in reverse: a task cannot read as completed while work on it is
    // outstanding again.
    const items = forTask([item("t", "a", "open"), item("t", "b", "open")], "t");
    expect(taskStatusFromPhotos(["a", "b"], items, "done")).toBe("open");
  });

  it("leaves a hand-set 'in progress' alone when nothing is ticked", () => {
    // Started but photographed nothing yet is still started.
    expect(taskStatusFromPhotos(["a", "b"], null, "in_progress")).toBe("in_progress");
    expect(taskStatusFromPhotos(["a", "b"], null, "open")).toBe("open");
  });

  it("never touches a task that carries no photos", () => {
    expect(taskStatusFromPhotos([], null, "done")).toBe("done");
    expect(taskStatusFromPhotos(null, null, "in_progress")).toBe("in_progress");
  });
});

describe("what a crew member sees on one picture", () => {
  it("tells them the job is bigger than their photo", () => {
    const items = forTask([item("t", "a", "done")], "t");
    expect(photoPositionInTask(["a", "b", "c"], "b", items)).toBe(
      "Photo 2 of 3 in this task, 1 done",
    );
  });

  it("says nothing when the task is only about this photo", () => {
    // "Photo 1 of 1" is noise on a panel this narrow.
    expect(photoPositionInTask(["a"], "a", null)).toBeNull();
  });

  it("says nothing about a photo the task does not carry", () => {
    expect(photoPositionInTask(["a", "b"], "z", null)).toBeNull();
  });

  it("answers whether this photo in particular is handled", () => {
    const items = forTask([item("t", "a", "done"), item("t", "b", "open")], "t");
    expect(photoIsDone(items, "a")).toBe(true);
    expect(photoIsDone(items, "b")).toBe(false);
    expect(photoIsDone(items, "never-touched")).toBe(false);
  });
});

describe("what was done and what needs to get done", () => {
  it("separates the notes from the outstanding count", () => {
    const items = forTask(
      [
        item("t", "a", "done", "Resealed the flashing"),
        item("t", "b", "done", "   "),
        item("t", "c", "open"),
      ],
      "t",
    );
    expect(taskWorkSummary(["a", "b", "c"], items)).toEqual({
      done: ["Resealed the flashing"],
      doneWithoutNote: 1,
      remaining: 1,
    });
  });

  it("counts an untouched photo as remaining, not as a blank note", () => {
    expect(taskWorkSummary(["a", "b"], null)).toEqual({
      done: [],
      doneWithoutNote: 0,
      remaining: 2,
    });
  });
});

describe("one upsert may not touch the same photo twice", () => {
  /*
   * These rows go out as a single `INSERT ... ON CONFLICT DO UPDATE`, and Postgres
   * rejects a statement that would hit the same conflict target twice with a hard
   * 21000, `ON CONFLICT DO UPDATE command cannot affect row a second time`. So a
   * task whose `photo_ids` named one photo twice could not be closed by "mark the
   * whole task done" at all, and the error read like a database fault.
   */
  it("builds one row per distinct photo", () => {
    const rows = taskPhotoItemRows("t", ["a", "b", "a", "b", "a"], "done");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.photo_id)).toEqual(["a", "b"]);
    expect(new Set(rows.map((r) => `${r.task_id}:${r.photo_id}`)).size).toBe(rows.length);
  });

  it("keeps each photo's own note", () => {
    const notes: Record<string, string> = { a: "Resealed", b: "Replaced" };
    const rows = taskPhotoItemRows("t", ["a", "b"], "done", (id) => notes[id]);
    expect(rows.map((r) => r.note)).toEqual(["Resealed", "Replaced"]);
  });

  it("copes with an empty or absent array", () => {
    expect(taskPhotoItemRows("t", [], "done")).toEqual([]);
    expect(taskPhotoItemRows("t", null, "open")).toEqual([]);
    expect(taskPhotoItemRows("t", undefined, "open")).toEqual([]);
  });

  it("is what the bulk write paths actually call", () => {
    /*
     * Mapping `photo_ids` directly is the shape of the bug, so the two places
     * that close every photo at once are pinned to the helper. A third caller
     * added later that maps the array by hand reintroduces it silently.
     */
    for (const file of [
      "apps/web/src/features/projects/components/ProjectTasks.tsx",
      "apps/web/src/features/projects/pages/GroupPage.tsx",
    ]) {
      const source = read(file);
      expect(source).toContain("taskPhotoItemRows(");
      expect(source).not.toMatch(/photo_?[Ii]ds[^\n]*\.map\(\(photoId\)/);
    }
  });
});

describe("the distinct photos a task covers", () => {
  it("is the one spelling of the dedupe", () => {
    expect(taskPhotoIds(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(taskPhotoIds([])).toEqual([]);
    expect(taskPhotoIds(null)).toEqual([]);
    expect(taskPhotoIds(undefined)).toEqual([]);
  });

  it("keeps the order the task lists them in", () => {
    // The checklist numbers its rows off this, and `photoPositionInTask` reports
    // "Photo N of M" off the same array, so the two have to agree.
    expect(taskPhotoIds(["c", "a", "c", "b"])).toEqual(["c", "a", "b"]);
  });

  it("is what the checklist renders, so no two rows share a React key", () => {
    // Duplicate keys made React reuse one row, so a duplicated photo's two rows
    // shared a single note field, under a label that counted the photo once.
    const checklist = read("apps/web/src/features/projects/components/TaskPhotoChecklist.tsx");
    expect(checklist).toContain("taskPhotoIds(photoIds)");
    expect(checklist).not.toContain("photoIds.map(");
  });
});

describe("the row that gets written", () => {
  it("trims a note and stores an empty one as null", () => {
    expect(taskPhotoItemPatch("t", "p", "done", "  Replaced the fitting  ")).toEqual({
      task_id: "t",
      photo_id: "p",
      status: "done",
      note: "Replaced the fitting",
    });
    expect(taskPhotoItemPatch("t", "p", "open", "   ").note).toBeNull();
    expect(taskPhotoItemPatch("t", "p", "open").note).toBeNull();
  });

  it("never sends its own completed_at or completed_by", () => {
    /*
     * Stamped by the trigger. A client that supplies who closed something is a
     * client that can be wrong about it, and this is the record the completion
     * notification and any report are read off.
     */
    const patch = taskPhotoItemPatch("t", "p", "done", "note");
    expect(Object.keys(patch).sort()).toEqual(["note", "photo_id", "status", "task_id"]);
  });
});

describe("telling 'no table yet' apart from 'the database said no'", () => {
  /*
   * Both panels guard their WRITES with this, and answer a true result by turning
   * the per-photo UI off for the session and pointing the user at the SQL editor.
   * So anything it matches by accident becomes a working feature reported as an
   * unapplied migration.
   */
  it("recognises a table that really is not there", () => {
    expect(
      isMissingTaskPhotoItems({
        code: "PGRST205",
        message: "Could not find the table 'public.task_photo_items' in the schema cache",
      }),
    ).toBe(true);
    expect(
      isMissingTaskPhotoItems({
        code: "42P01",
        message: 'relation "public.task_photo_items" does not exist',
      }),
    ).toBe(true);
  });

  it("does not mistake a row-level-security refusal for a missing table", () => {
    // Reachable: the policies key off `are_teammates` against the parent task, so
    // lapsed team membership lands here. The old text match saw the table name in
    // the sentence and swallowed it.
    expect(
      isMissingTaskPhotoItems({
        code: "42501",
        message: 'new row violates row-level security policy for table "task_photo_items"',
      }),
    ).toBe(false);
  });

  it("does not mistake a foreign key violation for a missing table", () => {
    expect(
      isMissingTaskPhotoItems({
        code: "23503",
        message:
          'insert or update on table "task_photo_items" violates foreign key constraint "task_photo_items_photo_id_fkey"',
      }),
    ).toBe(false);
  });

  it("passes the completion rule and membership refusals straight through", () => {
    // These carry a sentence written for the person reading it, so the panels
    // must show them rather than blame the schema.
    expect(
      isMissingTaskPhotoItems({
        code: "23514",
        message:
          "Only the assignee, the person who assigned it, or a manager can mark this photo done.",
      }),
    ).toBe(false);
    expect(
      isMissingTaskPhotoItems({ code: "23503", message: "That photo is not part of this task." }),
    ).toBe(false);
  });

  /*
   * "Unfriendly info" is the client's own phrase for raw identifiers on screen,
   * and a foreign key constraint name on a field phone is the worst case of it.
   */
  it("shows the trigger's own sentence when there is one", () => {
    expect(
      taskPhotoItemErrorMessage({ code: "23503", message: "That photo is not part of this task." }),
    ).toBe("That photo is not part of this task.");
    expect(
      taskPhotoItemErrorMessage({
        code: "23514",
        message:
          "Only the assignee, the person who assigned it, or a manager can mark this photo done.",
      }),
    ).toBe("Only the assignee, the person who assigned it, or a manager can mark this photo done.");
  });

  it("never puts a constraint name in front of a crew member", () => {
    const fk = taskPhotoItemErrorMessage({
      code: "23503",
      message:
        'insert or update on table "task_photo_items" violates foreign key constraint "task_photo_items_photo_id_fkey"',
    });
    expect(fk).toBe("That photo is no longer part of this task. Reload and try again.");

    const rls = taskPhotoItemErrorMessage({
      code: "42501",
      message: 'new row violates row-level security policy for table "task_photo_items"',
    });
    expect(rls).toContain("no longer have access");

    for (const shown of [fk, rls]) {
      expect(shown).not.toContain("task_photo_items");
      expect(shown).not.toContain("constraint");
      expect(shown).not.toContain("violates");
    }
  });

  it("falls back to something actionable for a refusal it has no copy for", () => {
    const shown = taskPhotoItemErrorMessage({
      code: "22P02",
      message: 'invalid input syntax for type uuid: "nope"',
    });
    expect(shown).toBe("Could not save that change. Reload and try again.");
    expect(taskPhotoItemErrorMessage(null)).toBe(
      "Could not save that change. Reload and try again.",
    );
  });

  it("still copes with an error object carrying no code", () => {
    expect(isMissingTaskPhotoItems({ message: "...does not exist" })).toBe(true);
    expect(isMissingTaskPhotoItems({ message: "Failed to fetch" })).toBe(false);
    expect(isMissingTaskPhotoItems(null)).toBe(false);
    expect(isMissingTaskPhotoItems(undefined)).toBe(false);
  });
});

describe("the SQL half still says the same thing", () => {
  const sql = read(MIGRATION);

  it("derives the task status in the same order as the TypeScript", () => {
    // taskStatusFromPhotos: all done -> done, some -> in_progress, none but
    // currently done -> open, otherwise unchanged.
    const body = sql.slice(sql.indexOf("task_photo_rollup_status"));
    const returns = [...body.matchAll(/RETURN '(\w+)'/g)].map((m) => m[1]);
    expect(returns.slice(0, 3)).toEqual(["done", "in_progress", "open"]);
    expect(body).toContain("IF _done >= _total THEN");
    expect(body).toContain("ELSIF _done > 0 THEN");
    expect(body).toContain("ELSIF _current = 'done' THEN");
  });

  it("counts against photo_ids, not against the item rows", () => {
    expect(sql).toContain("i.photo_id = ANY(_photo_ids)");
  });

  it("counts photos rather than array slots, the same as the TypeScript", () => {
    /*
     * `array_length` against a table keyed (task_id, photo_id) made a task with
     * a duplicated photo id permanently uncompletable, and disagreed with
     * `taskPhotoProgress`, which deduplicates. Pinned in both files because a
     * silent disagreement here is a tick that undoes itself on reload.
     */
    expect(sql).toContain("count(DISTINCT m.photo_id) INTO _total");
    expect(sql).not.toContain("array_length(_photo_ids, 1)");
  });

  it("refuses a new row for a photo the task does not carry", () => {
    // The foreign key only proves the photo exists; membership is photo_ids.
    // INSERT only - an UPDATE has to stay able to reopen a row whose photo has
    // since been dropped from the task.
    expect(sql).toContain("RAISE EXCEPTION 'That photo is not part of this task.'");
    expect(sql).toContain("IF TG_OP = 'INSERT'");
  });

  it("stops a task carrying a photo that no longer exists", () => {
    /*
     * `photo_ids` has no foreign key and photos are hard deleted - by hand in
     * trash/service.ts and on a schedule in hooks/purge-trash.ts. A dead id in
     * the array counts toward the denominator and can never have a row against
     * it, so the task was uncompletable by anyone, forever.
     */
    expect(sql).toContain("AFTER DELETE ON public.photos");
    expect(sql).toContain("REFERENCING OLD TABLE AS deleted");
    expect(sql).toContain("prune_deleted_photos_from_tasks");
    // The photos already purged before the trigger existed.
    expect(sql).toMatch(/UPDATE public\.tasks t\s+SET photo_ids = ARRAY\(/);
  });

  it("prunes before it backfills, and only arms the sync trigger afterwards", () => {
    /*
     * Order is the whole correctness of sections 5 to 8. Pruning while
     * `tasks_sync_photo_items` is live recomputes a closed task against item rows
     * the backfill has not written yet, reopens it - and the backfill only covers
     * tasks that are still 'done', so the completion is then gone rather than
     * merely wrong.
     */
    const prune = sql.indexOf("5. MEMBERSHIP HYGIENE");
    const backfill = sql.indexOf("INSERT INTO public.task_photo_items");
    const reconcile = sql.indexOf("7. RECONCILE");
    const armSync = sql.indexOf("CREATE TRIGGER tasks_sync_photo_items");
    for (const at of [prune, backfill, reconcile, armSync]) expect(at).toBeGreaterThan(-1);
    expect(prune).toBeLessThan(backfill);
    expect(backfill).toBeLessThan(reconcile);
    expect(reconcile).toBeLessThan(armSync);
    // Dropped up front so a re-run gets the same trigger-free window as a first.
    expect(sql.indexOf("DROP TRIGGER IF EXISTS tasks_sync_photo_items")).toBeLessThan(prune);
  });

  it("puts back every trigger it silenced, and fails if it did not", () => {
    // A migration that leaves `tasks_notify_completed` disabled stops completion
    // notifications for good, silently. Cheaper to assert than to discover.
    for (const name of ["tasks_updated_at", "tasks_notify_completed"]) {
      expect(sql).toContain(`ALTER TABLE public.tasks DISABLE TRIGGER ${name}`);
      expect(sql).toContain(`ALTER TABLE public.tasks ENABLE TRIGGER ${name}`);
      expect(sql.indexOf(`DISABLE TRIGGER ${name}`)).toBeLessThan(
        sql.indexOf(`ENABLE TRIGGER ${name}`),
      );
    }
    expect(sql).toContain("Migration finished with triggers still disabled");
  });

  it("raises exactly the sentences the client passes through", () => {
    /*
     * `taskPhotoItemErrorMessage` allow-lists these word for word, so a reworded
     * RAISE here would silently start showing the generic fallback instead. Both
     * halves are pinned rather than one, for the same reason the rollup is.
     */
    for (const sentence of [
      "That photo is not part of this task.",
      "Only the assignee, the person who assigned it, or a manager can mark this photo done.",
    ]) {
      expect(sql).toContain(`RAISE EXCEPTION '${sentence}'`);
      // The allow-list moved to `@everlumen/shared` so the mobile task screens
      // judge photo completion by the same rules. `apps/web/src/lib/
      // task-photo-items.ts` is now a re-export, so the sentences live here.
      expect(read("packages/shared/src/task-photo-items.ts")).toContain(sentence);
    }
  });

  it("recovers a completion date instead of restamping it to now()", () => {
    /*
     * Purging one photo off a fully closed task takes it through 'not done' and
     * back inside one statement: the foreign key cascade drops that photo's item
     * row and the rollup demotes while `photo_ids` still names it, then the
     * section 5 trigger prunes the id and the status recomputes honestly. Both
     * ends correct, and a bare `COALESCE(completed_at, now())` in the middle moved
     * the date to the purge. The item rows still hold the real one.
     */
    expect(sql).toContain("public.task_photo_completed_at(uuid, uuid[])");
    // Every place that writes a TASK's completed_at - the rollup, the photo_ids
    // sync and the reconcile - has to go through it.
    const taskPromotions = [...sql.matchAll(/completed_at\s*:?=\s*CASE[\s\S]*?END/g)];
    expect(taskPromotions).toHaveLength(3);
    for (const m of taskPromotions) {
      expect(m[0]).toContain("task_photo_completed_at");
    }
    /*
     * The one deliberate exception, and the reason the assertion above is scoped
     * to CASE blocks: an ITEM row's own stamp is `now()` because the tick is
     * happening now. Recovering a date from siblings would be wrong there.
     */
    expect(sql).toContain("NEW.completed_at := COALESCE(NEW.completed_at, now());");
  });

  it("keeps both SECURITY DEFINER readers off the authenticated role", () => {
    for (const fn of [
      "public.task_photo_rollup_status(uuid, uuid[], text)",
      "public.task_photo_completed_at(uuid, uuid[])",
    ]) {
      expect(sql).toContain(`REVOKE ALL ON FUNCTION ${fn}`);
      expect(sql).not.toContain(`GRANT EXECUTE ON FUNCTION ${fn}`);
    }
  });

  it("keeps the rollup helper off the authenticated role", () => {
    /*
     * It is SECURITY DEFINER and reads `task_photo_items` with the policies in
     * section 2 switched off. Its only callers are triggers, which run as the
     * definer regardless, so a grant would add nothing but an RLS bypass.
     */
    expect(sql).toContain(
      "REVOKE ALL ON FUNCTION public.task_photo_rollup_status(uuid, uuid[], text)",
    );
    expect(sql).not.toMatch(/GRANT EXECUTE ON FUNCTION public\.task_photo_rollup_status/);
  });

  it("asks the shared completion rule before closing anything", () => {
    // Same function the task, checklist and workflow triggers use, so closing
    // one photo of somebody else's task is refused the same way.
    expect(sql).toContain("public.may_complete_assignment");
    expect(sql).toMatch(
      /RAISE EXCEPTION 'Only the assignee, the person who assigned it, or a manager/,
    );
  });

  it("stamps the completer server side rather than trusting the client", () => {
    expect(sql).toContain("NEW.completed_by := COALESCE(NEW.completed_by, auth.uid())");
    expect(sql).toContain("NEW.completed_at := COALESCE(NEW.completed_at, now())");
  });

  it("re-runs the rollup when the photos on a task change", () => {
    // Otherwise dropping the last outstanding photo leaves a task stuck open
    // with nothing left to close it.
    expect(sql).toContain("BEFORE UPDATE OF photo_ids ON public.tasks");
    expect(sql).toContain("WHEN (OLD.photo_ids IS DISTINCT FROM NEW.photo_ids)");
  });

  it("backfills only the tasks that were already closed", () => {
    expect(sql).toContain("WHERE t.status = 'done'");
    // photo_ids is a bare uuid[], so it can name photos that no longer exist
    // and the foreign key here would reject them.
    expect(sql).toContain("EXISTS (SELECT 1 FROM public.photos ph WHERE ph.id = p.photo_id)");
  });

  it("takes both table locks before it does any work", () => {
    /*
     * The first run of this deadlocked (40P01) against the live app. The RLS
     * policies make one app request touch `task_photo_items` and `tasks`
     * together, so the migration and the app were taking the same two locks in
     * opposite orders. Asking for both up front, `tasks` first, removes the
     * cycle - but only for as long as the LOCK statements stay ahead of the
     * first DDL, which is what this pins.
     */
    const lockAt = sql.indexOf("LOCK TABLE public.tasks IN ACCESS EXCLUSIVE MODE");
    const createAt = sql.indexOf("CREATE TABLE IF NOT EXISTS public.task_photo_items");
    expect(lockAt).toBeGreaterThan(-1);
    expect(lockAt).toBeLessThan(createAt);
    // The second table only exists on a re-run, so it is locked conditionally.
    expect(sql).toContain("to_regclass('public.task_photo_items')");
  });

  it("is safe to re-run after a failure", () => {
    // The recovery path from a deadlock or a lock timeout is running it again,
    // so no statement may be write-once.
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS");
    expect(sql).toContain("ON CONFLICT (task_id, photo_id) DO NOTHING");
    for (const trigger of [
      "task_photo_items_enforce_completer",
      "task_photo_items_rollup",
      "tasks_sync_photo_items",
    ]) {
      expect(sql).toContain(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
    // Every CREATE POLICY is preceded by its own DROP POLICY IF EXISTS.
    const policies = [...sql.matchAll(/CREATE POLICY "([^"]+)"/g)].map((m) => m[1]);
    expect(policies.length).toBeGreaterThan(0);
    for (const name of policies) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${name}"`);
    }
  });
});

describe("the two panels write the photo, not the task", () => {
  const photoPanel = read("apps/web/src/features/photos/components/PhotoTasksPanel.tsx");
  const projectPanel = read("apps/web/src/features/projects/components/ProjectTasks.tsx");

  it("the photo viewer no longer closes a task from one picture", () => {
    /*
     * The regression this whole change exists to prevent. The circle in the
     * lightbox used to run `tasks.update({ status })`, which is a write about
     * every photo the task carries.
     */
    expect(photoPanel).toContain("setPhotoDone");
    expect(photoPanel).toContain("TASK_PHOTO_ITEMS_TABLE");
    // The task-status write survives only as the fallback for a database that
    // has not had the migration applied yet.
    const statusWrites = [...photoPanel.matchAll(/\.update\(\{ status: next/g)];
    expect(statusWrites).toHaveLength(1);
    expect(photoPanel).toContain("const cycleTaskStatus");
  });

  it("the project tab closes a task by closing its photos", () => {
    expect(projectPanel).toContain("writeAllPhotoItems");
    expect(projectPanel).toContain("isPhotoDriven");
  });

  it("the cross-project group rollup closes photos too", () => {
    /*
     * The third place a task gets closed from. Writing `status` alone here
     * stamped "Completed" over a job with twelve untouched pictures, and the
     * first tick on any one of them rolled it straight back to in progress -
     * the rollup counting one done out of twelve. It needs `photo_ids` from the
     * API to do that, so both halves are pinned.
     */
    const groupPage = read("apps/web/src/features/projects/pages/GroupPage.tsx");
    const groupsApi = read("apps/api/src/domains/projects/groups.ts");
    expect(groupPage).toContain("TASK_PHOTO_ITEMS_TABLE");
    // Via the row builder, which is what keeps a duplicated photo id from making
    // the upsert touch one row twice.
    expect(groupPage).toContain("taskPhotoItemRows(");
    // `\s*` after the paren: the column list is long enough that Prettier puts
    // it on its own line, which is a formatting choice, not a change of intent.
    expect(groupsApi).toMatch(/\.select\(\s*"id, project_id[^"]*photo_ids/);
  });

  it("both survive the migration not having been applied yet", () => {
    // Migrations in this project are pasted into the SQL editor by hand, so
    // the code lands first and has to degrade to the old behaviour.
    expect(photoPanel).toContain("isMissingTaskPhotoItems");
    expect(projectPanel).toContain("isMissingTaskPhotoItems");
  });

  it("quick-add sends a priority the CHECK constraint allows", () => {
    // 'medium' is not one of low/normal/high/urgent, so every inline add was
    // refused by the database.
    expect(projectPanel).not.toContain('priority: "medium"');
  });
});
