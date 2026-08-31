import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  comprehensiveTitleError,
  DEFAULT_PHOTOS_PER_PAGE,
  emptyJobWarning,
  MAX_REPORT_TITLE,
  PHOTOS_PER_PAGE_CHOICES,
  photosPerPageError,
  reportAiWarning,
  reportBuiltSummary,
  reportTitleError,
} from "../apps/mobile/src/api/report-view";

/*
 * The whole-job report.
 *
 * Two different artefacts share the word "report" in this product and the phone
 * now has both. `project_reports` is one a person BUILDS - create it empty, pick
 * the photographs, write the summary. This one is written for them: the service
 * reads every photo on the job and every walkthrough write-up, and files the
 * result as a `project_pages` row with `source_template: "report"`.
 *
 * That filing matters to the client: the phone's report LIST reads
 * `project_reports`, so a generated report will not appear in it, and the screen
 * opens the returned page directly instead.
 *
 * The rule worth testing is the wording after a partial failure, because the
 * document is still handed to a customer.
 */

describe("reportBuiltSummary", () => {
  it("counts what went in, because the number is what gets checked", () => {
    // A whole-job report built from four photographs means somebody is about to
    // send a client a document with four photographs in it.
    expect(reportBuiltSummary({ photoCount: 4, summaryCount: 0 })).toBe("Built from 4 photos.");
    expect(reportBuiltSummary({ photoCount: 1, summaryCount: 0 })).toBe("Built from 1 photo.");
  });

  it("names the walkthrough write-ups when there are any", () => {
    expect(reportBuiltSummary({ photoCount: 9, summaryCount: 2 })).toBe(
      "Built from 9 photos and 2 walkthrough write-ups.",
    );
    expect(reportBuiltSummary({ photoCount: 9, summaryCount: 1 })).toBe(
      "Built from 9 photos and 1 walkthrough write-up.",
    );
  });

  it("says nothing about write-ups when there were none", () => {
    // "and 0 walkthrough write-ups" is noise on most jobs.
    expect(reportBuiltSummary({ photoCount: 3, summaryCount: 0 })).not.toContain("walkthrough");
  });
});

describe("reportAiWarning", () => {
  it("is silent on a complete report", () => {
    expect(reportAiWarning({ aiFailed: null })).toBeNull();
  });

  it("says which half is missing, not just that something failed", () => {
    /*
     * `aiFailed` is not a failed report. The service still produces one and it
     * still carries the client details, the figures and the photographic
     * record; what it drops are the three written sections, which it omits
     * rather than printing empty headings - "a heading with nothing under it is
     * worse than no heading".
     *
     * Somebody about to send this to a customer needs to know exactly that.
     */
    const warning = reportAiWarning({ aiFailed: "provider unreachable" });
    expect(warning).toContain("written sections");
    expect(warning).toContain("photos");
    expect(warning).toContain("again");
  });

  it("does not call the report broken", () => {
    // It is a usable document. Telling somebody it failed would have them throw
    // away a report that has the whole photographic record in it.
    const warning = reportAiWarning({ aiFailed: "x" }) ?? "";
    expect(warning.toLowerCase()).not.toContain("failed to generate the report");
    expect(warning.toLowerCase()).not.toContain("could not be produced");
  });
});

describe("emptyJobWarning", () => {
  it("says nothing when there is a photographic record", () => {
    expect(emptyJobWarning(1)).toBeNull();
    expect(emptyJobWarning(40)).toBeNull();
  });

  it("warns when the report has no photos in it", () => {
    // A cover page and a set of client details, which is not what somebody
    // thinks they are sending.
    expect(emptyJobWarning(0)).toContain("no photographic record");
  });
});

describe("titles: two rules, deliberately", () => {
  it("requires one for a report a person is naming", () => {
    expect(reportTitleError("")).toContain("Give the report a title");
    expect(reportTitleError("Final report")).toBeNull();
  });

  it("allows none for the generated one, which names itself", () => {
    /*
     * `comprehensiveReportInputSchema` marks `title` `.optional()` and the
     * service writes its own when none is given. Folding the two rules together
     * would force a title the server does not want.
     */
    expect(comprehensiveTitleError("")).toBeNull();
    expect(comprehensiveTitleError("   ")).toBeNull();
  });

  it("shares the column's ceiling", () => {
    expect(reportTitleError("x".repeat(MAX_REPORT_TITLE))).toBeNull();
    expect(comprehensiveTitleError("x".repeat(MAX_REPORT_TITLE))).toBeNull();
    expect(reportTitleError("x".repeat(MAX_REPORT_TITLE + 1))).toBeTruthy();
    expect(comprehensiveTitleError("x".repeat(MAX_REPORT_TITLE + 3))).toContain("3 characters");
  });
});

describe("photosPerPage", () => {
  it("offers only what the schema accepts", () => {
    for (const choice of PHOTOS_PER_PAGE_CHOICES) {
      expect(photosPerPageError(choice), `${choice}`).toBeNull();
    }
    expect(PHOTOS_PER_PAGE_CHOICES).toContain(DEFAULT_PHOTOS_PER_PAGE);
  });

  it("refuses what it would reject", () => {
    expect(photosPerPageError(0)).toBeTruthy();
    expect(photosPerPageError(5)).toBeTruthy();
    expect(photosPerPageError(2.5)).toBeTruthy();
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(
      join(process.cwd(), "apps/api/src/domains/projects/comprehensive-report.ts"),
      "utf8",
    );
  const client = () => readFileSync(join(process.cwd(), "apps/mobile/src/api/reports.ts"), "utf8");

  it("mirrors the bounds the schema enforces", () => {
    const s = service();
    expect(s).toContain(`max(${MAX_REPORT_TITLE})`);
    // 1 to 4 photos a page, which is what the choice list offers.
    expect(s).toContain("min(1).max(4)");
    expect(Math.min(...PHOTOS_PER_PAGE_CHOICES)).toBe(1);
    expect(Math.max(...PHOTOS_PER_PAGE_CHOICES)).toBe(4);
  });

  it("reads the four fields the service returns", () => {
    expect(service()).toContain(
      "return { page, aiFailed, photoCount: digest.total, summaryCount: summaries.length };",
    );
    const c = client();
    for (const field of ["page", "aiFailed", "photoCount", "summaryCount"]) {
      expect(c, field).toContain(field);
    }
  });

  it("spends its LLM calls behind an idempotency key", () => {
    /*
     * Several calls per report, so a retry after a dropped response would bill
     * twice for a document nobody asked for twice. The key is fresh per tap
     * because asking for a second report IS legitimate - the job moved on.
     */
    const registry = readFileSync(
      join(process.cwd(), "apps/api/src/domains/rpc/registry.ts"),
      "utf8",
    );
    const at = registry.indexOf("generateComprehensiveReport: authed(");
    expect(at).toBeGreaterThan(-1);
    expect(registry.slice(at, at + 300)).toContain("idempotent: true");
    expect(client()).toContain("idempotencyKey");
  });

  it("files as a page, which is why the screen opens one", () => {
    /*
     * The trap: the phone's report list reads `project_reports`, and this lands
     * in `project_pages`. A screen that invalidated the list and waited for the
     * row to appear would wait forever.
     */
    expect(service()).toContain('source_template: "report"');
    expect(service()).toContain('.from("project_pages")');
    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/project/[id]/reports.tsx"),
      "utf8",
    );
    expect(screen).toContain('pathname: "/page/[pageId]"');
  });
});
