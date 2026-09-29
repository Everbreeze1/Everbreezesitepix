import { describe, expect, it } from "vitest";
import {
  builtReportStatus,
  groupReportIndex,
  mergeReportIndex,
  reportBlueprintNames,
  reportIndexSubtitle,
  reportStatusLabel,
  reportThumbPhotoIds,
} from "../apps/mobile/src/api/report-index-view";

/*
 * The workspace Reports screen: both tables in one list, grouped by what the
 * data can actually say. Neither table has a sign-off state, so the only
 * "needs doing" signal is a built report with no write-up.
 */

const NOW = new Date(2026, 8, 27, 12, 0, 0);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("report status", () => {
  it("a built report with no write-up is a draft even though its link is live", () => {
    // share_token defaults on insert, so every report starts "shared".
    expect(builtReportStatus({ summary: "  ", share_token: "t", revoked_at: null })).toBe("draft");
  });

  it("otherwise the pill says whether the link works", () => {
    expect(builtReportStatus({ summary: "Done.", share_token: "t", revoked_at: null })).toBe(
      "shared",
    );
    expect(builtReportStatus({ summary: "Done.", share_token: "t", revoked_at: daysAgo(1) })).toBe(
      "link_off",
    );
    expect(reportStatusLabel("link_off")).toBe("Link off");
  });
});

describe("the merged list", () => {
  const built = [
    {
      id: "r1",
      project_id: "p1",
      title: "Old",
      summary: "x",
      share_token: "t",
      revoked_at: null,
      updated_at: daysAgo(20),
    },
    {
      id: "r2",
      project_id: "p1",
      title: "Draft",
      summary: null,
      share_token: "t",
      revoked_at: null,
      updated_at: daysAgo(0),
    },
  ];
  const pages = [
    {
      id: "g1",
      projectId: "p2",
      projectName: "Oak Hollow",
      title: "Page",
      updatedAt: daysAgo(2),
      shareToken: "s",
      revokedAt: null,
    },
  ];
  const items = mergeReportIndex(built, pages, new Map([["p1", "Fisher Circle"]]));

  it("lists both kinds newest first, with job names", () => {
    expect(items.map((i) => i.id)).toEqual(["r2", "g1", "r1"]);
    expect(items[0]!.projectName).toBe("Fisher Circle");
    expect(items[1]!.kind).toBe("page");
  });

  it("puts drafts first, then this week, then earlier, and drops empty sections", () => {
    const sections = groupReportIndex(items, NOW);
    expect(sections.map((s) => [s.key, s.items.map((i) => i.id)])).toEqual([
      ["drafts", ["r2"]],
      ["week", ["g1"]],
      ["earlier", ["r1"]],
    ]);
    expect(groupReportIndex([], NOW)).toEqual([]);
  });

  it("says job and day in words for the recent ones", () => {
    expect(reportIndexSubtitle(items[0]!, NOW)).toBe("Fisher Circle · drafted today");
    expect(reportIndexSubtitle({ ...items[1]!, updatedAt: daysAgo(1) }, NOW)).toBe(
      "Oak Hollow · yesterday",
    );
  });
});

describe("the report card's photo and blueprint", () => {
  it("uses the first cover photo, else the earliest section's first photo", () => {
    const thumbs = reportThumbPhotoIds(
      [
        { id: "r1", project_id: "p1", cover_photo_ids: ["c1", "c2"] },
        { id: "r2", project_id: "p1", cover_photo_ids: [] },
        { id: "r3", project_id: "p1", cover_photo_ids: null },
      ],
      [
        { report_id: "r2", position: 2, photos: [{ photo_id: "late" }] },
        { report_id: "r2", position: 1, photos: [{ photo_id: "early" }] },
        { report_id: "r1", position: 0, photos: [{ photo_id: "ignored" }] },
        { report_id: "r3", position: 0, photos: [] },
      ],
    );
    expect(Object.fromEntries(thumbs)).toEqual({ r1: "c1", r2: "early" });
  });

  it("names the blueprint only for reports a blueprint produced", () => {
    const names = reportBlueprintNames(
      [
        { id: "r1", project_id: "p1", source_template: "t1" },
        { id: "r2", project_id: "p1", source_template: null },
        { id: "r3", project_id: "p2", source_template: "t9" },
      ],
      { p1: { t1: { blueprintId: "b1", blueprintName: "Normal HVAC Service Call" } } },
    );
    expect(names).toEqual({ r1: "Normal HVAC Service Call" });
  });

  it("carries the link state so the row menu can act without opening the report", () => {
    const [item] = mergeReportIndex(
      [
        {
          id: "r1",
          project_id: "p1",
          title: "T",
          summary: "S",
          share_token: "tok",
          revoked_at: null,
          updated_at: NOW.toISOString(),
        },
      ],
      [],
      new Map(),
    );
    expect(item.shareToken).toBe("tok");
    expect(item.revokedAt).toBeNull();
  });
});
