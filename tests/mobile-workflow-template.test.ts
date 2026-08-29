import { describe, expect, it } from "vitest";
import {
  moved,
  nextPosition,
  ordered,
  positionChanges,
  removed,
  renumber,
} from "../apps/mobile/src/api/template-edit";
import {
  asPositionedPhase,
  emptyPhaseIds,
  ITEM_KINDS,
  itemsInPhase,
  normaliseKind,
  phaseNameError,
  phaseSummary,
  templateUsabilityWarning,
  workflowTemplateSummary,
  type WorkflowPhase,
  type WorkflowTemplateItem,
} from "../apps/mobile/src/api/workflow-template-edit";

/*
 * Workflow templates: phases, and the steps inside them.
 *
 * The nesting is the difficulty and it is why this was the last thing built. A
 * checklist template is one list; a workflow template is a list of phases each
 * holding its own list, on two tables whose `position` columns are independent.
 * Every ordering problem in the flat case appears twice.
 *
 * The ordering helpers are shared with the checklist editor rather than
 * rewritten, so the first block below is really asking "does the generic
 * actually work on this shape", which is the thing a widened signature can get
 * quietly wrong.
 */

const phase = (id: string, position: number, over: Partial<WorkflowPhase> = {}): WorkflowPhase =>
  asPositionedPhase({
    id,
    template_id: "t1",
    position,
    name: `Phase ${id}`,
    description: null,
    requires_signoff: false,
    ...over,
  });

const item = (
  id: string,
  phaseId: string,
  position: number,
  over: Partial<WorkflowTemplateItem> = {},
): WorkflowTemplateItem => ({
  id,
  phase_id: phaseId,
  position,
  label: `Step ${id}`,
  kind: "check",
  required: false,
  ...over,
});

describe("the shared ordering helpers work on phases", () => {
  it("orders by position", () => {
    const out = ordered([phase("c", 2), phase("a", 0), phase("b", 1)]);
    expect(out.map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie on the phase name, via the label adapter", () => {
    /*
     * `Positioned` sorts on `label`, and a phase's label is its `name`. If the
     * adapter did not set it, two phases sharing a position would swap places
     * between renders depending on the order the rows came back.
     */
    const out = ordered([
      phase("z", 1, { name: "Second fix" }),
      phase("a", 1, { name: "First fix" }),
    ]);
    expect(out.map((p) => p.name)).toEqual(["First fix", "Second fix"]);
  });

  it("moves a phase and renumbers densely", () => {
    const out = moved([phase("a", 0), phase("b", 1), phase("c", 2)], "c", -1);
    expect(out.map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(out.map((p) => p.position)).toEqual([0, 1, 2]);
  });

  it("is inert at the ends rather than throwing", () => {
    const phases = [phase("a", 0), phase("b", 1)];
    expect(moved(phases, "a", -1)).toBe(phases);
    expect(moved(phases, "b", 1)).toBe(phases);
    expect(moved(phases, "nope", 1)).toBe(phases);
  });

  it("closes the gap when a phase is deleted", () => {
    const out = removed([phase("a", 0), phase("b", 1), phase("c", 2)], "b");
    expect(out.map((p) => p.position)).toEqual([0, 1]);
  });

  it("writes back only what moved", () => {
    // A reorder usually moves two of eight, and writing all eight back is six
    // wasted round trips on one bar of signal.
    const before = [phase("a", 0), phase("b", 1), phase("c", 2)];
    const after = moved(before, "c", -1);
    expect(
      positionChanges(before, after)
        .map((c) => c.id)
        .sort(),
    ).toEqual(["b", "c"]);
  });

  it("renumbers a list the database gave gaps", () => {
    // `position` is a plain integer with nothing enforcing density, and
    // templates seeded by different code paths have gaps and duplicates.
    const out = renumber([phase("a", 5), phase("b", 9)]);
    expect(out.map((p) => p.position)).toEqual([0, 1]);
  });

  it("appends past the highest position, not at the length", () => {
    // A sparse list read mid-edit would collide if this used `length`.
    expect(nextPosition([phase("a", 0), phase("b", 7)])).toBe(8);
    expect(nextPosition([])).toBe(0);
  });
});

describe("items belong to exactly one phase", () => {
  const items = [item("1", "p1", 0), item("2", "p2", 0), item("3", "p1", 1)];

  it("groups without leaking across phases", () => {
    expect(itemsInPhase(items, "p1").map((i) => i.id)).toEqual(["1", "3"]);
    expect(itemsInPhase(items, "p2").map((i) => i.id)).toEqual(["2"]);
  });

  it("orders within a phase independently of the others", () => {
    /*
     * The two `position` columns are independent: item 1 is position 0 of p1
     * and item 2 is position 0 of p2. Both are correct, and a global sort would
     * interleave them.
     */
    const inP1 = ordered(itemsInPhase(items, "p1"));
    expect(inP1.map((i) => i.position)).toEqual([0, 1]);
  });

  it("is empty for a phase holding nothing", () => {
    expect(itemsInPhase(items, "p9")).toEqual([]);
  });
});

describe("normaliseKind", () => {
  it("passes the three the CHECK allows", () => {
    for (const kind of ITEM_KINDS) expect(normaliseKind(kind.id)).toBe(kind.id);
  });

  it("falls back rather than sending something the CHECK rejects", () => {
    // A bad value fails the write with a database error rather than anything a
    // person could act on.
    expect(normaliseKind("signature")).toBe("check");
    expect(normaliseKind(null)).toBe("check");
    expect(normaliseKind(undefined)).toBe("check");
  });
});

describe("ITEM_KINDS", () => {
  it("names each kind for what it makes the crew do", () => {
    // "check" means nothing on its own, and this picker is the only place
    // anybody meets these three.
    const labels = ITEM_KINDS.map((k) => k.label.toLowerCase());
    expect(labels).not.toContain("check");
    for (const kind of ITEM_KINDS) expect(kind.hint.length).toBeGreaterThan(0);
  });
});

describe("phaseNameError", () => {
  it("requires a name and caps it", () => {
    expect(phaseNameError("")).toContain("name");
    expect(phaseNameError("   ")).toContain("name");
    expect(phaseNameError("First fix")).toBeNull();
    expect(phaseNameError("x".repeat(121))).toContain("120");
  });
});

describe("summaries", () => {
  it("flags sign-off, because it changes what the crew has to do", () => {
    expect(phaseSummary(3, false)).toBe("3 steps");
    expect(phaseSummary(3, true)).toBe("3 steps · needs sign-off");
    expect(phaseSummary(0, false)).toBe("No steps yet");
    expect(phaseSummary(0, true)).toBe("No steps yet · needs sign-off");
    expect(phaseSummary(1, false)).toBe("1 step");
  });

  it("counts phases and steps on the template row", () => {
    expect(workflowTemplateSummary(0, 0)).toBe("No phases yet");
    expect(workflowTemplateSummary(1, 1)).toBe("1 phase, 1 step");
    expect(workflowTemplateSummary(4, 12)).toBe("4 phases, 12 steps");
  });
});

describe("templateUsabilityWarning", () => {
  it("catches a template that would apply to nothing", () => {
    /*
     * `applyWorkflowTemplate` walks phases and inserts their items. Neither of
     * these throws; both waste the crew's time discovering it on site.
     */
    expect(templateUsabilityWarning(0, 0)).toContain("no phases");
    expect(templateUsabilityWarning(3, 0)).toContain("nothing to work through");
  });

  it("is silent once the template would actually do something", () => {
    expect(templateUsabilityWarning(3, 1)).toBeNull();
  });
});

describe("emptyPhaseIds", () => {
  it("finds phases holding nothing", () => {
    const phases = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];
    const items = [{ phase_id: "p1" }, { phase_id: "p3" }];
    expect(emptyPhaseIds(phases, items)).toEqual(["p2"]);
  });

  it("returns ids, so the screen can mark the actual rows", () => {
    // An empty phase is legal and occasionally deliberate: a milestone with
    // only a sign-off. This informs rather than blocks.
    expect(emptyPhaseIds([{ id: "p1" }], [])).toEqual(["p1"]);
    expect(emptyPhaseIds([], [])).toEqual([]);
  });
});
