import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  assignmentPatch,
  assignmentStatus,
  canReopen,
  completionRights,
  isManagerRole,
} from "../apps/web/src/lib/assignment";

/*
 * The completion rule is written twice — once as SQL triggers, once as the
 * TypeScript that decides whether the button is enabled — because the web app
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
/** In apply order — later files replace functions defined in earlier ones. */
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
   * to Jackson. But I am still able to mark complete." He keeps the ability —
   * a tech can be unreachable — but delegating the work and then closing it
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
   * hole silently — nothing else in the system would fail.
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
   * point of the feature — two records closed identically should not notify
   * different people for reasons nothing in the UI explains.
   *
   * `notify_workflow_completed` originally reached through `project_workflows`
   * to the PROJECT's owner, on the mistaken belief that the table had no
   * `created_by` of its own (it has had one, NOT NULL, since 20260616050717).
   * That only bit unassigned workflows — where `assigned_by` is NULL and the
   * fallback actually runs — but on a team where a manager applies workflows to
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
      // Anchored on CREATE OR REPLACE, not on `FUNCTION public.<fn>()` — the
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
   * second INSERT path on this table — a `FOR ALL` teammate policy carries one
   * in its WITH CHECK — repeals that gate without touching it.
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
