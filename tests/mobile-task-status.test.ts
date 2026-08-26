import { describe, expect, it } from "vitest";
import {
  advanceStatus,
  isCompletionRefusal,
  isTaskStatus,
  normaliseStatus,
  statusPatch,
} from "../apps/mobile/src/api/task-status";

describe("advanceStatus", () => {
  it("cycles open to in progress to done and back", () => {
    // One control that cycles, rather than three buttons, because this is
    // tapped one-handed on site. Wrapping round to open is the only way to undo
    // a task marked done by mistake.
    expect(advanceStatus("open")).toBe("in_progress");
    expect(advanceStatus("in_progress")).toBe("done");
    expect(advanceStatus("done")).toBe("open");
  });

  it("treats an unknown status as open", () => {
    // `tasks.status` is a text column with no enum behind it, so a row written
    // by an older client can hold anything. Falling over on it would make the
    // whole list untappable.
    expect(advanceStatus("archived")).toBe("in_progress");
    expect(advanceStatus(null)).toBe("in_progress");
    expect(advanceStatus(undefined)).toBe("in_progress");
  });
});

describe("normaliseStatus", () => {
  it("passes through the three real values", () => {
    expect(normaliseStatus("open")).toBe("open");
    expect(normaliseStatus("in_progress")).toBe("in_progress");
    expect(normaliseStatus("done")).toBe("done");
  });

  it("falls back to open for anything else", () => {
    expect(normaliseStatus("")).toBe("open");
    expect(normaliseStatus(42)).toBe("open");
    expect(isTaskStatus("blocked")).toBe(false);
  });
});

describe("statusPatch", () => {
  const now = () => new Date("2026-03-14T09:41:07.000Z");

  it("stamps completion when moving to done", () => {
    const patch = statusPatch("done", now);
    expect(patch.status).toBe("done");
    expect(patch.completed_at).toBe("2026-03-14T09:41:07.000Z");
  });

  it("clears completion when moving away from done", () => {
    /*
     * A task reopened after being completed must lose its timestamp. Leaving it
     * behind means every report that groups by completion still counts the task
     * as finished, while the board shows it open.
     */
    expect(statusPatch("open", now).completed_at).toBeNull();
    expect(statusPatch("in_progress", now).completed_at).toBeNull();
  });
});

describe("isCompletionRefusal", () => {
  /*
   * `20260819000000_assignment_and_completion.sql` refuses completion by anyone
   * who is not the assignee, the assigner, or a manager. The queue has to treat
   * that as final: retrying it hourly would bury the sentence the trigger wrote
   * to explain itself.
   */
  it("recognises the trigger's refusals", () => {
    expect(
      isCompletionRefusal(
        "Only the assignee, the person who assigned it, or a manager can mark this task done.",
      ),
    ).toBe(true);
    expect(
      isCompletionRefusal(
        "Only the assignee, the person who assigned it, or a manager can mark this checklist complete.",
      ),
    ).toBe(true);
    expect(
      isCompletionRefusal(
        "Only the assignee, the person who assigned it, or a manager can mark this workflow complete.",
      ),
    ).toBe(true);
  });

  it("does not swallow a network failure", () => {
    // Misclassifying an outage as permanent would strand the write and tell the
    // user to fix something that is not broken.
    expect(isCompletionRefusal("Network request failed")).toBe(false);
    expect(isCompletionRefusal("fetch failed")).toBe(false);
    expect(isCompletionRefusal("")).toBe(false);
  });
});
