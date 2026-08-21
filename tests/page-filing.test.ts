import { describe, it, expect } from "vitest";
import {
  classifyPage,
  parseFilesUnder,
  isReportBucket,
  isDailyLogBucket,
  isDocumentBucket,
  DAILY_LOG_INTERNAL_NOTICE,
} from "../apps/api/src/domains/projects/page-filing";

/*
 * The rule that splits the project's Reports tab from its Documents tab.
 *
 * Worth its own test because it is the one decision three separate surfaces
 * read - the two lists and the tab counts - and because it is answered from two
 * sources that can each be absent. A regression here does not throw; it
 * silently files a client's report into storage, which is the exact bug this
 * change was made to fix.
 */

describe("parseFilesUnder", () => {
  it("defaults to report, which is what nearly every template in this product is", () => {
    expect(parseFilesUnder(null)).toBe("report");
    expect(parseFilesUnder(undefined)).toBe("report");
    expect(parseFilesUnder({})).toBe("report");
    expect(parseFilesUnder({ style: "report", html: "<p>x</p>" })).toBe("report");
  });

  it("reads an explicit bucket", () => {
    expect(parseFilesUnder({ filesUnder: "invoice" })).toBe("invoice");
    expect(parseFilesUnder({ filesUnder: "document" })).toBe("document");
    expect(parseFilesUnder({ filesUnder: "report" })).toBe("report");
  });

  it("falls back to report on anything it does not recognise", () => {
    expect(parseFilesUnder({ filesUnder: "nonsense" })).toBe("report");
    expect(parseFilesUnder({ filesUnder: 7 })).toBe("report");
    expect(parseFilesUnder("not an object")).toBe("report");
  });

  it("ignores style, which is a constant across every seeded template", () => {
    // All 43 seeds carry style: 'report'. If this ever starts discriminating,
    // the classifier has grown a second opinion and page-filing.ts is wrong.
    expect(parseFilesUnder({ style: "letter" })).toBe("report");
    expect(parseFilesUnder({ style: "letter", filesUnder: "document" })).toBe("document");
  });
});

describe("classifyPage", () => {
  it("files the client-facing AI kinds as reports regardless of any template", () => {
    for (const kind of ["report", "summary"]) {
      expect(classifyPage(kind, null)).toBe("report");
      // A template bucket must not be able to drag AI output out of Reports.
      expect(classifyPage(kind, "document")).toBe("report");
      expect(classifyPage(kind, "invoice")).toBe("report");
    }
  });

  it("files a daily log in its own bucket, so it reaches neither tab", () => {
    /*
     * The Reports tab holds the two things a user hands to a client. A Daily
     * Log is the technician's own record, generated automatically at the end of
     * a capture session and read from the Capture flow. Landing it in "report"
     * is what used to put it in the client-facing list; landing it in
     * "document" would file it among the paperwork instead, which is the older
     * bug in a new place.
     */
    expect(classifyPage("daily_log", null)).toBe("daily_log");
    expect(classifyPage("daily_log", "document")).toBe("daily_log");
    expect(classifyPage("daily_log", "invoice")).toBe("daily_log");
    expect(classifyPage("daily_log", "report")).toBe("daily_log");
  });

  it("does not let a document template claim the daily log bucket", () => {
    // parseFilesUnder is typed to the three template buckets, but the value
    // arrives from a jsonb column that nothing constrains.
    expect(parseFilesUnder({ filesUnder: "daily_log" })).toBe("report");
  });

  it("follows the template for a page made from one", () => {
    expect(classifyPage("document_template:abc", "report")).toBe("report");
    expect(classifyPage("document_template:abc", "invoice")).toBe("invoice");
    expect(classifyPage("document_template:abc", "document")).toBe("document");
  });

  it("files a blank page under documents", () => {
    expect(classifyPage(null, null)).toBe("document");
    expect(classifyPage(undefined, null)).toBe("document");
  });

  it("files under documents when the template is gone", () => {
    // A deleted template leaves storage, not a report list it may not belong to.
    expect(classifyPage("document_template:deleted", null)).toBe("document");
  });

  it("does not mistake an unknown source string for an AI kind", () => {
    expect(classifyPage("daily_logs", null)).toBe("document");
    expect(classifyPage("Report", null)).toBe("document");
  });
});

describe("isReportBucket", () => {
  it("counts only reports, so invoices stay in Documents", () => {
    expect(isReportBucket("report")).toBe(true);
    expect(isReportBucket("invoice")).toBe(false);
    expect(isReportBucket("document")).toBe(false);
  });

  it("keeps daily logs out of the client-facing tab", () => {
    expect(isReportBucket("daily_log")).toBe(false);
  });
});

describe("isDailyLogBucket / isDocumentBucket", () => {
  it("puts every bucket in exactly one of the three lists", () => {
    const buckets = ["report", "daily_log", "invoice", "document"] as const;
    for (const bucket of buckets) {
      const lists = [
        isReportBucket(bucket),
        isDailyLogBucket(bucket),
        isDocumentBucket(bucket),
      ].filter(Boolean);
      expect(lists).toHaveLength(1);
    }
  });

  it("keeps the daily log out of the Documents tab too", () => {
    // Filtering only `!== "report"` was correct while daily logs WERE reports.
    // It stopped being correct the moment they got a bucket of their own, and
    // the failure mode is silent: the log reappears in the file manager.
    expect(isDocumentBucket("daily_log")).toBe(false);
    expect(isDocumentBucket("invoice")).toBe(true);
    expect(isDocumentBucket("document")).toBe(true);
  });
});

describe("DAILY_LOG_INTERNAL_NOTICE", () => {
  it("says internal only, in the words the UI shows", () => {
    // "label it clearly as 'Internal only - not shared with clients' wherever
    // it appears" - one constant, so the page body, the Capture-flow card and
    // the editor banner cannot drift into three different promises.
    expect(DAILY_LOG_INTERNAL_NOTICE).toBe("Internal only - not shared with clients");
  });
});
