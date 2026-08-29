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
