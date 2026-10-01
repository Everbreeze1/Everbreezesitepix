import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calibrateSnapOffsets,
  countMissingFrames,
  encoderDelaySeconds,
  missingFramesNotice,
  type WalkthroughSnap,
} from "../apps/mobile/src/api/walkthrough-snap-rules";

/*
 * A walkthrough recorded on the phone, queued at Stop.
 *
 * The recorder used to make the session, upload the video, finish and
 * transcribe inline after Stop, with a React ref as the only record of how far
 * it had got: closing the app part way lost the walk. It now moves the clip
 * into the outbox the moment it lands and queues one `walkthrough_video` row,
 * which runs web's steps in web's order and saves each one on the row, so a
 * retry carries on rather than starting again. The report waits for the
 * walk's snaps so it includes them.
 *
 * Run against real SQLite (the `expo-sqlite` double over `node:sqlite`), with
 * the API steps faked, so the resume and wait rules tested are the app's own.
 */

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const SCREEN = "apps/mobile/app/(app)/project/[id]/walkthrough-record.tsx";

vi.mock("../apps/mobile/src/offline/media", () => ({
  discardCapture: () => {},
  sweepOrphans: () => 0,
}));

type Outbox = typeof import("../apps/mobile/src/offline/outbox");
type Runner = typeof import("../apps/mobile/src/offline/walkthrough-video");

let db: DatabaseSync;
let outbox: Outbox;
let runner: Runner;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  vi.resetModules();
  const sqlite = await import("./doubles/expo-sqlite");
  sqlite.__useDatabase(db);
  outbox = await import("../apps/mobile/src/offline/outbox");
  runner = await import("../apps/mobile/src/offline/walkthrough-video");
});

afterEach(() => {
  db.close();
});

const VIDEO_ROW = "video-row";

function basePayload(sessionId: string | null = null) {
  return {
    userId: "u1",
    projectId: "p1",
    title: "Smith job - Oct 1, 2026",
    startedAt: "2026-10-01T09:00:00.000Z",
    durationSeconds: 95,
    mimeType: "video/mp4",
    sessionId,
  };
}

async function queueVideo(sessionId: string | null = null) {
  await outbox.enqueue({
    id: VIDEO_ROW,
    kind: "walkthrough_video",
    projectId: "p1",
    localUri: "file:///app/documents/outbox/video-row.mp4",
    payload: basePayload(sessionId),
  });
}

async function queueSnap(id: string, walkthroughId: string) {
  await outbox.enqueue({
    id,
    kind: "walkthrough_photo",
    projectId: "p1",
    localUri: `file:///app/documents/outbox/${id}.jpg`,
    payload: { userId: "u1", projectId: "p1", walkthroughId, videoRowId: VIDEO_ROW },
  });
}

async function claimVideo() {
  const row = await outbox.claimNext();
  expect(row?.id).toBe(VIDEO_ROW);
  return row!;
}

async function storedPayload(id = VIDEO_ROW) {
  const row = db.prepare("SELECT payload FROM outbox WHERE id = ?").get(id) as { payload: string };
  return JSON.parse(row.payload);
}

function fakeSteps(overrides: Partial<Record<string, unknown>> = {}) {
  const calls: string[] = [];
  const steps = {
    createSession: vi.fn(async (_p: string, _t: string, o: { startedAt: string }) => {
      calls.push(`create:${o.startedAt}`);
      return { id: "wt-1" };
    }),
    videoPath: (u: string, p: string, w: string, ext: string) =>
      `${u}/${p}/walkthroughs/${w}.${ext}`,
    uploadVideo: vi.fn(async (o: { storagePath: string }) => {
      calls.push(`upload:${o.storagePath}`);
    }),
    updateVideoPath: vi.fn(async () => {
      calls.push("path");
    }),
    finish: vi.fn(async (_id: string, d: number) => {
      calls.push(`finish:${d}`);
    }),
    transcribe: vi.fn(async () => {
      calls.push("transcribe");
      return { ok: true, message: null, empty: false };
    }),
    generateReport: vi.fn(async () => {
      calls.push("report");
    }),
    createReport: vi.fn(async () => {
      calls.push("clientReport");
      return { reportId: "r1" };
    }),
    ...overrides,
  };
  return { steps: steps as unknown as Parameters<Runner["runWalkthroughVideo"]>[1], calls };
}

describe("a queued walkthrough", () => {
  it("runs web's steps in web's order", async () => {
    await queueVideo();
    const { steps, calls } = fakeSteps();

    const done = await runner.runWalkthroughVideo(await claimVideo(), steps);

    expect(calls).toEqual([
      // Made later with the real start time, since Record had no signal.
      "create:2026-10-01T09:00:00.000Z",
      "upload:u1/p1/walkthroughs/wt-1.mp4",
      "path",
      "finish:95",
      "transcribe",
      "report",
      "clientReport",
    ]);
    expect(done.reportId).toBe("r1");
  });

  it("does not make a second walkthrough when one was made at Record", async () => {
    await queueVideo("wt-at-record");
    const { steps } = fakeSteps();
    await runner.runWalkthroughVideo(await claimVideo(), steps);
    expect(steps.createSession).not.toHaveBeenCalled();
  });

  it("carries on from the step that failed rather than starting again", async () => {
    await queueVideo();
    let uploads = 0;
    const { steps, calls } = fakeSteps({
      uploadVideo: vi.fn(async () => {
        uploads += 1;
        if (uploads === 1) throw new Error("Network request failed");
        calls.push("upload");
      }),
    });

    await expect(runner.runWalkthroughVideo(await claimVideo(), steps)).rejects.toThrow(
      "Network request failed",
    );
    // The walkthrough it made is on the row, so the retry reuses it.
    expect((await storedPayload()).sessionId).toBe("wt-1");

    await outbox.markFailed((await outbox.listRows()).find((r) => r.id === VIDEO_ROW)!, "x");
    db.prepare("UPDATE outbox SET next_attempt = 0").run();
    await runner.runWalkthroughVideo(await claimVideo(), steps);

    expect(steps.createSession).toHaveBeenCalledTimes(1);
    expect(calls.filter((c) => c.startsWith("create"))).toHaveLength(1);
    expect(calls).toContain("clientReport");
  });

  it("waits for the walk's snaps before writing the report", async () => {
    await queueVideo();
    // Queued with no signal: no walkthrough id yet, only the video's row.
    await queueSnap("snap-1", "");
    const { steps, calls } = fakeSteps();

    const row = await claimVideo();
    const error = await runner.runWalkthroughVideo(row, steps).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(outbox.DeferredError);
    expect(calls).not.toContain("report");
    // The snap now knows its walkthrough, so it can be sent.
    expect((await storedPayload("snap-1")).walkthroughId).toBe("wt-1");
    expect(await runner.queuedWalkthroughId(VIDEO_ROW)).toBe("wt-1");

    // Deferred, not failed: no attempt counted.
    await outbox.deferRow(row, 0, (error as Error).message);
    const back = db.prepare("SELECT state, attempts FROM outbox WHERE id = ?").get(VIDEO_ROW);
    expect(back).toEqual({ state: "pending", attempts: 0 });

    // The snap lands; the report goes, without repeating the steps before it.
    db.prepare("DELETE FROM outbox WHERE id = 'snap-1'").run();
    await runner.runWalkthroughVideo(await claimVideo(), steps);
    expect(calls.filter((c) => c === "transcribe")).toHaveLength(1);
    expect(calls.slice(-2)).toEqual(["report", "clientReport"]);
  });

  it("does not wait for a snap that has given up", async () => {
    await queueVideo("wt-1");
    await queueSnap("snap-1", "wt-1");
    db.prepare("UPDATE outbox SET state = 'failed' WHERE id = 'snap-1'").run();
    const { steps, calls } = fakeSteps();
    await runner.runWalkthroughVideo(await claimVideo(), steps);
    expect(calls).toContain("report");
  });

  it("writes down an empty transcript and still writes the report", async () => {
    await queueVideo();
    const { steps, calls } = fakeSteps({
      transcribe: vi.fn(async () => ({ ok: true, message: null, empty: true })),
    });
    const done = await runner.runWalkthroughVideo(await claimVideo(), steps);
    expect(done.transcriptEmpty).toBe(true);
    expect(done.softFailures?.transcribe).toBeTruthy();
    expect(calls).toContain("report");
  });

  it("does not count a plan refusal of the client report as a failure", async () => {
    await queueVideo();
    const refusal = Object.assign(new Error("Reports from walkthroughs are a Pro feature"), {
      status: 403,
    });
    const { steps } = fakeSteps({
      createReport: vi.fn(async () => {
        throw refusal;
      }),
    });
    const done = await runner.runWalkthroughVideo(await claimVideo(), steps);
    expect(done.reportCreated).toBe(true);
    expect(done.softFailures?.clientReport).toMatch(/Pro feature/);
  });

  it("retries a failing AI step a few times, then carries on without it", async () => {
    await queueVideo();
    const { steps, calls } = fakeSteps({
      transcribe: vi.fn(async () => ({ ok: false, message: "Model overloaded", empty: false })),
    });

    for (let i = 1; i < runner.SOFT_STEP_TRIES; i += 1) {
      await expect(runner.runWalkthroughVideo(await claimVideo(), steps)).rejects.toThrow(
        "Model overloaded",
      );
      db.prepare("UPDATE outbox SET state = 'pending' WHERE id = ?").run(VIDEO_ROW);
    }
    const done = await runner.runWalkthroughVideo(await claimVideo(), steps);
    expect(done.softFailures?.transcribe).toBe("Model overloaded");
    expect(calls).toContain("clientReport");
  });
});

describe("the drain", () => {
  it("puts a deferred row back without counting an attempt or parking its project", () => {
    const sync = read("apps/mobile/src/offline/sync.ts");
    const at = sync.indexOf("if (error instanceof DeferredError)");
    expect(at).toBeGreaterThan(-1);
    const branch = sync.slice(at, sync.indexOf("continue;", at));
    expect(branch).toContain("deferRow(row, error.delayMs");
    expect(branch).not.toContain("markFailed");
    expect(branch).not.toContain("parked.push");
    expect(sync).toContain("wakeAfter(error.delayMs)");
  });

  it("knows the kind and runs it through the resumable runner", () => {
    expect(read("apps/mobile/src/offline/outbox.ts")).toContain('| "walkthrough_video"');
    const handlers = read("apps/mobile/src/offline/handlers.ts");
    expect(handlers).toContain("walkthrough_video: async (row)");
    expect(handlers).toContain("runWalkthroughVideo(row, walkthroughSteps)");
    // A snap queued before its walkthrough existed finds it through the video row.
    expect(handlers).toContain("queuedWalkthroughId(payload.videoRowId)");
  });

  it("gives transcription longer than the usual AI timeout", () => {
    const api = read("apps/mobile/src/api/walkthroughs.ts");
    expect(api).toContain("WALKTHROUGH_TRANSCRIBE_TIMEOUT_MS = 5 * 60_000");
    expect(api).toContain("timeoutMs: options.timeoutMs ?? WALKTHROUGH_TRANSCRIBE_TIMEOUT_MS");
  });
});

describe("snap timing", () => {
  const snap = (offsetSeconds: number, uri: string | null = null): WalkthroughSnap => ({
    id: `s${offsetSeconds}`,
    offsetSeconds,
    capturedAt: "2026-10-01T09:00:00.000Z",
    uri,
    width: null,
    height: null,
    exif: null,
    needsFrame: uri === null,
  });

  it("measures the encoder's late start from the clock and the video", () => {
    expect(encoderDelaySeconds(61.2, 60)).toBeCloseTo(1.2);
    // Unknown, longer than the clock, or implausibly late: not trusted.
    expect(encoderDelaySeconds(60, null)).toBe(0);
    expect(encoderDelaySeconds(60, 60.4)).toBe(0);
    expect(encoderDelaySeconds(90, 60)).toBe(0);
  });

  it("moves every snap back by it, never before the start", () => {
    const fixed = calibrateSnapOffsets([snap(0.5), snap(10)], 1.2);
    expect(fixed[0].offsetSeconds).toBe(0);
    expect(fixed[1].offsetSeconds).toBeCloseTo(8.8);
  });

  it("says how many snaps could not be taken from the video", () => {
    const snaps = [snap(1, "file:///a.jpg"), snap(2), snap(3)];
    expect(countMissingFrames(snaps)).toBe(2);
    expect(missingFramesNotice(2)).toBe("2 photos could not be taken from the video");
    expect(missingFramesNotice(1)).toBe("1 photo could not be taken from the video");
    expect(missingFramesNotice(0)).toBeNull();
  });
});

describe("the recorder", () => {
  const src = () => read(SCREEN);

  it("records 720p at a bitrate a single upload can carry", () => {
    expect(src()).toContain('const VIDEO_QUALITY = "720p" as const;');
    expect(src()).toContain("const VIDEO_BITRATE = 2_500_000;");
    expect(src()).toContain("videoQuality={VIDEO_QUALITY}");
    expect(src()).toContain("videoBitrate={VIDEO_BITRATE}");
  });

  it("waits for the camera, with a fallback, and remakes one that fails to start", () => {
    const s = src();
    expect(s).toContain("onCameraReady={() => {");
    expect(s).toContain("onMountError={() => {");
    expect(s).toContain("key={cameraKey}");
    expect(s).toContain("setTimeout(() => setCameraReady(true), CAMERA_READY_FALLBACK_MS)");
    expect(s).toMatch(/const recordDisabled = stage === "saving" \|\| \(!cameraReady/);
  });

  it("makes the walkthrough at Record when there is signal, as web does", () => {
    const s = src();
    const start = s.slice(s.indexOf("  async function start()"), s.indexOf("  function stop()"));
    expect(start).toContain("session: startSession(title, startedAtIso)");
    expect(start.indexOf("startSession(")).toBeLessThan(start.indexOf("recordAsync("));
  });

  it("never wipes a stopped walk when Record is pressed again", () => {
    const s = src();
    const start = s.slice(s.indexOf("  async function start()"), s.indexOf("  function stop()"));
    // The take and its snaps are read once the recording ends, before
    // anything can reset them, and handed to the background save.
    expect(start).toContain("const thisTake = take.current;");
    expect(start).toContain("const snaps = shotsRef.current;");
    expect(start).toContain("saveWalkthrough(recording.uri, durationSeconds, thisTake, snaps)");
    expect(s).toContain('showNotice("Saving walkthrough in the background")');
  });

  it("asks Save or Discard before leaving mid-recording, and never navigates once gone", () => {
    const s = src();
    expect(s).toContain('navigation.addListener("beforeRemove"');
    expect(s).toContain('answerLeave("discard")');
    expect(s).toContain('answerLeave("save")');
    expect(s).toMatch(
      /function finishExit\(\) \{[\s\S]*?if \(!exit \|\| !mounted\.current\) return;/,
    );
  });

  it("keeps the screen on while recording and says when the app left mid-walk", () => {
    const s = src();
    expect(s).toContain('useKeepAwakeWhile(stage === "recording")');
    expect(s).toContain('AppState.addEventListener("change"');
    expect(s).toContain(
      "Recording stopped because the screen turned off or the app left the screen",
    );
    const keep = read("apps/mobile/src/lib/keep-awake.ts");
    expect(keep).toContain("activateKeepAwakeAsync(KEEP_AWAKE_TAG)");
    expect(keep).toContain("deactivateKeepAwake(KEEP_AWAKE_TAG)");
  });

  it("offers Settings when the microphone was refused for good", () => {
    const s = src();
    expect(s).toContain("setMicBlocked(!granted.canAskAgain)");
    expect(s).toContain("Linking.openSettings()");
  });

  it("caps a walkthrough by plan as web does", () => {
    const api = read("apps/mobile/src/api/walkthroughs.ts");
    expect(api).toMatch(/starter: 600,\s*pro: 900,\s*team: 1200,/);
  });
});
