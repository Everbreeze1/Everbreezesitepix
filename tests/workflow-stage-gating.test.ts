import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  WORKFLOW_KIND_LABELS,
  describeMissing,
  isStagedRun,
  isStepDone,
  isStuck,
  runStage,
  stageMissing,
  stageStartedAt,
  stageViews,
  type StagePhase,
  type StageStep,
} from "../packages/shared/src/index";

/*
 * Photo-gated workflow stages.
 *
 * The rules live in packages/shared (web, app, Projects list) and again in the
 * database (20261012000000), which is what actually refuses a stage marked done
 * too early. These tests pin the shared rules, the wording both sides use, and
 * the wiring that makes a checklist step reach the job.
 */

const ROOT = resolve(__dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const step = (over: Partial<StageStep>): StageStep => ({
  kind: "check",
  required: true,
  completed_at: null,
  photo_id: null,
  note_text: null,
  checklist_id: null,
  ...over,
});

const phase = (over: Partial<StagePhase> & { id: string; position: number }): StagePhase => ({
  name: `Stage ${over.position + 1}`,
  requires_signoff: false,
  signed_off_at: null,
  completed_at: null,
  unlocked_at: null,
  ...over,
});

describe("steps", () => {
  it("counts each kind as done the same way the database does", () => {
    expect(isStepDone(step({ kind: "photo", photo_id: "p" }))).toBe(true);
    expect(isStepDone(step({ kind: "photo" }))).toBe(false);
    expect(isStepDone(step({ kind: "note", note_text: "  " }))).toBe(false);
    expect(isStepDone(step({ kind: "note", note_text: "ok" }))).toBe(true);
    expect(isStepDone(step({ kind: "check", completed_at: "2026-10-05T00:00:00Z" }))).toBe(true);
  });

  it("treats a checklist step as done when its checklist is, or when it was deleted", () => {
    expect(isStepDone(step({ kind: "checklist", checklist_id: "c" }))).toBe(false);
    expect(
      isStepDone(
        step({ kind: "checklist", checklist_id: "c", completed_at: "2026-10-05T00:00:00Z" }),
      ),
    ).toBe(true);
    expect(isStepDone(step({ kind: "checklist", checklist_id: null }))).toBe(true);
  });

  it("labels the checklist kind on the printed record", () => {
    expect(WORKFLOW_KIND_LABELS.checklist).toBe("Checklist");
  });
});

describe("what a stage still needs", () => {
  it("counts only required steps, plus the sign-off", () => {
    const m = stageMissing({ requires_signoff: true, signed_off_at: null }, [
      step({ kind: "photo" }),
      step({ kind: "photo" }),
      step({ kind: "photo", required: false }),
      step({ kind: "checklist", checklist_id: "c" }),
      step({ kind: "check", completed_at: "2026-10-05T00:00:00Z" }),
    ]);
    expect(m).toEqual({ photos: 2, checks: 0, notes: 0, checklists: 1, signoff: true });
    expect(describeMissing(m)).toBe("2 photos, 1 checklist and sign-off");
  });

  it("says nothing when nothing is missing, and reads naturally for one or two things", () => {
    const none = { photos: 0, checks: 0, notes: 0, checklists: 0, signoff: false };
    expect(describeMissing(none)).toBeNull();
    expect(describeMissing({ ...none, photos: 1 })).toBe("1 photo");
    expect(describeMissing({ ...none, photos: 2, checklists: 1 })).toBe("2 photos and 1 checklist");
  });
});

describe("stage order", () => {
  const phases = [
    phase({ id: "a", position: 0, name: "Inspection" }),
    phase({ id: "b", position: 1, name: "Install" }),
    phase({ id: "c", position: 2, name: "Handover" }),
  ];

  it("locks every stage behind the first unfinished one", () => {
    const v = stageViews(phases, () => []);
    expect(v.map((s) => s.locked)).toEqual([false, true, true]);
    expect(v[1].waitingOn).toBe("Inspection");
    expect(v[2].waitingOn).toBe("Inspection");
    expect(v[0].isCurrent).toBe(true);
    expect(v[0].canMarkDone).toBe(true);
    expect(v[1].canMarkDone).toBe(false);
  });

  it("opens the next stage once the one before is done", () => {
    const v = stageViews(
      [{ ...phases[0], completed_at: "2026-10-01T00:00:00Z" }, phases[1], phases[2]],
      () => [],
    );
    expect(v.map((s) => s.locked)).toEqual([false, false, true]);
    expect(v[1].isCurrent).toBe(true);
    expect(v[2].waitingOn).toBe("Install");
  });

  it("lets a manager open a stage early", () => {
    const v = stageViews(
      [phases[0], phases[1], { ...phases[2], unlocked_at: "2026-10-02T00:00:00Z" }],
      () => [],
    );
    expect(v[2].locked).toBe(false);
  });

  it("keeps Mark stage done off while a required photo is missing", () => {
    const v = stageViews([phases[0]], () => [step({ kind: "photo" })]);
    expect(v[0].canMarkDone).toBe(false);
  });

  it("leaves walkthroughs out", () => {
    expect(isStagedRun("walkthrough")).toBe(false);
    expect(isStagedRun("workflow")).toBe(true);
    expect(isStagedRun(null)).toBe(true);
  });
});

describe("stuck jobs", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("dates a stage from the later of the run starting, the stage before finishing, and an unlock", () => {
    const phases = [
      phase({ id: "a", position: 0, completed_at: "2026-10-03T00:00:00Z" }),
      phase({ id: "b", position: 1 }),
    ];
    expect(stageStartedAt(phases, "b", "2026-10-01T00:00:00Z")).toBe("2026-10-03T00:00:00Z");
    expect(stageStartedAt(phases, "a", "2026-10-01T00:00:00Z")).toBe("2026-10-01T00:00:00Z");
  });

  it("calls a job stuck after 48 hours on one stage", () => {
    expect(isStuck("2026-10-03T11:00:00Z", now)).toBe(true);
    expect(isStuck("2026-10-04T00:00:00Z", now)).toBe(false);
  });

  it("finds the current stage of an open run, and none of a closed one", () => {
    const phases = [
      phase({ id: "a", position: 0, completed_at: "2026-10-01T00:00:00Z" }),
      phase({ id: "b", position: 1, name: "Install" }),
    ];
    const open = runStage({ started_at: "2026-09-30T00:00:00Z", completed_at: null }, phases, now);
    expect(open.current?.name).toBe("Install");
    expect(open.number).toBe(2);
    expect(open.total).toBe(2);
    expect(open.stuck).toBe(true);
    const closed = runStage(
      { started_at: "2026-09-30T00:00:00Z", completed_at: "2026-10-02T00:00:00Z" },
      phases,
      now,
    );
    expect(closed.current).toBeNull();
  });
});

describe("database", () => {
  const SQL = read("supabase/migrations/20261012000000_workflow_stage_gating.sql");

  it("refuses a stage marked done too early, and a workflow closed with stages open", () => {
    expect(SQL).toMatch(/BEFORE UPDATE OF completed_at ON public\.project_workflow_phases/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'This stage still needs %\.'/);
    expect(SQL).toMatch(/RAISE EXCEPTION 'Finish "%" first\.'/);
    expect(SQL).toMatch(/BEFORE UPDATE OF completed_at ON public\.project_workflows/);
  });

  it("uses the same words as describeMissing", () => {
    for (const word of ["' photo'", "' photos'", "' checklist'", "'sign-off'", "' and '"]) {
      expect(SQL).toContain(word);
    }
  });

  it("no longer marks a staged run's stage done on its own", () => {
    const recompute = SQL.slice(SQL.indexOf("FUNCTION public.recompute_phase_completion"));
    expect(recompute).toMatch(/run_kind <> 'walkthrough'[\s\S]*SET completed_at = NULL/);
  });

  it("makes the checklist for a checklist step, and mirrors its completion onto the step", () => {
    expect(SQL).toMatch(/CHECK \(kind IN \('check', 'photo', 'note', 'checklist'\)\)/);
    expect(SQL).toMatch(/BEFORE INSERT ON public\.project_workflow_items/);
    expect(SQL).toMatch(/AFTER UPDATE OF completed_at ON public\.project_checklists/);
  });

  it("keeps unlocking a stage a manager's call", () => {
    expect(SQL).toMatch(/OR NEW\.unlocked_at IS DISTINCT FROM OLD\.unlocked_at/);
  });
});

describe("wiring", () => {
  it("carries the linked checklist wherever a workflow template is applied", () => {
    for (const p of [
      "apps/web/src/features/projects/components/ProjectWorkflows.tsx",
      "apps/api/src/domains/blueprints/service.ts",
    ]) {
      expect(read(p), `${p} drops checklist_template_id`).toMatch(
        /checklist_template_id: \w+\.checklist_template_id/,
      );
    }
  });

  it("starts photo steps required in the editor and the starters", () => {
    expect(read("apps/web/src/features/settings/pages/WorkflowTemplatesPage.tsx")).toMatch(
      /required: kind === "photo"/,
    );
    const starters = read("apps/web/src/features/settings/components/workflow-starters.ts");
    const photoSteps = starters.match(/\{ kind: "photo"[^}]*\}/g) ?? [];
    expect(photoSteps.length).toBeGreaterThan(0);
    for (const s of photoSteps) expect(s).toMatch(/required: true/);
  });

  it("offers Mark stage done and Unlock early in the runner", () => {
    const src = read("apps/web/src/features/projects/components/ProjectWorkflows.tsx");
    expect(src).toMatch(/Mark stage done/);
    expect(src).toMatch(/Unlock early/);
    expect(src).toMatch(/completed_at, unlocked_at/);
  });

  it("shows each job's stage and a Stuck badge on the Projects list", () => {
    const src = read("apps/web/src/features/projects/pages/ProjectsPage.tsx");
    expect(src).toMatch(/useProjectWorkflowStages/);
    expect(src).toMatch(/Stuck \{stageWaitLabel/);
  });
});
