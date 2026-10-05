import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentPhaseIndex,
  isItemComplete,
  pendingStageWrites,
  phaseDone,
  runIsStaged,
  stageDonePatch,
  stageUnlockPatch,
  workflowStages,
  type WorkflowItemLike,
} from "../apps/mobile/src/api/workflow-state";
import { workflowReadiness } from "../apps/mobile/src/api/record-edit-rules";
import {
  defaultRequired,
  ITEM_KINDS,
  normaliseKind,
  requiredAfterKindChange,
  stepError,
  stepLabel,
} from "../apps/mobile/src/api/workflow-template-edit";
import { WORKFLOW_STARTER_PIECES } from "../apps/mobile/src/api/blueprint-starters";

/*
 * Workflow stages on the phone: a stage is done when someone marks it done,
 * stages run in order, a checklist step waits on its checklist, and the whole
 * run closes only once every stage is done. The rules come from
 * `@everlumen/shared` so the phone, the web and the database say the same
 * thing; these tests pin the mobile wiring to them. Walkthrough runs keep
 * their old behaviour throughout.
 */

const MOBILE = join(process.cwd(), "apps/mobile");
const read = (rel: string) => readFileSync(join(MOBILE, rel), "utf8");

const step = (over: Partial<WorkflowItemLike> = {}): WorkflowItemLike => ({
  kind: "check",
  required: true,
  completed_at: null,
  note_text: null,
  photo_id: null,
  ...over,
});

const phase = (
  id: string,
  position: number,
  items: WorkflowItemLike[],
  over: Record<string, unknown> = {},
) => ({
  id,
  position,
  name: `Stage ${id}`,
  requires_signoff: false,
  signed_off_at: null as string | null,
  completed_at: null as string | null,
  unlocked_at: null as string | null,
  items,
  ...over,
});

const DONE = "2026-10-01T09:00:00Z";

describe("checklist steps", () => {
  it("are done when the linked checklist is, and when it was removed", () => {
    expect(isItemComplete(step({ kind: "checklist", checklist_id: "c1" }))).toBe(false);
    expect(
      isItemComplete(step({ kind: "checklist", checklist_id: "c1", completed_at: DONE })),
    ).toBe(true);
    // A deleted checklist has nothing left to wait for.
    expect(isItemComplete(step({ kind: "checklist", checklist_id: null }))).toBe(true);
  });
});

describe("workflowStages", () => {
  it("locks every stage after the first open one, and unlocks on request", () => {
    const views = workflowStages([
      phase("a", 0, [step({ completed_at: DONE })]),
      phase("b", 1, [step()]),
      phase("c", 2, [step()], { unlocked_at: DONE }),
    ]);
    expect(views.map((v) => v.locked)).toEqual([false, true, false]);
    expect(views[1].waitingOn).toBe("Stage a");
    expect(views[0].canMarkDone).toBe(true);
    expect(views[0].isCurrent).toBe(true);
    expect(views[2].canMarkDone).toBe(false);
  });

  it("says what is missing in the database's words", () => {
    const views = workflowStages([
      phase(
        "a",
        0,
        [
          step({ kind: "photo" }),
          step({ kind: "photo" }),
          step({ kind: "check", required: false }),
        ],
        { requires_signoff: true },
      ),
    ]);
    expect(views[0].missing.photos).toBe(2);
    expect(views[0].canMarkDone).toBe(false);
  });

  it("treats a stage as done only once it is marked done", () => {
    const filled = phase("a", 0, [step({ completed_at: DONE })]);
    expect(phaseDone(filled, filled.items, true)).toBe(false);
    expect(phaseDone({ ...filled, completed_at: DONE }, filled.items, true)).toBe(true);
    // A walkthrough keeps the old rule: done when every step is filled in.
    expect(phaseDone(filled, filled.items, false)).toBe(true);
  });

  it("puts the cursor on the first stage not marked done", () => {
    const entries = [
      phase("a", 0, [step({ completed_at: DONE })]),
      phase("b", 1, [step({ completed_at: DONE })]),
    ].map((p) => ({ phase: p, items: p.items }));
    expect(currentPhaseIndex(entries, true)).toBe(0);
    expect(currentPhaseIndex(entries, false)).toBe(-1);
  });
});

describe("runIsStaged", () => {
  it("exempts walkthrough runs only", () => {
    expect(runIsStaged({ source_kind: "walkthrough" })).toBe(false);
    expect(runIsStaged({ source_kind: "workflow" })).toBe(true);
    expect(runIsStaged({ source_kind: null })).toBe(true);
    expect(runIsStaged(null)).toBe(true);
  });
});

describe("patches", () => {
  const now = () => new Date("2026-10-01T09:41:07.000Z");
  it("mark done and unlock write who and when", () => {
    expect(stageDonePatch("u1", now)).toEqual({
      completed_at: "2026-10-01T09:41:07.000Z",
      completed_by: "u1",
    });
    expect(stageUnlockPatch("u1", now)).toEqual({
      unlocked_at: "2026-10-01T09:41:07.000Z",
      unlocked_by: "u1",
    });
  });
});

describe("pendingStageWrites", () => {
  it("counts this stage's queued ticks, sign-off and photos, not others", () => {
    const rows = [
      {
        id: "workflow_item_patch:i1",
        kind: "workflow_item_patch",
        state: "pending",
        payload: "{}",
      },
      {
        id: "workflow_item_patch:other",
        kind: "workflow_item_patch",
        state: "pending",
        payload: "{}",
      },
      {
        id: "workflow_phase_patch:p1:signoff",
        kind: "workflow_phase_patch",
        state: "pending",
        payload: "{}",
      },
      {
        id: "workflow_phase_patch:p1:notes",
        kind: "workflow_phase_patch",
        state: "pending",
        payload: "{}",
      },
      {
        id: "photo:1",
        kind: "photo_upload",
        state: "pending",
        payload: JSON.stringify({ attachToWorkflowItemId: "i2" }),
      },
      { id: "workflow_item_patch:i2", kind: "workflow_item_patch", state: "failed", payload: "{}" },
    ];
    expect(pendingStageWrites(rows, "p1", ["i1", "i2"])).toBe(3);
  });
});

describe("workflowReadiness on a staged run", () => {
  const ok = { blocked: false, requiredTotal: 1, requiredDone: 1, signedOk: true };

  it("closes only once every stage is done, naming the first open one", () => {
    const open = workflowReadiness(
      [ok, ok],
      [
        { name: "Rough-in", done: true },
        { name: "Finish", done: false },
      ],
    );
    expect(open.canComplete).toBe(false);
    expect(open.reason).toBe('Mark "Finish" done first.');

    const all = workflowReadiness(
      [ok, ok],
      [
        { name: "Rough-in", done: true },
        { name: "Finish", done: true },
      ],
    );
    expect(all.canComplete).toBe(true);
    expect(all.reason).toBeNull();
  });

  it("keeps the step-count rule for walkthroughs", () => {
    expect(workflowReadiness([ok]).canComplete).toBe(true);
    expect(workflowReadiness([ok], null).canComplete).toBe(true);
  });
});

describe("the template editor", () => {
  it("offers a checklist kind, named for what the crew does", () => {
    const checklist = ITEM_KINDS.find((k) => k.id === "checklist");
    expect(checklist?.hint).toBe("Crew completes a linked checklist");
    expect(normaliseKind("checklist")).toBe("checklist");
  });

  it("makes photo steps required by default", () => {
    expect(defaultRequired("photo")).toBe(true);
    expect(defaultRequired("check")).toBe(false);
    expect(requiredAfterKindChange("check", "photo", false)).toBe(true);
    // The person can still switch it off; picking photo again keeps that.
    expect(requiredAfterKindChange("photo", "photo", false)).toBe(false);
    expect(requiredAfterKindChange("photo", "note", true)).toBe(true);
  });

  it("names a checklist step after its checklist and needs one picked", () => {
    expect(stepLabel("", "checklist", "Punch List Walk")).toBe("Punch List Walk");
    expect(stepLabel("  Final walk ", "checklist", "Punch List Walk")).toBe("Final walk");
    expect(stepLabel("", "check", "Punch List Walk")).toBe("");
    expect(stepError("Final walk", "checklist", null)).toMatch(/checklist/);
    expect(stepError("Final walk", "checklist", "t1")).toBeNull();
    expect(stepError("", "check", null)).toBe("Give the step a label.");
  });

  it("starter workflows require every photo step", () => {
    for (const starter of WORKFLOW_STARTER_PIECES) {
      for (const p of starter.phases) {
        for (const item of p.items) if (item.kind === "photo") expect(item.required).toBe(true);
      }
    }
  });

  it("saves the linked checklist and picks from the checklist library", () => {
    const admin = read("src/api/workflow-template-admin.ts");
    expect(admin).toMatch(/ITEM_FIELDS = "[^"]*checklist_template_id/);
    expect(admin).toContain("checklistTemplateId: step.checklist_template_id");
    const screen = read("app/(app)/workflow-template/[templateId].tsx");
    expect(screen).toContain("listChecklistTemplates");
    expect(screen).toContain("checklist_template_id: checklistId");
    expect(screen).toContain('defaultRequired("check")');
  });
});

describe("the wiring", () => {
  it("applying a template carries each step's checklist template", () => {
    const src = read("src/api/templates.ts");
    expect(src).toMatch(/\.select\("[^"]*checklist_template_id[^"]*"\)/);
    expect(src).toContain("checklist_template_id: item.checklist_template_id");
  });

  it("reads the stage columns and the linked checklist", () => {
    const src = read("src/api/workflows.ts");
    expect(src).toMatch(/PHASE_FIELDS =\s*"[^"]*completed_at, unlocked_at/);
    expect(src).toMatch(/ITEM_FIELDS =\s*"[^"]*checklist_id/);
    expect(src).toContain("source_kind");
    expect(src).toContain("export async function markStageDone");
    expect(src).toContain("export async function unlockStage");
  });

  it("the runner marks stages done, unlocks for managers, and opens checklists", () => {
    const src = read("app/(app)/workflow/[id].tsx");
    expect(src).toContain('label="Mark stage done"');
    expect(src).toContain('label="Unlock early"');
    expect(src).toContain("locked && canUnlock");
    expect(src).toContain("canUnlock={canAuthor}");
    expect(src).toContain("router.push(`/checklist/${checklistId}`)");
    expect(src).toContain("Checklist was removed");
    expect(src).toContain("runIsStaged(data)");
    // The database's refusal is what the crew reads.
    expect(src).toContain('"Could not mark this stage done"');
  });
});
