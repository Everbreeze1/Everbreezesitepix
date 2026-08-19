import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assignmentPatch,
  assignmentStatus,
  canReopen,
  completionRights,
  isManagerRole,
  overrideConfirm,
} from "../apps/web/src/lib/assignment";

/*
 * The completion rule is written twice - once as SQL triggers, once as the
 * TypeScript that decides whether the button is enabled - because the web app
 * writes to these tables straight from the browser, so the database has to be
 * the enforcement and the UI has to agree with it or every refusal arrives as a
 * surprise toast.
 *
 * Two copies of a rule is exactly the thing that drifts, so these lock it:
 * the behaviour of the TypeScript half, and the fact that the SQL half still
 * names the same four clauses.
 */

const ROOT = resolve(__dirname, "..");
const MIGRATION = join(ROOT, "supabase/migrations/20260819000000_assignment_and_completion.sql");
/** In apply order - later files replace functions defined in earlier ones. */
const MIGRATIONS = [
  MIGRATION,
  join(ROOT, "supabase/migrations/20260819000100_workflow_completed_notifies_creator.sql"),
];

const MANAGER = { userId: "manager", isManager: true };
const CREW = { userId: "crew", isManager: false };

describe("who may mark work complete", () => {
  it("lets anyone close work nobody is assigned to", () => {
    const r = completionRights({ assignedTo: null, assignedBy: null }, CREW);
    expect(r.canComplete).toBe(true);
    expect(r.isOverride).toBe(false);
  });

  it("lets the assignee close their own work, without calling it an override", () => {
    const r = completionRights({ assignedTo: "crew", assignedBy: "manager" }, CREW);
    expect(r.canComplete).toBe(true);
    expect(r.isOverride).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("refuses a crew member closing someone else's work, and says who can", () => {
    const r = completionRights({ assignedTo: "other", assignedBy: "manager" }, CREW, "Jackson");
    expect(r.canComplete).toBe(false);
    expect(r.reason).toContain("Jackson");
  });

  it("lets a manager close work they had nothing to do with, as an override", () => {
    const r = completionRights(
      { assignedTo: "crew", assignedBy: "someone-else" },
      MANAGER,
      "Jackson",
    );
    expect(r.canComplete).toBe(true);
    expect(r.isOverride).toBe(true);
    expect(r.reason).toContain("Jackson");
  });

  /*
   * The exact exchange this feature came from: "I am the manager. I assigned it
   * to Jackson. But I am still able to mark complete." He keeps the ability -
   * a tech can be unreachable - but delegating the work and then closing it
   * yourself is somebody else's name being signed, so it is an override and the
   * UI confirms it. A silent pass here would reproduce the original complaint.
   */
  it("treats the assignor closing what they delegated as an override too", () => {
    const r = completionRights({ assignedTo: "crew", assignedBy: "manager" }, MANAGER, "Jackson");
    expect(r.canComplete).toBe(true);
    expect(r.isOverride).toBe(true);
  });

  it("counts a non-manager assignor as an override as well, not a free pass", () => {
    const assignor = { userId: "assignor", isManager: false };
    const r = completionRights({ assignedTo: "crew", assignedBy: "assignor" }, assignor);
    expect(r.canComplete).toBe(true);
    expect(r.isOverride).toBe(true);
  });

  it("refuses a signed-out viewer outright", () => {
    const r = completionRights(
      { assignedTo: null, assignedBy: null },
      { userId: null, isManager: false },
    );
    expect(r.canComplete).toBe(false);
  });
});

describe("who may reopen", () => {
  // Reopening is looser than completing on purpose: the assignor is notified
  // that the work is done specifically so they can review or send it back.
  it("allows the assignor, the assignee, the author, the completer and any manager", () => {
    const subject = {
      assignedTo: "crew",
      assignedBy: "assignor",
      createdBy: "author",
      completedBy: "crew",
    };
    for (const id of ["crew", "assignor", "author"]) {
      expect(canReopen(subject, { userId: id, isManager: false })).toBe(true);
    }
    expect(canReopen(subject, { userId: "stranger", isManager: true })).toBe(true);
  });

  it("refuses an unrelated crew member", () => {
    expect(
      canReopen(
        { assignedTo: "crew", assignedBy: "assignor", createdBy: "author" },
        { userId: "stranger", isManager: false },
      ),
    ).toBe(false);
  });
});

describe("status shown next to the complete button", () => {
  it("reads complete once it is closed, whatever the item counts say", () => {
    expect(assignmentStatus({ completedAt: "2026-08-14T00:00:00Z", done: 0, total: 9 })).toBe(
      "complete",
    );
  });

  it("reads in progress from work done, not from having an assignee", () => {
    expect(assignmentStatus({ completedAt: null, done: 4, total: 9 })).toBe("in_progress");
  });

  it("reads pending when nothing has been answered", () => {
    expect(assignmentStatus({ completedAt: null, done: 0, total: 9 })).toBe("pending");
  });
});

describe("recording an assignment", () => {
  it("writes the assignor alongside the assignee", () => {
    expect(assignmentPatch("crew", "manager")).toEqual({
      assigned_to: "crew",
      assigned_by: "manager",
    });
  });

  it("clears the assignor when the assignee is cleared", () => {
    // A dangling `assigned_by` would aim the completion notification at someone
    // who no longer has anything to do with the record.
    expect(assignmentPatch(null, "manager")).toEqual({
      assigned_to: null,
      assigned_by: null,
    });
  });
});

describe("manager roles match the ones Settings labels as management", () => {
  it("counts owner and admin, not member", () => {
    expect(isManagerRole("owner")).toBe(true);
    expect(isManagerRole("admin")).toBe(true);
    expect(isManagerRole("member")).toBe(false);
    expect(isManagerRole(null)).toBe(false);
  });
});

describe("the SQL half still says the same thing", () => {
  const sql = readFileSync(MIGRATION, "utf8");

  it("keeps all four allow-clauses in may_complete_assignment", () => {
    const body = sql.slice(
      sql.indexOf("FUNCTION public.may_complete_assignment"),
      sql.indexOf("GRANT EXECUTE ON FUNCTION public.is_team_manager"),
    );
    expect(body).toContain("_assigned_to IS NULL");
    expect(body).toContain("_assigned_to = _actor");
    expect(body).toContain("_assigned_by = _actor");
    expect(body).toContain("public.is_team_manager(_actor)");
  });

  /*
   * The guard reads OLD so that one UPDATE cannot assign the work to itself and
   * close it in the same statement. Switching any of these to NEW reopens that
   * hole silently - nothing else in the system would fail.
   */
  it("judges completion against OLD, never NEW", () => {
    const guards = sql.match(/may_complete_assignment\((NEW|OLD)\.[^)]*\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
    for (const g of guards) expect(g).not.toContain("NEW.");
  });

  it("guards all three assignable records", () => {
    for (const trigger of [
      "checklists_enforce_completer",
      "tasks_enforce_completer",
      "workflows_enforce_completer",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
    }
  });

  it("tells the assignor when each kind of work is closed", () => {
    for (const trigger of [
      "checklists_notify_completed",
      "tasks_notify_completed",
      "workflows_notify_completed",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER ${trigger}`);
    }
    // Falling back to the record's owner keeps work that was never formally
    // handed over from notifying nobody.
    expect(sql).toContain("COALESCE(NEW.assigned_by, NEW.created_by)");
  });

  /*
   * All three must address the same person the same way, which is the whole
   * point of the feature - two records closed identically should not notify
   * different people for reasons nothing in the UI explains.
   *
   * `notify_workflow_completed` originally reached through `project_workflows`
   * to the PROJECT's owner, on the mistaken belief that the table had no
   * `created_by` of its own (it has had one, NOT NULL, since 20260616050717).
   * That only bit unassigned workflows - where `assigned_by` is NULL and the
   * fallback actually runs - but on a team where a manager applies workflows to
   * jobs they did not create, it sent the report to the wrong person entirely.
   * Fixed in 20260819000100; this reads the LAST definition of each function
   * across both files, so a future migration that regresses it fails here.
   */
  it("addresses all three completion notifications to the same person", () => {
    const combined = MIGRATIONS.map((m) => readFileSync(m, "utf8")).join("\n");
    for (const fn of [
      "notify_checklist_completed",
      "notify_task_completed",
      "notify_workflow_completed",
    ]) {
      // Anchored on CREATE OR REPLACE, not on `FUNCTION public.<fn>()` - the
      // latter also matches the trigger's `EXECUTE FUNCTION` clause, which
      // sits after the definition and would slice the wrong span.
      const last = combined.lastIndexOf(`CREATE OR REPLACE FUNCTION public.${fn}()`);
      expect(last, `${fn} not defined`).toBeGreaterThan(-1);
      const body = combined.slice(last, combined.indexOf("$$;", last));
      expect(body, `${fn} recipient`).toContain("COALESCE(NEW.assigned_by, NEW.created_by)");
      // Reaching into another table for the fallback is what went wrong before.
      expect(body, `${fn} should not look up the project`).not.toContain("FROM public.projects");
    }
  });

  /*
   * 20260724010000 restricts creating a workflow to Team-plan workspaces with a
   * permissive INSERT policy. RLS ORs permissive policies together, so any
   * second INSERT path on this table - a `FOR ALL` teammate policy carries one
   * in its WITH CHECK - repeals that gate without touching it.
   */
  it("never grants teammates a second INSERT path into workflows", () => {
    const workflowPolicies =
      sql.match(/CREATE POLICY "Teammates[^"]*workflow[^"]*"[\s\S]*?;\n/g) ?? [];
    expect(workflowPolicies.length).toBeGreaterThanOrEqual(6);
    for (const p of workflowPolicies) {
      expect(p).not.toMatch(/FOR ALL/);
      expect(p).not.toMatch(/FOR INSERT/);
      expect(p).not.toMatch(/WITH CHECK/);
    }
  });
});

/*
 * The client's re-report: the warning fired on the task row's progress button
 * but not when the same task was opened and completed from its edit dialog, so
 * a manager could close a tech's work silently by taking the long way round.
 *
 * The rule was never the problem - every screen imported it. What differed was
 * the ceremony: some callers checked `canComplete` (may I?) and skipped
 * `isOverride` (is this someone else's name?). These lock the pairing, because
 * the next completion path added will be tempted to do the same.
 */
describe("the override confirmation", () => {
  it("names the assignee and says who the record will credit", () => {
    const copy = overrideConfirm({ what: "Fix gutter", who: "Jackson" });
    expect(copy.title).toContain("Jackson");
    expect(copy.description).toContain("Fix gutter");
    expect(copy.description).toContain("Jackson");
    // The point of the sentence: closing it does not read as Jackson's sign-off.
    expect(copy.description).toContain("you closed it, not Jackson");
    expect(copy.confirmText).toBe("Complete anyway");
  });

  it("appends what is true only of one surface, and nothing when there is none", () => {
    const withDetail = overrideConfirm({
      what: "Roof inspection",
      who: "Ana",
      detail: "The sealed record is signed in your name.",
    });
    expect(withDetail.description).toContain("The sealed record is signed in your name.");
    expect(overrideConfirm({ what: "Roof inspection", who: "Ana" }).description).not.toContain(
      "sealed",
    );
  });

  it("falls back to a phrase rather than printing an empty name", () => {
    expect(overrideConfirm({ what: "Task", who: "   " }).title).toContain("the assignee");
  });

  /*
   * Every screen that can close assigned work, listed by path because that is
   * the only way to catch the one that quietly does not ask. If a file moves,
   * move it here too.
   */
  const COMPLETION_SITES = [
    "apps/web/src/features/projects/components/ProjectTasks.tsx",
    "apps/web/src/features/photos/components/PhotoTasksPanel.tsx",
    "apps/web/src/features/projects/pages/GroupPage.tsx",
    "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
    "apps/web/src/features/projects/pages/ChecklistDocumentPage.tsx",
  ];

  it("is asked wherever completion is refused", () => {
    for (const rel of COMPLETION_SITES) {
      const src = readFileSync(join(ROOT, rel), "utf8");
      const guards = [...src.matchAll(/if \(!rights\.canComplete\) \{/g)];
      expect(guards.length, `${rel} checks the rule`).toBeGreaterThan(0);
      for (const g of guards) {
        // The override branch sits directly after the refusal branch at every
        // one of these sites; a guard without one is a path that closes
        // somebody else's work without saying so.
        const after = src.slice(g.index!, g.index! + 900);
        expect(after, `${rel} confirms the override at index ${g.index}`).toContain(
          "rights.isOverride",
        );
      }
      expect(src, `${rel} uses the shared wording`).toContain("overrideConfirm(");
    }
  });

  /*
   * The edit dialog judges the values on screen, not the row it opened with.
   * Assigning a task to someone and marking it done in the same save is exactly
   * the case that has to warn, and reading `task.assignee_user_id` would judge
   * it against the person who held it a moment ago - or, for a task being
   * created, against nobody at all.
   */
  it("judges the task dialog on the assignee it is about to save", () => {
    const src = readFileSync(
      join(ROOT, "apps/web/src/features/projects/components/ProjectTasks.tsx"),
      "utf8",
    );
    expect(src).toContain("assignedTo: assigneeUserId || null, assignedBy: pendingAssignedBy");
    // Re-saving an already-done task is not a completion and must not re-ask.
    expect(src).toContain('const completesNow = status === "done" && task?.status !== "done"');
  });
});

/*
 * `assigned_by` was added after tasks were, so rows predating it hold NULL. The
 * dialog backfills it on save, which is right for notifications and wrong as an
 * input to the rule: reading a value you are about to write is how the person
 * doing the writing ends up qualifying as the assignor.
 */
describe("tasks that predate the assignor column", () => {
  it("does not let an editor become the assignor of work assigned to someone else", () => {
    const legacy = { assignedTo: "other", assignedBy: null };
    expect(completionRights(legacy, CREW, "Jackson").canComplete).toBe(false);
    // A manager still can, and it is still called an override.
    const asManager = completionRights(legacy, MANAGER, "Jackson");
    expect(asManager.canComplete).toBe(true);
    expect(asManager.isOverride).toBe(true);
  });
});

/*
 * Found by driving the browser, not by reading the code: the confirmation is
 * rendered as a SIBLING modal layer, so the pointerdown that answers it counts
 * as an interaction outside the dialog beneath - and Radix dismissed that
 * dialog too. Declining to complete somebody else's task therefore threw away
 * every edit in the window, which is a worse outcome than the missing warning
 * this change set out to fix.
 *
 * The guard has to read the DOM rather than React state: the dismissal and the
 * confirmation's own close land on the same event, so by the time the close is
 * processed any state flag reads back false. That subtlety is exactly what a
 * later refactor would drop, so it is pinned here.
 */
describe("a dialog that raises a confirmation", () => {
  /*
   * The fix lives on the shared primitives, not at the call sites. A sweep of
   * every screen that raises a confirmation found eight raised from inside a
   * dialog or sheet - project edit, board settings, combine projects, the
   * template editor's discard prompt and four in tasks - so a per-screen guard
   * would have been eight chances to forget it, and one more for every dialog
   * added later.
   */
  const dialog = readFileSync(join(ROOT, "apps/web/src/components/ui/dialog.tsx"), "utf8");
  const sheet = readFileSync(join(ROOT, "apps/web/src/components/ui/sheet.tsx"), "utf8");
  const layers = readFileSync(join(ROOT, "apps/web/src/lib/modal-layers.ts"), "utf8");

  it("does not close itself when the confirmation is answered", () => {
    for (const [name, src] of [
      ["dialog", dialog],
      ["sheet", sheet],
    ] as const) {
      expect(src, `${name} guards pointerdown`).toContain(
        "onPointerDownOutside={keepOpenUnderConfirmation(onPointerDownOutside)}",
      );
      expect(src, `${name} guards focus`).toContain(
        "onFocusOutside={keepOpenUnderConfirmation(onFocusOutside)}",
      );
      expect(src, `${name} guards interaction`).toContain(
        "onInteractOutside={keepOpenUnderConfirmation(onInteractOutside)}",
      );
    }
  });

  /*
   * The DOM question, not the state question: the dismissal and the
   * confirmation's own close land on the same pointerdown, so an
   * `isConfirmOpen` flag reads back false by the time the close is processed.
   * A state-based version of this guard was written first and did not work.
   */
  it("asks the DOM which layer the interaction landed in", () => {
    expect(layers).toContain(`target.closest('[role="alertdialog"]')`);
  });

  /*
   * The photo lightbox is a hand-rolled portal, not a Radix layer, so it gets
   * no outside-interaction callback to guard - it listens for Escape on the
   * window, which closed it along with the confirmation raised inside it.
   */
  it("keeps the hand-rolled lightbox out of the confirmation's keyboard", () => {
    const lightbox = readFileSync(
      join(ROOT, "apps/web/src/features/photos/components/PhotoLightbox.tsx"),
      "utf8",
    );
    expect(lightbox).toContain("if (confirmationIsOpen()) return;");
    expect(layers).toContain("export function confirmationIsOpen()");
  });
});
