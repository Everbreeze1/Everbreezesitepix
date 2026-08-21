import { describe, it, expect } from "vitest";
import {
  isReportSummary,
  type ReportWalkthrough,
} from "@/features/projects/components/ProjectReports";

/*
 * The bug the client reported, pinned as behaviour rather than as source text.
 *
 * "the raw video Walkthrough entry is separately showing up inside the Reports
 * tab miscategorized under the 'Summaries' filter - it's a distinct video
 * artifact and shouldn't share a bucket with AI-text summaries."
 *
 * The trap is that a recorded walkthrough grows a `summary_markdown` the moment
 * its report is generated, so any predicate that only looks for that field pulls
 * the video row straight back into the list. The tab count in ProjectDetailPage
 * imports this same function, so the two cannot drift back apart.
 */

const walk = (over: Partial<ReportWalkthrough> = {}): ReportWalkthrough => ({
  id: "w1",
  title: "Willow Street - Aug 21",
  created_at: "2026-08-21T10:00:00Z",
  status: "ready",
  source: "summary",
  summary_markdown: "## Overview\n\nSomething happened.",
  ...over,
});

describe("isReportSummary", () => {
  it("lists an AI Summary generated from photos", () => {
    expect(isReportSummary(walk())).toBe(true);
  });

  it("excludes a recorded walkthrough even once it has been generated", () => {
    // The exact row that was showing up in the wrong bucket. It has everything
    // a summary has except being one.
    expect(isReportSummary(walk({ source: "recorded" }))).toBe(false);
  });

  it("excludes a recorded walkthrough that is still just a video", () => {
    expect(isReportSummary(walk({ source: "recorded", summary_markdown: null }))).toBe(false);
  });

  it("excludes a summary that has not finished generating", () => {
    // A row that opens onto nothing is worse than a row that is not there yet.
    expect(isReportSummary(walk({ status: "generating" }))).toBe(false);
    expect(isReportSummary(walk({ status: "failed" }))).toBe(false);
  });

  it("excludes a ready summary with nothing written in it", () => {
    expect(isReportSummary(walk({ summary_markdown: null }))).toBe(false);
    expect(isReportSummary(walk({ summary_markdown: "" }))).toBe(false);
    expect(isReportSummary(walk({ summary_markdown: "   \n  " }))).toBe(false);
  });

  it("does not treat an unknown source as a summary", () => {
    // `source` is a plain text column; a future kind must not default into the
    // client-facing list.
    expect(isReportSummary(walk({ source: "imported" }))).toBe(false);
    expect(isReportSummary(walk({ source: "" }))).toBe(false);
  });

  it("filters a mixed list down to the summaries only", () => {
    const rows = [
      walk({ id: "a", source: "summary" }),
      walk({ id: "b", source: "recorded" }),
      walk({ id: "c", source: "summary", status: "generating" }),
      walk({ id: "d", source: "recorded", summary_markdown: null }),
      walk({ id: "e", source: "summary" }),
    ];
    expect(rows.filter(isReportSummary).map((r) => r.id)).toEqual(["a", "e"]);
  });
});
