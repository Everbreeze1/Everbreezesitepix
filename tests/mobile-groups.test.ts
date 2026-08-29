import { describe, expect, it } from "vitest";
import {
  covers,
  groupNameError,
  groupSummary,
  memberIds,
  orderedSelection,
  selectionChanged,
  toggled,
} from "../apps/mobile/src/api/group-view";

/*
 * Project groups.
 *
 * Membership is edited as a set and saved as a whole list, so the screen has to
 * be able to say whether anything actually changed. Without that, closing a
 * picker somebody only scrolled through rewrites every membership row for no
 * reason - and it would do so on every single open, because the picker builds
 * its list in the project list's order while the server returns membership in
 * insertion order.
 */

describe("memberIds", () => {
  it("reads the ids", () => {
    expect(memberIds({ projectIds: ["a", "b"] })).toEqual(["a", "b"]);
  });

  it("survives a response that carried none", () => {
    expect(memberIds({})).toEqual([]);
    expect(memberIds({ projectIds: undefined })).toEqual([]);
    expect(memberIds({ projectIds: null as never })).toEqual([]);
  });

  it("drops anything that is not a string", () => {
    expect(memberIds({ projectIds: ["a", null, 7] as never })).toEqual(["a"]);
  });
});

describe("selectionChanged", () => {
  it("is false when the same ids are chosen in a different order", () => {
    /*
     * The case this function exists for. Comparing arrays directly reports a
     * change on every open and rewrites every membership row for somebody who
     * only scrolled.
     */
    expect(selectionChanged(["a", "b", "c"], new Set(["c", "a", "b"]))).toBe(false);
  });

  it("is true when something was added or removed", () => {
    expect(selectionChanged(["a", "b"], new Set(["a", "b", "c"]))).toBe(true);
    expect(selectionChanged(["a", "b"], new Set(["a"]))).toBe(true);
  });

  it("catches a swap that keeps the count the same", () => {
    // Same size, different membership. A length check alone would miss it.
    expect(selectionChanged(["a", "b"], new Set(["a", "c"]))).toBe(true);
  });

  it("handles both ends being empty", () => {
    expect(selectionChanged([], new Set())).toBe(false);
    expect(selectionChanged([], new Set(["a"]))).toBe(true);
    expect(selectionChanged(["a"], new Set())).toBe(true);
  });
});

describe("orderedSelection", () => {
  const projects = [{ id: "a" }, { id: "b" }, { id: "c" }];

  it("sends the project list's order, not the order things were tapped", () => {
    /*
     * A Set iterates in insertion order, so taking the ids straight off it
     * would record whatever sequence somebody happened to tap in. Nothing reads
     * the order today, which is exactly why it should not be arbitrary: the
     * first thing to read it would inherit tap order as a feature.
     */
    const tappedBackwards = new Set(["c", "a"]);
    expect(orderedSelection(projects, tappedBackwards)).toEqual(["a", "c"]);
  });

  it("drops a selected id that is not in the list any more", () => {
    // A project deleted between the read and the save.
    expect(orderedSelection(projects, new Set(["a", "gone"]))).toEqual(["a"]);
  });

  it("is empty for an empty selection", () => {
    expect(orderedSelection(projects, new Set())).toEqual([]);
  });
});

describe("toggled", () => {
  it("adds and removes", () => {
    expect([...toggled(new Set(["a"]), "b")]).toEqual(["a", "b"]);
    expect([...toggled(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("returns a new Set rather than mutating", () => {
    /*
     * Mutating and calling `setState` with the same reference is the classic
     * way a picker stops responding after the first tap: React sees the same
     * object and skips the render.
     */
    const before = new Set(["a"]);
    const after = toggled(before, "b");
    expect(after).not.toBe(before);
    expect([...before]).toEqual(["a"]);
  });
});

describe("groupSummary", () => {
  it("reads naturally at every count", () => {
    expect(groupSummary(0)).toBe("No projects yet");
    expect(groupSummary(1)).toBe("1 project");
    expect(groupSummary(7)).toBe("7 projects");
  });
});

describe("groupNameError", () => {
  it("requires a name", () => {
    expect(groupNameError("")).toContain("name");
    expect(groupNameError("   ")).toContain("name");
    expect(groupNameError("Riverside contract")).toBeNull();
  });

  it("caps at the same length the op does, so nobody round-trips to be told", () => {
    expect(groupNameError("x".repeat(120))).toBeNull();
    expect(groupNameError("x".repeat(121))).toContain("120");
  });
});

describe("covers", () => {
  it("caps at four", () => {
    // More than four on a phone is a strip of thumbnails too small to
    // recognise anything in.
    expect(covers({ photoUrls: ["1", "2", "3", "4", "5", "6"] })).toHaveLength(4);
  });

  it("drops blanks and non-strings", () => {
    expect(covers({ photoUrls: ["1", "", null, 5] as never })).toEqual(["1"]);
  });

  it("survives a response with no photos at all", () => {
    expect(covers({})).toEqual([]);
    expect(covers({ photoUrls: undefined })).toEqual([]);
  });
});
