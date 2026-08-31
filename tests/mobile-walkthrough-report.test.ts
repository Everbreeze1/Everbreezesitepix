import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canOpenReport,
  reportRefusal,
  reportResultMessage,
} from "../apps/mobile/src/api/walkthrough-report-view";

/*
 * Turning a walkthrough into the report a client receives.
 *
 * The end of a chain the phone had only half of. `generateWalkthroughReport`
 * writes the structured report CONTENT onto the walkthrough and never touches
 * `project_reports`, so a crew could record a walk, generate its report from the
 * van, and still need a desk to produce the thing anybody outside the company
 * ever sees.
 *
 * The op is idempotent by LOOKUP rather than by an idempotency key: it finds an
 * existing report for the walkthrough and answers `alreadyExisted`. That makes
 * the wording the thing worth testing, because reporting both cases the same way
 * tells somebody who tapped twice that they now have two reports to delete.
 */

describe("reportResultMessage", () => {
  it("says a report was created when one was", () => {
    expect(reportResultMessage({ reportId: "r1", alreadyExisted: false })).toContain("created");
  });

  it("says it already existed rather than claiming a second one", () => {
    const message = reportResultMessage({ reportId: "r1", alreadyExisted: true });
    expect(message).toContain("already had a report");
    expect(message).not.toContain("created");
  });

  it("does not claim success without an id", () => {
    // A cheerful message with nothing to open is how somebody ends up looking
    // for a report that was never made.
    expect(reportResultMessage({ reportId: null, alreadyExisted: false })).toContain(
      "could not be created",
    );
  });
});

describe("canOpenReport", () => {
  it("is the navigation decision, kept apart from the message", () => {
    /*
     * Separate on purpose: the screen speaks on one and pushes a route on the
     * other, and a missing id with a cheerful message would push
     * `/report/undefined`.
     */
    expect(canOpenReport({ reportId: "r1", alreadyExisted: false })).toBe(true);
    expect(canOpenReport({ reportId: "r1", alreadyExisted: true })).toBe(true);
    expect(canOpenReport({ reportId: null, alreadyExisted: false })).toBe(false);
  });
});

describe("reportRefusal", () => {
  it("refuses without a transcript, which is what the report is written from", () => {
    // Said before the tap. The existing Generate report button refuses on the
    // same ground, and this one additionally spends a Pro quota slot.
    expect(reportRefusal(false)).toContain("transcript");
    expect(reportRefusal(true)).toBeNull();
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/walkthroughs/service.ts"), "utf8");
  const client = () =>
    readFileSync(join(process.cwd(), "apps/mobile/src/api/walkthroughs.ts"), "utf8");

  it("reads the two fields the service answers with", () => {
    expect(service()).toContain(
      "return { reportId: existing.id as string, alreadyExisted: true };",
    );
    const c = client();
    expect(c).toContain("result?.reportId");
    expect(c).toContain("result?.alreadyExisted");
  });

  it("targets the op that actually writes a report row", () => {
    /*
     * The distinction this feature exists for, asserted rather than remembered:
     * only `createReportFromWalkthroughService` touches `project_reports`.
     * `generateWalkthroughReportService` writes the walkthrough's own content.
     */
    const s = service();
    const createAt = s.indexOf("export async function createReportFromWalkthroughService");
    const createBody = s.slice(createAt, createAt + 4000);
    expect(createBody).toContain('.from("project_reports")');

    const genAt = s.indexOf("export async function generateWalkthroughReportService");
    const genBody = s.slice(genAt, createAt > genAt ? createAt : genAt + 4000);
    expect(genBody).not.toContain('.from("project_reports")');

    // Loose on purpose: matching the whole formatted call would break on a
    // prettier reflow rather than on a real change of target.
    expect(client()).toContain('"createReportFromWalkthrough"');
  });

  it("leaves the plan gate on the server", () => {
    // Pro and Team, enforced service-side. The phone lets the refusal through
    // rather than carrying a second copy of the rule.
    const s = service();
    const at = s.indexOf("export async function createReportFromWalkthroughService");
    expect(s.slice(at, at + 1200)).toContain("Pro");
  });
});
