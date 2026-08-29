import { describe, expect, it } from "vitest";
import {
  ITEM_TYPES,
  labelError,
  MAX_LABEL,
  moved,
  nextPosition,
  normaliseItemType,
  ordered,
  positionChanges,
  removed,
  renumber,
  templateNameError,
  templateSummary,
  type TemplateItem,
} from "../apps/mobile/src/api/template-edit";

/*
 * Editing a checklist template.
 *
 * Ordering is the whole of the difficulty. `position` is an integer column with
 * nothing enforcing that it is dense, unique or zero-based, and templates
 * seeded by different code paths have all three problems in them -
 * `applyChecklistTemplate` already renumbers on the way out because of it. An
 * editor that trusted those positions would let two items claim the same slot
 * and then reorder unpredictably.
 */

const item = (id: string, position: number, over: Partial<TemplateItem> = {}): TemplateItem => ({
  id,
  position,
  label: `Item ${id}`,
  description: null,
  required: false,
  item_type: "checkbox",
  ...over,
});

describe("ordered", () => {
  it("sorts by position", () => {
    const out = ordered([item("c", 2), item("a", 0), item("b", 1)]);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks a tie on label rather than leaving it to row order", () => {
    /*
     * Two items sharing a position is a real state in this table. Without a
     * tie-break they swap places between renders depending on what order the
     * rows came back, which reads as the list shuffling itself.
     */
    const out = ordered([item("z", 1, { label: "Zebra" }), item("a", 1, { label: "Aardvark" })]);
    expect(out.map((i) => i.label)).toEqual(["Aardvark", "Zebra"]);
  });

  it("does not mutate its input", () => {
    const input = [item("b", 1), item("a", 0)];
    ordered(input);
    expect(input[0].id).toBe("b");
  });
});

describe("renumber", () => {
  it("closes gaps and rebases to zero", () => {
    const out = renumber([item("a", 5), item("b", 9), item("c", 40)]);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("resolves duplicates rather than preserving them", () => {
    const out = renumber([item("a", 3), item("b", 3), item("c", 3)]);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("returns the same objects for rows that did not move", () => {
    // Referential stability, so a list where one item moved does not re-render
    // every row.
    const rows = [item("a", 0), item("b", 1)];
    const out = renumber(rows);
    expect(out[0]).toBe(rows[0]);
    expect(out[1]).toBe(rows[1]);
  });
});

describe("moved", () => {
  const rows = [item("a", 0), item("b", 1), item("c", 2)];

  it("swaps with the neighbour and renumbers", () => {
    const out = moved(rows, "b", -1);
    expect(out.map((i) => i.id)).toEqual(["b", "a", "c"]);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
  });

  it("moves down as well", () => {
    expect(moved(rows, "b", 1).map((i) => i.id)).toEqual(["a", "c", "b"]);
  });

  it("is inert at each end rather than throwing", () => {
    // So the top item's up arrow simply does nothing, which is what a disabled
    // control that somehow got tapped should do.
    expect(moved(rows, "a", -1)).toBe(rows);
    expect(moved(rows, "c", 1)).toBe(rows);
  });

  it("is inert for an id that is not there", () => {
    expect(moved(rows, "nope", 1)).toBe(rows);
  });

  it("works on a list whose positions were sparse to begin with", () => {
    /*
     * The case that matters: a template seeded with gaps. Sorting first is what
     * makes the swap operate on what the person can see rather than on raw
     * column values.
     */
    const sparse = [item("a", 10), item("b", 3), item("c", 77)];
    const out = moved(sparse, "a", -1);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(out.map((i) => i.position)).toEqual([0, 1, 2]);
  });
});

describe("removed", () => {
  it("drops the row and closes the gap", () => {
    const out = removed([item("a", 0), item("b", 1), item("c", 2)], "b");
    expect(out.map((i) => i.id)).toEqual(["a", "c"]);
    expect(out.map((i) => i.position)).toEqual([0, 1]);
  });

  it("copes with removing the only row", () => {
    expect(removed([item("a", 0)], "a")).toEqual([]);
  });
});

describe("positionChanges", () => {
  it("reports only what actually moved", () => {
    /*
     * A renumber usually moves two of twenty. Writing all twenty back is
     * eighteen wasted round trips on a connection that may be one bar.
     */
    const before = [item("a", 0), item("b", 1), item("c", 2)];
    const after = moved(before, "a", 1);
    expect(positionChanges(before, after)).toEqual([
      { id: "b", position: 0 },
      { id: "a", position: 1 },
    ]);
  });

  it("is empty when nothing moved", () => {
    const rows = [item("a", 0), item("b", 1)];
    expect(positionChanges(rows, rows)).toEqual([]);
  });

  it("reports every row when a sparse list is normalised", () => {
    const before = [item("a", 10), item("b", 20)];
    expect(positionChanges(before, renumber(before))).toHaveLength(2);
  });
});

describe("nextPosition", () => {
  it("is one past the highest, not the length", () => {
    // A list read mid-edit can be sparse, and `length` would collide with an
    // existing row.
    expect(nextPosition([item("a", 0), item("b", 7)])).toBe(8);
    expect(nextPosition([])).toBe(0);
  });
});

describe("labelError", () => {
  it("requires something to read", () => {
    expect(labelError("")).toContain("label");
    expect(labelError("   ")).toContain("label");
    expect(labelError("Check the panel")).toBeNull();
  });

  it("caps the length", () => {
    expect(labelError("x".repeat(MAX_LABEL))).toBeNull();
    expect(labelError("x".repeat(MAX_LABEL + 1))).toContain("characters");
  });

  it("allows duplicates", () => {
    /*
     * Deliberate. A checklist genuinely has "Photograph the panel" under three
     * phases, and refusing that would be the editor inventing a rule the runner
     * does not have.
     */
    expect(labelError("Photograph the panel")).toBeNull();
  });
});

describe("templateNameError", () => {
  it("requires a name and caps it", () => {
    expect(templateNameError("")).toContain("name");
    expect(templateNameError("Pre-pour inspection")).toBeNull();
    expect(templateNameError("x".repeat(121))).toContain("120");
  });
});

describe("normaliseItemType", () => {
  it("passes through the six the runner understands", () => {
    for (const type of ITEM_TYPES) expect(normaliseItemType(type)).toBe(type);
  });

  it("falls back rather than leaving the picker with nothing selected", () => {
    /*
     * `item_type` is a text column, so a template written by an older client
     * can hold something this build has never seen. Rendering it as a checkbox
     * is wrong in a small way; an unselected picker is wrong in a way that
     * loses the stored value on the next save.
     */
    expect(normaliseItemType("signature")).toBe("checkbox");
    expect(normaliseItemType(null)).toBe("checkbox");
    expect(normaliseItemType(undefined)).toBe("checkbox");
  });
});

describe("templateSummary", () => {
  it("says what is there", () => {
    expect(templateSummary(0, 0)).toBe("No items yet");
    expect(templateSummary(1, 0)).toBe("1 item");
    expect(templateSummary(9, 0)).toBe("9 items");
    expect(templateSummary(9, 3)).toBe("9 items, 3 required");
  });
});
