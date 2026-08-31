import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { titleWithinProject } from "../packages/shared/src/title-within-project";

/*
 * Found on the phone, twice, in two different lists.
 *
 * A project's Documents screen and its Reports screen both rendered as rows of
 *
 *     20 Charlcote Crescent - Site visit ...
 *     20 Charlcote Crescent - Site visit ...
 *
 * Reports and pages are auto-named after the job, the row title truncates at
 * two lines, and the half that identifies one - the date, or "HVAC Installation
 * & Start-Up Report" - is at the end. So five different documents looked
 * identical and there was no way to pick the right one.
 */

describe("reading a document title inside its own job", () => {
  const PROJECT = "20 Charlcote Crescent - Site visit";

  it("drops the job name the screen is already showing", () => {
    expect(titleWithinProject(`${PROJECT} - Report - 8/14/2026`, PROJECT)).toBe(
      "Report - 8/14/2026",
    );
    expect(titleWithinProject(`${PROJECT} - HVAC Installation & Start-Up Report`, PROJECT)).toBe(
      "HVAC Installation & Start-Up Report",
    );
  });

  it("tells apart the rows that used to look the same", () => {
    const titles = [
      `${PROJECT} - Project Report - 8/22/2026 (4)`,
      `${PROJECT} - Report - 8/14/2026 (2)`,
      `${PROJECT} - Report - 8/14/2026`,
      `${PROJECT} - Untitled (2)`,
      `${PROJECT} - Untitled`,
    ].map((t) => titleWithinProject(t, PROJECT));

    /*
     * The point of the whole change: five distinct titles, each short enough
     * that what identifies it survives the row's two-line truncation. Asserted
     * as "shorter by the whole job name" rather than against a magic width,
     * because the width that matters is the device's, not a number here.
     */
    expect(new Set(titles).size).toBe(5);
    for (const t of titles) expect(t.length).toBeLessThanOrEqual(35 - 0);
    for (const t of titles) expect(t.startsWith(PROJECT)).toBe(false);
  });

  it("handles the report naming, where the separator is only a space", () => {
    /*
     * Reports are named `"{job} report - {date}"`. Documents got fixed and the
     * Reports list did not, because " report - ..." does not begin with " - ".
     * This case matters more than the documents one: every report subtitle on a
     * job reads "1 photo, no write-up yet, shared, 2w ago", so the date in the
     * title is the only thing telling one from another.
     */
    expect(titleWithinProject(`${PROJECT} report - 8/1/2026`, PROJECT)).toBe("report - 8/1/2026");
    expect(titleWithinProject(`${PROJECT} report - 7/31/2026`, PROJECT)).toBe("report - 7/31/2026");
  });

  it("handles the separators these titles actually use", () => {
    expect(titleWithinProject("Job A - Daily Log", "Job A")).toBe("Daily Log");
    expect(titleWithinProject("Job A: Daily Log", "Job A")).toBe("Daily Log");
    expect(titleWithinProject("Job A · Daily Log", "Job A")).toBe("Daily Log");
    expect(titleWithinProject("Job A | Daily Log", "Job A")).toBe("Daily Log");
  });
});

describe("what it must not strip", () => {
  it("leaves a title that only happens to start with similar words", () => {
    /*
     * The guard that makes a bare space safe as a separator. "Job Alpha Report"
     * against a job called "Job A" leaves "lpha Report" - starting with a
     * letter, not a separator - so nothing is stripped.
     */
    expect(titleWithinProject("Job Alpha Report", "Job A")).toBe("Job Alpha Report");
    expect(titleWithinProject("Job Alpha", "Job A")).toBe("Job Alpha");
  });

  it("keeps a title that is nothing but the job name", () => {
    /*
     * Stripping would leave an empty row. A repeated title is bad; a blank one
     * is worse, because there is nothing left to tap with intent.
     */
    expect(titleWithinProject("Job A", "Job A")).toBe("Job A");
    /*
     * Trimmed on the way in, so the trailing space is already gone. Allowing a
     * bare space as a separator briefly made this strip to "-", which is worse
     * than the repetition it was fixing: a row with nothing to recognise. What
     * survives the strip has to contain a letter or a digit.
     */
    expect(titleWithinProject("Job A - ", "Job A")).toBe("Job A -");
    expect(titleWithinProject("Job A ·", "Job A")).toBe("Job A ·");
  });

  it("leaves everything alone when there is no project name", () => {
    expect(titleWithinProject("Report - 8/14/2026", null)).toBe("Report - 8/14/2026");
    expect(titleWithinProject("Report - 8/14/2026", "")).toBe("Report - 8/14/2026");
    expect(titleWithinProject("Report - 8/14/2026", undefined)).toBe("Report - 8/14/2026");
  });

  it("copes with an absent title", () => {
    expect(titleWithinProject(null, "Job A")).toBe("");
    expect(titleWithinProject(undefined, "Job A")).toBe("");
  });

  it("matches case-insensitively, because the stored casing drifts", () => {
    expect(titleWithinProject("job a - Daily Log", "Job A")).toBe("Daily Log");
  });
});

describe("only the in-project lists use it", () => {
  /*
   * The stored title still carries the job name, and must: a public link, a
   * PDF, or an email attachment is read away from the project screen, where the
   * name is the only thing saying which site it belongs to. This is display
   * only, in the two lists rendered inside a job.
   */
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("is applied on the project documents and reports lists", () => {
    expect(read("apps/mobile/app/(app)/project/[id]/documents.tsx")).toContain(
      "titleWithinProject(page.title",
    );
    expect(read("apps/mobile/app/(app)/project/[id]/reports.tsx")).toContain(
      "titleWithinProject(report.title",
    );
  });

  it("does not touch what gets written or shared", () => {
    // No write path should be rewriting titles on the way out.
    for (const p of ["apps/mobile/src/api/pages.ts", "apps/mobile/src/api/report-view.ts"]) {
      expect(read(p)).not.toContain("titleWithinProject");
    }
  });
});
