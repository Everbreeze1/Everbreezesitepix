import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  filterPhotos,
  normalizedPhase,
  photoTagCounts,
  toggleTag,
} from "../apps/mobile/src/api/photo-filter-view";
import { draftToPatch, labelsPatch } from "../apps/mobile/src/api/project-patch";

/*
 * The project screen's web-parity pieces: the grid's tag filter and the
 * label and stage rules on a project edit.
 */

const photo = (phase: string | null, tags: string[] | null) => ({ phase, tags });

describe("project photo filters", () => {
  const photos = [
    photo("before", ["roof", "leak"]),
    photo("after", ["roof"]),
    photo(null, null),
    photo("weird", ["leak"]),
  ];

  it("treats anything but before and after as untagged", () => {
    expect(normalizedPhase("weird")).toBe("untagged");
    expect(normalizedPhase(null)).toBe("untagged");
    expect(filterPhotos(photos, { phase: "untagged", tags: [], logic: "or" })).toHaveLength(2);
  });

  it("matches any tag with Or and every tag with And", () => {
    expect(
      filterPhotos(photos, { phase: "all", tags: ["roof", "leak"], logic: "or" }),
    ).toHaveLength(3);
    expect(
      filterPhotos(photos, { phase: "all", tags: ["roof", "leak"], logic: "and" }),
    ).toHaveLength(1);
  });

  it("counts tags most used first", () => {
    expect(photoTagCounts(photos)).toEqual([
      { tag: "leak", count: 2 },
      { tag: "roof", count: 2 },
    ]);
  });

  it("toggles a tag and counts the active filters", () => {
    expect(toggleTag(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleTag(["a", "b"], "a")).toEqual(["b"]);
    expect(activeFilterCount({ tags: [], media: "all" })).toBe(0);
    expect(activeFilterCount({ tags: ["a"], media: "videos" })).toBe(2);
  });
});

describe("project labels and stage-owned status", () => {
  it("trims and de-duplicates labels case-insensitively", () => {
    expect(labelsPatch([" Roofing ", "roofing", "", "Warranty"])).toEqual({
      labels: ["Roofing", "Warranty"],
    });
  });

  it("leaves status out when a pipeline stage owns it", () => {
    const draft = {
      name: "Job",
      street: null,
      city: null,
      state: null,
      zip: null,
      client_name: null,
      status: "on_hold" as const,
    };
    expect("status" in draftToPatch(draft, { statusFromStage: true })).toBe(false);
    expect(draftToPatch(draft).status).toBe("on_hold");
    expect("description" in draftToPatch(draft)).toBe(false);
    expect(draftToPatch({ ...draft, description: "  " }).description).toBeNull();
  });
});
