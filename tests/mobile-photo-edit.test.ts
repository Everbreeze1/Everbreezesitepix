import { describe, expect, it } from "vitest";
import {
  mergeTags,
  phasePatch,
  restorePhotos,
  trashPhotos,
  withoutTag,
} from "../apps/mobile/src/api/photo-patch";

/*
 * Bulk photo edits from the phone.
 *
 * These write into the same `photos` rows the web gallery, the public share
 * pages and every report read back, so the shapes matter more than the code
 * that produces them.
 */

describe("mergeTags", () => {
  it("keeps the tags a photo already had", () => {
    /*
     * The reason bulk tagging merges per photo instead of writing one shared
     * array: a single value across a selection would overwrite each photo's own
     * tags with the union of everyone's, silently relabelling work that was
     * already correct.
     */
    expect(mergeTags(["roof"], ["urgent"])).toEqual(["roof", "urgent"]);
  });

  it("does not duplicate a tag that is already there", () => {
    expect(mergeTags(["roof", "urgent"], ["urgent"])).toEqual(["roof", "urgent"]);
  });

  it("handles a photo with no tags at all", () => {
    // `tags` is nullable, and a freshly captured photo usually has null rather
    // than an empty array.
    expect(mergeTags(null, ["before"])).toEqual(["before"]);
    expect(mergeTags(null, [])).toEqual([]);
  });

  it("trims and drops blanks", () => {
    // The tag sheet splits on commas, so "roof, , urgent" is a normal input.
    expect(mergeTags([], ["  roof  ", "", "   ", "urgent"])).toEqual(["roof", "urgent"]);
  });

  it("treats existing whitespace-only tags as absent", () => {
    expect(mergeTags(["  "], ["roof"])).toEqual(["roof"]);
  });
});

describe("withoutTag", () => {
  it("removes one tag and leaves the rest", () => {
    expect(withoutTag(["roof", "urgent"], "urgent")).toEqual(["roof"]);
  });

  it("is a no-op for a tag that is not there", () => {
    expect(withoutTag(["roof"], "urgent")).toEqual(["roof"]);
    expect(withoutTag(null, "urgent")).toEqual([]);
  });
});

describe("phasePatch", () => {
  it("stores before and after as themselves", () => {
    expect(phasePatch("before")).toEqual({ phase: "before" });
    expect(phasePatch("after")).toEqual({ phase: "after" });
  });

  it("stores untagged as null", () => {
    /*
     * "untagged" is a word the filter chips use; the column is nullable and
     * every other client reads null. Writing the literal string would produce a
     * phase no web filter matches, so those photos would vanish from both the
     * Before and After views and from Untagged too.
     */
    expect(phasePatch("untagged")).toEqual({ phase: null });
  });
});

describe("trash and restore", () => {
  it("trashing stamps deleted_at", () => {
    const at = () => new Date("2026-08-28T09:41:07.000Z");
    expect(trashPhotos(at)).toEqual({ deleted_at: "2026-08-28T09:41:07.000Z" });
  });

  it("restoring clears deleted_at", () => {
    // Deliberately the same write the server's restorePhotos op performs, so
    // restore can go through the offline queue like every other photo edit.
    expect(restorePhotos()).toEqual({ deleted_at: null });
  });
});
