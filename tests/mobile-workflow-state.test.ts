import { describe, expect, it } from "vitest";
import {
  canSignOff,
  checkItemPatch,
  currentPhaseIndex,
  isItemComplete,
  phaseState,
  signoffPatch,
  type WorkflowItemLike,
} from "../apps/mobile/src/api/workflow-state";

/*
 * Workflow phase rules, ported from the web runner rather than reinvented.
 * Both clients read the same rows, and a phase that reads "blocked" on a phone
 * and "done" on the web is worse than either answer on its own.
 */

const check = (over: Partial<WorkflowItemLike> = {}): WorkflowItemLike => ({
  kind: "check",
  required: false,
  completed_at: null,
  note_text: null,
  photo_id: null,
  ...over,
});

describe("isItemComplete", () => {
  it("judges each kind by its own evidence", () => {
    /*
     * A photo step proves itself with a photo and a note step with text.
     * Reading `completed_at` for all three would leave a photo step showing
     * outstanding with the photo already attached to it.
     */
    expect(isItemComplete(check({ kind: "photo", photo_id: "photo-1" }))).toBe(true);
    expect(isItemComplete(check({ kind: "photo", completed_at: "2026-03-14T09:00:00Z" }))).toBe(
      false,
    );

    expect(isItemComplete(check({ kind: "note", note_text: "Sealed" }))).toBe(true);
    expect(isItemComplete(check({ kind: "note", note_text: "   " }))).toBe(false);

    expect(isItemComplete(check({ completed_at: "2026-03-14T09:00:00Z" }))).toBe(true);
    expect(isItemComplete(check())).toBe(false);
  });
});

describe("phaseState", () => {
  const open = { requires_signoff: false, signed_off_at: null };

  it("an empty phase is complete, not permanently unfinished", () => {
    /*
     * The designer allows empty phases. Treating one as incomplete pins the
     * "Now" marker to it forever, hides every phase after it, and makes the
     * workflow impossible to finish. The web version records this as a bug it
     * shipped once already.
     */
    const state = phaseState(open, []);
    expect(state.complete).toBe(true);
    expect(state.blocked).toBe(false);
  });

  it("separates blocked from complete", () => {
    // A phase of purely optional steps blocks nothing, but it is still not
    // done, so it keeps the cursor instead of being silently skipped.
    const state = phaseState(open, [check(), check()]);
    expect(state.blocked).toBe(false);
    expect(state.complete).toBe(false);
  });

  it("is blocked while a required step is outstanding", () => {
    const state = phaseState(open, [
      check({ required: true }),
      check({ completed_at: "2026-03-14T09:00:00Z" }),
    ]);
    expect(state.blocked).toBe(true);
    expect(state.requiredDone).toBe(0);
    expect(state.requiredTotal).toBe(1);
  });

  it("is blocked while sign-off is outstanding, even with every step done", () => {
    const state = phaseState({ requires_signoff: true, signed_off_at: null }, [
      check({ required: true, completed_at: "2026-03-14T09:00:00Z" }),
    ]);
    expect(state.blocked).toBe(true);
    expect(state.signedOk).toBe(false);
    expect(state.complete).toBe(false);
  });

  it("is complete once signed off", () => {
    const state = phaseState({ requires_signoff: true, signed_off_at: "2026-03-14T10:00:00Z" }, [
      check({ required: true, completed_at: "2026-03-14T09:00:00Z" }),
    ]);
    expect(state.complete).toBe(true);
  });
});

describe("canSignOff", () => {
  it("refuses while required work is outstanding", () => {
    // Sign-off is a signature against finished work. Allowing it early puts a
    // name on a record the same screen still shows as incomplete.
    expect(
      canSignOff({ requires_signoff: true, signed_off_at: null }, [check({ required: true })]),
    ).toBe(false);
  });

  it("allows once required work is done", () => {
    expect(
      canSignOff({ requires_signoff: true, signed_off_at: null }, [
        check({ required: true, completed_at: "2026-03-14T09:00:00Z" }),
        check(),
      ]),
    ).toBe(true);
  });

  it("is not offered when the phase does not need it, or already has it", () => {
    expect(canSignOff({ requires_signoff: false, signed_off_at: null }, [])).toBe(false);
    expect(canSignOff({ requires_signoff: true, signed_off_at: "2026-03-14T10:00:00Z" }, [])).toBe(
      false,
    );
  });
});

describe("currentPhaseIndex", () => {
  const open = { requires_signoff: false, signed_off_at: null };
  const doneItem = check({ completed_at: "2026-03-14T09:00:00Z" });

  it("points at the first phase that is not complete", () => {
    const index = currentPhaseIndex([
      { phase: open, items: [doneItem] },
      { phase: open, items: [check()] },
      { phase: open, items: [check()] },
    ]);
    expect(index).toBe(1);
  });

  it("steps over an empty phase rather than stopping on it", () => {
    const index = currentPhaseIndex([
      { phase: open, items: [] },
      { phase: open, items: [check()] },
    ]);
    expect(index).toBe(1);
  });

  it("reports -1 when everything is done", () => {
    // The caller shows a finished workflow rather than parking the marker on
    // the last phase, which would read as still having work in it.
    expect(currentPhaseIndex([{ phase: open, items: [doneItem] }])).toBe(-1);
  });
});

describe("patches", () => {
  const now = () => new Date("2026-03-14T09:41:07.000Z");

  it("ticking and un-ticking a check step", () => {
    const ticked = checkItemPatch(check(), "user-1", now);
    expect(ticked.completed_at).toBe("2026-03-14T09:41:07.000Z");
    expect(ticked.completed_by).toBe("user-1");

    const cleared = checkItemPatch(check({ completed_at: "2026-03-14T09:00:00Z" }), "user-1", now);
    expect(cleared.completed_at).toBeNull();
    expect(cleared.completed_by).toBeNull();
  });

  it("sign-off records the typed name, trimmed", () => {
    const patch = signoffPatch("  Dana Reyes  ", "user-1", now);
    expect(patch.signoff_name).toBe("Dana Reyes");
    expect(patch.signed_off_by).toBe("user-1");
    expect(patch.signed_off_at).toBe("2026-03-14T09:41:07.000Z");
  });
});
