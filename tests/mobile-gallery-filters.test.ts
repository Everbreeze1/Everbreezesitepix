import { describe, expect, it } from "vitest";
import {
  activeFilterCount,
  dateRangeOrFilter,
  dayRangeBounds,
  EMPTY_GALLERY_FILTERS,
  parseCalendarDay,
  presetRange,
  toggleIn,
} from "../apps/mobile/src/api/gallery-filters";
import { documentationHealth, photoCountLabel } from "../apps/mobile/src/api/dashboard-view";

/*
 * The Photo Library's filter sheet and the home screen's web numbers.
 *
 * The date range is the part worth pinning. A day tapped on the timeline has to
 * open on the photos the timeline counted, which means local calendar days and
 * the capture time before the upload time.
 */

describe("parseCalendarDay", () => {
  it("accepts a real day and refuses a rolled-over one", () => {
    expect(parseCalendarDay("2026-09-27")?.getDate()).toBe(27);
    expect(parseCalendarDay("2026-02-30")).toBeNull();
    expect(parseCalendarDay("27/09/2026")).toBeNull();
    expect(parseCalendarDay("")).toBeNull();
    expect(parseCalendarDay(null)).toBeNull();
  });
});

describe("dayRangeBounds", () => {
  it("covers the whole last day, from local midnight to local midnight", () => {
    const { fromIso, toExclusiveIso } = dayRangeBounds("2026-09-27", "2026-09-27");
    expect(fromIso).toBe(new Date(2026, 8, 27).toISOString());
    expect(toExclusiveIso).toBe(new Date(2026, 8, 28).toISOString());
  });

  it("leaves an open end open", () => {
    expect(dayRangeBounds(null, "2026-09-27").fromIso).toBeNull();
    expect(dayRangeBounds("2026-09-27", null).toExclusiveIso).toBeNull();
  });
});

describe("dateRangeOrFilter", () => {
  it("prefers taken_at and falls back to created_at", () => {
    const filter = dateRangeOrFilter("2026-09-27", "2026-09-27")!;
    expect(filter).toContain("and(taken_at.not.is.null,taken_at.gte.");
    expect(filter).toContain("and(taken_at.is.null,created_at.gte.");
  });

  it("is null with no range", () => {
    expect(dateRangeOrFilter(null, null)).toBeNull();
  });
});

describe("filter bookkeeping", () => {
  it("counts each kind of refinement once", () => {
    expect(activeFilterCount(EMPTY_GALLERY_FILTERS)).toBe(0);
    expect(
      activeFilterCount({
        ...EMPTY_GALLERY_FILTERS,
        projectIds: ["a", "b"],
        from: "2026-09-01",
        to: "2026-09-02",
        needsReview: true,
      }),
    ).toBe(3);
  });

  it("toggles ids in and out", () => {
    expect(toggleIn(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });

  it("builds presets from local days", () => {
    const now = new Date(2026, 8, 27, 23, 30);
    expect(presetRange("today", now)).toEqual({ from: "2026-09-27", to: "2026-09-27" });
    expect(presetRange("7d", now)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
  });
});

describe("documentationHealth", () => {
  it("is the share of active jobs photographed this week", () => {
    expect(documentationHealth(["a", "b", "c", "d"], ["a", "c", "zz"])).toBe(50);
  });

  it("is null with no active jobs rather than a made-up percentage", () => {
    expect(documentationHealth([], ["a"])).toBeNull();
  });

  it("labels photo counts", () => {
    expect(photoCountLabel(0)).toBe("No photos yet");
    expect(photoCountLabel(1)).toBe("1 photo");
    expect(photoCountLabel(12)).toBe("12 photos");
  });
});
