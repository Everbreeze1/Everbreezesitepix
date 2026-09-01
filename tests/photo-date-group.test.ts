import { describe, expect, it } from "vitest";
import { formatPhotoDateGroup } from "@everlumen/shared";

/*
 * A date heading says something, or the group has no heading at all.
 *
 * The photo grids stack sections of tiles under a day label. This formatter
 * returned "" for a date it could not read, and every caller rendered that
 * straight into the heading - which is not "no heading", because the row still
 * takes its gap. The gallery drew a band of tiles floating above the first
 * labelled day with nothing to say what they were.
 *
 * That is the same failure the tiles themselves used to have, and `PhotoThumb`
 * exists because of it: draw the missing case as an answer rather than as a
 * hole, so somebody can tell "this has no date" from "the app is broken".
 *
 * The project grid had already patched around it with `|| "Earlier"` while the
 * gallery and both lightboxes had not, which is the argument for fixing it once
 * in the shared function instead of three times at the call sites.
 */

describe("formatPhotoDateGroup", () => {
  it("never returns an empty label", () => {
    /*
     * The regression. Anything that cannot be parsed - an empty string, a
     * half-written value, a column that came back as something other than a
     * timestamp - has to come back as a word.
     */
    for (const bad of ["", "not a date", "0000-00-00", "undefined", "2026-13-45"]) {
      expect(formatPhotoDateGroup(bad), `input ${JSON.stringify(bad)}`).not.toBe("");
    }
  });

  it("says the date is missing rather than guessing one", () => {
    // Not "Today", and not the epoch. Both would be a lie about when the
    // photograph was taken, and a photo grid is evidence.
    expect(formatPhotoDateGroup("not a date")).toBe("Undated");
  });

  it("still reads naturally for the dates it can parse", () => {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 86_400_000);
    expect(formatPhotoDateGroup(today.toISOString())).toBe("Today");
    expect(formatPhotoDateGroup(yesterday.toISOString())).toBe("Yesterday");
  });

  it("names the year only when it is not this one", () => {
    /*
     * Worth pinning because it is the difference between a heading that is
     * merely long and one that is ambiguous: "Mar 3" across two years is two
     * different days rendering the same string.
     */
    const thisYear = new Date();
    thisYear.setMonth(0, 15);
    const old = new Date(thisYear);
    old.setFullYear(thisYear.getFullYear() - 2);

    expect(formatPhotoDateGroup(thisYear.toISOString())).not.toContain(
      String(thisYear.getFullYear()),
    );
    expect(formatPhotoDateGroup(old.toISOString())).toContain(String(old.getFullYear()));
  });

  it("the callers no longer carry their own fallback", () => {
    /*
     * Read from the other side. A leftover `|| "Earlier"` is harmless but dead,
     * and dead defences are how the next person concludes the shared function
     * still goes blank.
     */
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const grid = readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/project/[id]/index.tsx"),
      "utf8",
    );
    expect(grid).toContain("const label = formatPhotoDateGroup(when);");
    expect(grid).not.toContain('formatPhotoDateGroup(when) || "Earlier"');
  });
});
