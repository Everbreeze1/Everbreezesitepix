import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultReportTitle,
  isReportEmpty,
  isReportShared,
  reportPhotoIds,
  reportSummaryLine,
  reportTitleError,
  shareStatusLabel,
  shareTogglePatch,
  type ReportRow,
  ambiguousReportIds,
  reportClockTime,
} from "../apps/mobile/src/api/report-view";

/*
 * Reports.
 *
 * The sharing rules are what matter here. A report is the one thing in this
 * product that gets sent to somebody outside the workspace, and being wrong
 * about whether a link is live is a real problem in both directions: saying a
 * revoked link works has somebody send a dead URL to a client, and saying a
 * live link is dead has them revoke and reissue for nothing, breaking the link
 * the client already has.
 */

const report = (over: Partial<ReportRow> = {}): ReportRow => ({
  id: "r1",
  project_id: "p1",
  title: "Riverside 2026-08-29",
  summary: "Panel replaced and tested.",
  photo_ids: ["a", "b"],
  include_project_info: true,
  share_token: "tok-123",
  allow_download: true,
  revoked_at: null,
  created_at: "2026-08-29T09:00:00.000Z",
  updated_at: "2026-08-29T09:00:00.000Z",
  ...over,
});

describe("isReportShared", () => {
  it("reads revoked_at, not the token", () => {
    /*
     * The obvious mistake, and it fails in the worst direction.
     * `share_token` is NOT NULL DEFAULT gen_random_uuid(), so every report has
     * one from the moment it exists. Treating the token as the signal reports
     * every report ever created as publicly readable.
     */
    expect(isReportShared(report())).toBe(true);
    expect(isReportShared(report({ revoked_at: "2026-08-29T10:00:00.000Z" }))).toBe(false);
  });

  it("is false with no token at all", () => {
    expect(isReportShared(report({ share_token: null }))).toBe(false);
  });
});

describe("shareTogglePatch", () => {
  const now = () => new Date("2026-08-29T10:00:00.000Z");

  it("stamps revoked_at to turn sharing off", () => {
    expect(shareTogglePatch(false, now)).toEqual({ revoked_at: "2026-08-29T10:00:00.000Z" });
  });

  it("clears it to turn sharing back on, restoring the same link", () => {
    /*
     * Deliberate, and it cuts both ways: a link somebody sent last month starts
     * working again, which is usually what people want, and it means revoking
     * is not a permanent kill for a leaked link. The screen says so where the
     * decision is made.
     */
    expect(shareTogglePatch(true, now)).toEqual({ revoked_at: null });
  });
});

describe("shareStatusLabel", () => {
  it("says what is true of the link right now", () => {
    expect(shareStatusLabel(report())).toContain("Anyone with the link");
    expect(shareStatusLabel(report({ revoked_at: "2026-08-29T10:00:00.000Z" }))).toContain(
      "Not shared",
    );
  });
});

describe("reportPhotoIds", () => {
  it("reads the array", () => {
    expect(reportPhotoIds(report())).toEqual(["a", "b"]);
  });

  it("survives a null or malformed column", () => {
    expect(reportPhotoIds(report({ photo_ids: null }))).toEqual([]);
    expect(reportPhotoIds(report({ photo_ids: ["a", null, 7] as never }))).toEqual(["a"]);
  });
});

describe("defaultReportTitle", () => {
  it("names the project and the date", () => {
    // A project accumulates reports, and three called "Report" is a list nobody
    // can navigate.
    expect(defaultReportTitle("Riverside", new Date(2026, 7, 29))).toBe("Riverside 2026-08-29");
  });

  it("reads local date parts, not UTC", () => {
    /*
     * `toISOString` on a report written at 9pm names it after the following
     * day, which is the day nobody was on site.
     */
    expect(defaultReportTitle("Riverside", new Date(2026, 7, 29, 21, 30))).toBe(
      "Riverside 2026-08-29",
    );
  });

  it("falls back when the project name has not loaded", () => {
    expect(defaultReportTitle("", new Date(2026, 7, 29))).toBe("Report 2026-08-29");
    expect(defaultReportTitle("   ", new Date(2026, 0, 4))).toBe("Report 2026-01-04");
  });
});

describe("reportTitleError", () => {
  it("requires a title and caps it", () => {
    expect(reportTitleError("")).toContain("title");
    expect(reportTitleError("   ")).toContain("title");
    expect(reportTitleError("Riverside")).toBeNull();
    expect(reportTitleError("x".repeat(201))).toContain("200");
  });
});

describe("reportSummaryLine", () => {
  it("counts photos and flags what is missing", () => {
    expect(reportSummaryLine(report({ share_token: null }))).toBe("2 photos");
    expect(reportSummaryLine(report({ summary: null, share_token: null }))).toBe(
      "2 photos · no write-up yet",
    );
  });

  it("says when it is shared, because that is true outside this workspace", () => {
    expect(reportSummaryLine(report())).toBe("2 photos · shared");
  });

  it("treats a whitespace summary as no write-up", () => {
    expect(reportSummaryLine(report({ summary: "   ", share_token: null }))).toContain(
      "no write-up",
    );
  });

  it("gets the singular right", () => {
    expect(reportSummaryLine(report({ photo_ids: ["a"], share_token: null }))).toBe("1 photo");
  });
});

describe("isReportEmpty", () => {
  it("is true for a report with nothing in it", () => {
    // An empty page with a letterhead. The screen still lets somebody share it,
    // because it is their call, but it warns first: the failure mode is finding
    // out from the client.
    expect(isReportEmpty(report({ photo_ids: [], summary: null }))).toBe(true);
    expect(isReportEmpty(report({ photo_ids: [], summary: "   " }))).toBe(true);
  });

  it("is false as soon as either half says something", () => {
    expect(isReportEmpty(report({ photo_ids: [], summary: "Panel replaced." }))).toBe(false);
    expect(isReportEmpty(report({ photo_ids: ["a"], summary: null }))).toBe(false);
  });
});

describe("two reports written on the same day", () => {
  /*
   * Found with a duplicate-text check against the running app, then confirmed
   * against the database: two reports on this workspace, distinct ids, created
   * 32 minutes apart on 29 July, both titled "report - 7/29/2026". Their
   * subtitles matched too - same photo count, same "no write-up yet", same
   * "shared", same "2w ago" - so the list showed one row twice, and each copy
   * carried its own delete button.
   *
   * I trashed the wrong photo earlier in exactly this way: rows I could not
   * tell apart and a destructive action on each.
   */
  it("are found by title, not by date arithmetic", () => {
    const ids = ambiguousReportIds([
      { id: "a", title: "report - 7/29/2026" },
      { id: "b", title: "report - 7/29/2026" },
      { id: "c", title: "report - 7/30/2026" },
    ]);
    expect([...ids].sort()).toEqual(["a", "b"]);
  });

  it("leaves a list with no collisions alone", () => {
    /*
     * The half that keeps the common case quiet. Stamping a clock time on every
     * row would be noise on a list where the title already says which is which.
     */
    const ids = ambiguousReportIds([
      { id: "a", title: "report - 7/29/2026" },
      { id: "b", title: "report - 7/30/2026" },
    ]);
    expect(ids.size).toBe(0);
  });

  it("ignores surrounding whitespace when comparing", () => {
    const ids = ambiguousReportIds([
      { id: "a", title: "report - 7/29/2026" },
      { id: "b", title: "  report - 7/29/2026  " },
    ]);
    expect(ids.size).toBe(2);
  });

  it("renders a 24-hour clock, which needs no second look", () => {
    // "00:33" rather than "12:33 AM": the two reports that prompted this were
    // half an hour past midnight.
    expect(reportClockTime("2026-07-29T00:33:58.000Z")).toMatch(/^\d{2}:\d{2}$/);
  });

  it("says nothing rather than NaN for an unreadable date", () => {
    expect(reportClockTime("not a date")).toBe("");
    expect(reportClockTime("")).toBe("");
  });

  it("the screen shows the time only on the colliding rows", () => {
    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/project/[id]/reports.tsx"),
      "utf8",
    );
    expect(screen).toContain("ambiguous.has(report.id)");
    // And still shows the relative time on every other row.
    expect(screen).toContain("relativeTime(report.updated_at)");
  });
});
