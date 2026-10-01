import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  canOpenReport,
  newPhotosMessage,
  newPhotosSinceSummary,
  queuedWalkthroughPhotos,
  reportNote,
  reportResultMessage,
  transcriptionIsProblem,
  transcriptionNotice,
  transcriptionState,
  uploadHoldMessage,
} from "../apps/mobile/src/api/walkthrough-report-view";
import {
  runTranscription,
  transcriptionNotice as webTranscriptionNotice,
} from "../apps/web/src/features/walkthroughs/transcription";

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

describe("reportNote", () => {
  it("says what a report without a transcript is made of, without refusing it", () => {
    /*
     * The buttons used to be dead without a transcript. The server builds the
     * report from the photos when nobody spoke, and the web lets that happen,
     * so the phone now says so instead of blocking it.
     */
    expect(reportNote(false)).toContain("photos");
    expect(reportNote(true)).toBeNull();
  });

  it("no longer gates the buttons on the transcript", () => {
    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/walkthrough/[id].tsx"),
      "utf8",
    );
    expect(screen).not.toContain("reportRefusal");
    expect(screen).not.toContain("|| !detail.transcript");
    expect(screen).not.toContain("transcribed from the web app");
  });
});

describe("transcription outcome wording", () => {
  it("prefers the server's sentence", () => {
    expect(
      transcriptionNotice({ state: "partial", failedPieces: 2, message: "Server words." }),
    ).toBe("Server words.");
  });

  it("names lost minutes when an older server sends only counts", () => {
    expect(transcriptionNotice({ state: "partial", failedPieces: 2 })).toBe(
      "2 minutes could not be transcribed. The rest was saved.",
    );
    expect(transcriptionNotice({ state: "failed", failedPieces: 1 })).toContain(
      "1 minute could not be transcribed",
    );
  });

  it("reads a bare `{ transcript }` from an older server", () => {
    expect(transcriptionState({ transcript: "" })).toBe("empty");
    expect(transcriptionState({ transcript: "Coil cleaned." })).toBe("done");
    expect(transcriptionNotice({ transcript: "" })).toMatch(/No speech/);
  });

  it("marks only the bad endings as problems", () => {
    expect(transcriptionIsProblem({ state: "done" })).toBe(false);
    expect(transcriptionIsProblem({ state: "empty" })).toBe(true);
    expect(transcriptionIsProblem({ state: "partial" })).toBe(true);
    expect(transcriptionIsProblem({ state: "failed" })).toBe(true);
  });

  it("says the same thing on the web", () => {
    for (const outcome of [
      { state: "partial" as const, failedPieces: 3 },
      { state: "empty" as const },
      { transcript: "" },
      { state: "done" as const },
    ]) {
      expect(webTranscriptionNotice(outcome)).toBe(transcriptionNotice(outcome));
    }
  });
});

describe("runTranscription", () => {
  it("returns at once when the server answered inline", async () => {
    const status = async () => ({});
    const result = await runTranscription({
      start: async () => ({ transcript: "Done.", state: "done" }),
      status,
    });
    expect(result.state).toBe("done");
  });

  it("polls a background run until it ends, riding out a dropped poll", async () => {
    let calls = 0;
    const result = await runTranscription({
      start: async () => ({ inProgress: true, state: "running" }),
      status: async () => {
        calls += 1;
        if (calls === 1) throw new Error("offline");
        if (calls === 2) return { state: "running" };
        return { state: "partial", failedPieces: 1, message: "1 minute could not be transcribed." };
      },
      wait: async () => {},
    });
    expect(calls).toBe(3);
    expect(result.state).toBe("partial");
  });

  it("stops when the page goes away", async () => {
    const result = await runTranscription({
      start: async () => ({ inProgress: true }),
      status: async () => ({ state: "running" }),
      cancelled: () => true,
      wait: async () => {},
    });
    expect(result.inProgress).toBe(true);
  });
});

describe("photos still in the upload queue", () => {
  const row = (walkthroughId: string, state: string, kind = "walkthrough_photo") => ({
    kind,
    state,
    payload: JSON.stringify({ walkthroughId }),
  });

  it("counts this walk's snaps, apart from the ones that failed", () => {
    const rows = [
      row("w1", "pending"),
      row("w1", "sending"),
      row("w1", "failed"),
      row("w1", "done"),
      row("w2", "pending"),
      row("w1", "pending", "photo_upload"),
      { kind: "walkthrough_photo", state: "pending", payload: "not json" },
    ];
    expect(queuedWalkthroughPhotos(rows, "w1")).toEqual({ uploading: 2, failed: 1 });
  });

  it("holds the report while they upload, and says so", () => {
    expect(uploadHoldMessage({ uploading: 3, failed: 0 })).toContain("3 photos still uploading");
    expect(uploadHoldMessage({ uploading: 1, failed: 0 })).toContain("1 photo still uploading");
    expect(uploadHoldMessage({ uploading: 0, failed: 2 })).toContain("2 photos could not upload");
    expect(uploadHoldMessage({ uploading: 0, failed: 0 })).toBeNull();
  });

  it("always offers a way past the hold", () => {
    const screen = readFileSync(
      join(process.cwd(), "apps/mobile/app/(app)/walkthrough/[id].tsx"),
      "utf8",
    );
    expect(screen).toContain('"Generate anyway"');
  });
});

describe("photos the summary leaves out", () => {
  it("counts walk photos missing from the summary", () => {
    expect(newPhotosSinceSummary(["a", "b", "c"], ["a"])).toBe(2);
    expect(newPhotosSinceSummary(["a"], ["a", "b"])).toBe(0);
  });

  it("offers Regenerate when there are some", () => {
    expect(newPhotosMessage(0)).toBeNull();
    expect(newPhotosMessage(1)).toBe("1 new photo since this report. Regenerate to include it.");
    expect(newPhotosMessage(4)).toContain("4 new photos");
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
