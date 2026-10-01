import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRANSCRIPTION_STALE_MS,
  readTranscriptionRecord,
  transcriptionIsRunning,
  transcriptionOutcome,
  transcriptionPathError,
} from "../apps/api/src/domains/walkthroughs/transcription-state";

/*
 * Transcribing a walkthrough, and saying how it went.
 *
 * Three failures this pins down. The server used to answer `{ transcript: "" }`
 * and write nothing when the model heard no speech, so a failed walk looked
 * exactly like one nobody had tried. A minute that failed inside a long walk
 * was dropped without a word. And the op signed whatever bucket and path it was
 * handed with the service role, which made it a read of any file in storage.
 */

const USER = "u1";
const PROJECT = "p1";
const WALK = "11111111-1111-4111-8111-111111111111";
const VIDEO = `${USER}/${PROJECT}/walkthroughs/${WALK}.mp4`;

describe("transcriptionPathError", () => {
  const base = { userId: USER, projectId: PROJECT, videoPath: VIDEO };

  it("accepts the walkthrough's own recording", () => {
    expect(transcriptionPathError({ ...base, bucket: "site-videos", storagePath: VIDEO })).toBe(
      null,
    );
  });

  it("accepts a file under the caller's prefix for this project", () => {
    expect(
      transcriptionPathError({
        ...base,
        bucket: undefined,
        storagePath: `${USER}/${PROJECT}/walkthroughs/other.mp4`,
      }),
    ).toBe(null);
  });

  it("refuses any bucket but site-videos", () => {
    expect(transcriptionPathError({ ...base, bucket: "site-photos", storagePath: VIDEO })).toMatch(
      /site-videos/,
    );
  });

  it("refuses another user's file and another project's file", () => {
    expect(
      transcriptionPathError({
        ...base,
        bucket: "site-videos",
        storagePath: `u2/${PROJECT}/x.mp4`,
      }),
    ).not.toBeNull();
    expect(
      transcriptionPathError({ ...base, bucket: "site-videos", storagePath: `${USER}/p2/x.mp4` }),
    ).not.toBeNull();
  });

  it("refuses a path that climbs out of the prefix", () => {
    expect(
      transcriptionPathError({
        ...base,
        bucket: "site-videos",
        storagePath: `${USER}/${PROJECT}/../../u2/p9/x.mp4`,
      }),
    ).not.toBeNull();
  });
});

describe("transcriptionOutcome", () => {
  it("names a walk that heard nothing as empty, not done", () => {
    const outcome = transcriptionOutcome({ transcriptChars: 0, failedPieces: 0, totalPieces: 4 });
    expect(outcome.state).toBe("empty");
    expect(outcome.message).toMatch(/No speech/);
  });

  it("says how many minutes were lost", () => {
    const outcome = transcriptionOutcome({ transcriptChars: 80, failedPieces: 2, totalPieces: 9 });
    expect(outcome.state).toBe("partial");
    expect(outcome.message).toContain("2 minutes could not be transcribed");
    expect(
      transcriptionOutcome({ transcriptChars: 80, failedPieces: 1, totalPieces: 9 }).message,
    ).toContain("1 minute could not");
  });

  it("is failed when minutes were lost and nothing was heard in the rest", () => {
    expect(
      transcriptionOutcome({ transcriptChars: 0, failedPieces: 3, totalPieces: 5 }).state,
    ).toBe("failed");
  });

  it("has nothing to say about a clean run", () => {
    expect(transcriptionOutcome({ transcriptChars: 80, failedPieces: 0, totalPieces: 3 })).toEqual({
      state: "done",
      message: null,
    });
  });
});

describe("the record on the row", () => {
  it("ignores a malformed record", () => {
    expect(readTranscriptionRecord(null)).toBeNull();
    expect(readTranscriptionRecord({ transcription: { state: "bogus" } })).toBeNull();
    expect(readTranscriptionRecord({ transcriptSegments: [] })).toBeNull();
  });

  it("treats a run that outlived its window as dead", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    const fresh = readTranscriptionRecord({
      transcription: { state: "running", startedAt: new Date(now - 60_000).toISOString() },
    });
    const stale = readTranscriptionRecord({
      transcription: {
        state: "running",
        startedAt: new Date(now - TRANSCRIPTION_STALE_MS - 1).toISOString(),
      },
    });
    expect(transcriptionIsRunning(fresh, now)).toBe(true);
    expect(transcriptionIsRunning(stale, now)).toBe(false);
  });
});

/* ------------------------------------------------------------------ service */

type Walk = Record<string, any>;
const db = {
  walk: null as Walk | null,
  signed: [] as Array<{ bucket: string; path: string }>,
};

function fakeSupabase() {
  const builder = (table: string) => {
    let update: any = null;
    const result = () => {
      if (update) {
        if (table === "walkthroughs" && db.walk) Object.assign(db.walk, update);
        return { data: null, error: null };
      }
      if (table === "walkthroughs") return { data: db.walk ? { ...db.walk } : null, error: null };
      return { data: [], error: null };
    };
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      in: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      update: (payload: any) => {
        update = payload;
        return chain;
      },
      single: async () => result(),
      maybeSingle: async () => result(),
      then: (resolve: any, reject: any) => Promise.resolve(result()).then(resolve, reject),
    };
    return chain;
  };
  return {
    from: (table: string) => builder(table),
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string) => {
          db.signed.push({ bucket, path });
          return { data: { signedUrl: `https://storage.example/${path}` }, error: null };
        },
      }),
    },
  };
}

const transcribeAudioTimed = vi.fn();
const extractAdtsPieces = vi.fn();
const findAacTrack = vi.fn();

vi.mock("../apps/api/src/lib/supabase", () => ({
  getSupabaseAdmin: () => fakeSupabase(),
}));
vi.mock("../apps/api/src/domains/ai/service", async (importOriginal) => ({
  ...((await importOriginal()) as object),
  transcribeAudioTimed: (...args: unknown[]) => transcribeAudioTimed(...args),
}));
vi.mock("../apps/api/src/lib/mp4-audio", () => ({
  bufferSource: (bytes: Uint8Array) => bytes,
  rangeSource: async () => ({}),
  findAacTrack: (...args: unknown[]) => findAacTrack(...args),
  extractAdtsPieces: (...args: unknown[]) => extractAdtsPieces(...args),
}));

const { transcribeWalkthroughService, getWalkthroughTranscriptionService } =
  await import("../apps/api/src/domains/walkthroughs/service");
const { summaryCoversWalk } = await import("../apps/api/src/domains/walkthroughs/summaries");

const ctx = () => ({ userId: USER, supabase: fakeSupabase() }) as any;
const audio = () => Buffer.alloc(4096, 1).toString("base64");
const piece = (i: number) => ({
  startSeconds: i * 60,
  durationSeconds: 60,
  bytes: new Uint8Array(8),
});

beforeEach(() => {
  db.walk = {
    id: WALK,
    created_by: USER,
    project_id: PROJECT,
    title: "Attic",
    transcript: null,
    duration_seconds: 180,
    video_path: null,
    video_mime_type: null,
    narration_json: null,
  };
  db.signed = [];
  transcribeAudioTimed.mockReset();
  extractAdtsPieces.mockReset();
  findAacTrack.mockReset();
  findAacTrack.mockResolvedValue(null);
});

describe("transcribeWalkthroughService: who may read what", () => {
  it("refuses a bucket other than site-videos with a 403, before signing anything", async () => {
    await expect(
      transcribeWalkthroughService(ctx(), {
        walkthroughId: WALK,
        storagePath: `${USER}/${PROJECT}/x.jpg`,
        bucket: "site-photos",
        mimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.signed).toEqual([]);
  });

  it("refuses somebody else's recording with a 403", async () => {
    await expect(
      transcribeWalkthroughService(ctx(), {
        walkthroughId: WALK,
        storagePath: `u2/p9/walkthroughs/theirs.mp4`,
        bucket: "site-videos",
        mimeType: "video/mp4",
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(db.signed).toEqual([]);
  });

  it("refuses a walkthrough the caller did not record with a 403", async () => {
    db.walk!.created_by = "u2";
    await expect(
      transcribeWalkthroughService(ctx(), {
        walkthroughId: WALK,
        audioBase64: audio(),
        mimeType: "audio/wav",
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe("transcribeWalkthroughService: every outcome is said and kept", () => {
  it("answers empty, and records it, when nobody spoke", async () => {
    transcribeAudioTimed.mockResolvedValue([]);
    const result = await transcribeWalkthroughService(ctx(), {
      walkthroughId: WALK,
      audioBase64: audio(),
      mimeType: "audio/wav",
    });
    // `transcript` stays, so the current app and web read it as they always did.
    expect(result.transcript).toBe("");
    expect(result.empty).toBe(true);
    expect(result.state).toBe("empty");
    expect(db.walk!.narration_json.transcription.state).toBe("empty");
  });

  it("retries from the stored video when the audio-only upload heard nothing", async () => {
    db.walk!.video_path = VIDEO;
    db.walk!.video_mime_type = "video/mp4";
    findAacTrack.mockResolvedValueOnce(null).mockResolvedValueOnce({});
    extractAdtsPieces.mockResolvedValue([piece(0)]);
    transcribeAudioTimed
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ start: 1, text: "The condenser coil is clean." }]);
    const result = await transcribeWalkthroughService(ctx(), {
      walkthroughId: WALK,
      audioBase64: audio(),
      mimeType: "audio/wav",
    });
    expect(db.signed).toEqual([{ bucket: "site-videos", path: VIDEO }]);
    expect(result.videoFallback).toBe(true);
    expect(result.transcript).toContain("condenser coil");
    expect(result.empty).toBeUndefined();
    expect(db.walk!.transcript).toContain("condenser coil");
  });

  it("counts the minutes it could not transcribe instead of dropping them", async () => {
    db.walk!.video_path = VIDEO;
    findAacTrack.mockResolvedValue({});
    extractAdtsPieces.mockResolvedValue([piece(0), piece(1), piece(2)]);
    transcribeAudioTimed.mockImplementation(async (_b64: string, _fmt: string) => {
      const call = transcribeAudioTimed.mock.calls.length;
      if (call === 2) throw new Error("AI error 500");
      return [{ start: 2, text: `Minute ${call} notes.` }];
    });
    const result = await transcribeWalkthroughService(ctx(), {
      walkthroughId: WALK,
      storagePath: VIDEO,
      bucket: "site-videos",
      mimeType: "video/mp4",
    });
    expect(result.failedPieces).toBe(1);
    expect(result.totalPieces).toBe(3);
    expect(result.state).toBe("partial");
    expect(result.message).toContain("1 minute could not be transcribed");
    expect(db.walk!.narration_json.transcription.failedPieces).toBe(1);
  });

  it("records a failure rather than leaving the walk looking untried", async () => {
    transcribeAudioTimed.mockRejectedValue(
      Object.assign(new Error("That recording had no audio in it."), { status: 400 }),
    );
    await expect(
      transcribeWalkthroughService(ctx(), {
        walkthroughId: WALK,
        audioBase64: audio(),
        mimeType: "audio/wav",
      }),
    ).rejects.toThrow(/no audio/);
    expect(db.walk!.narration_json.transcription).toMatchObject({
      state: "failed",
      message: "That recording had no audio in it.",
    });
  });
});

describe("transcribeWalkthroughService: safe to call again", () => {
  it("does not start a second run while one is under way", async () => {
    db.walk!.narration_json = {
      transcription: { state: "running", startedAt: new Date().toISOString() },
    };
    const result = await transcribeWalkthroughService(ctx(), {
      walkthroughId: WALK,
      audioBase64: audio(),
      mimeType: "audio/wav",
    });
    expect(result.inProgress).toBe(true);
    expect(transcribeAudioTimed).not.toHaveBeenCalled();
  });

  it("answers at once in the background and leaves the outcome to poll", async () => {
    let finish: (lines: unknown[]) => void = () => {};
    transcribeAudioTimed.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const result = await transcribeWalkthroughService(ctx(), {
      walkthroughId: WALK,
      audioBase64: audio(),
      mimeType: "audio/wav",
      background: true,
    });
    expect(result.inProgress).toBe(true);
    expect((await getWalkthroughTranscriptionService(ctx(), { walkthroughId: WALK })).state).toBe(
      "running",
    );

    finish([{ start: 0, text: "Filter replaced." }]);
    await vi.waitFor(async () => {
      const status = await getWalkthroughTranscriptionService(ctx(), { walkthroughId: WALK });
      expect(status.state).toBe("done");
      expect(status.transcript).toBe("Filter replaced.");
    });
  });

  it("reports a run that died with its process as failed, so it can be retried", async () => {
    db.walk!.narration_json = {
      transcription: {
        state: "running",
        startedAt: new Date(Date.now() - TRANSCRIPTION_STALE_MS - 1000).toISOString(),
      },
    };
    const status = await getWalkthroughTranscriptionService(ctx(), { walkthroughId: WALK });
    expect(status.state).toBe("failed");
    expect(status.message).toMatch(/did not finish/);
  });
});

describe("summaryCoversWalk", () => {
  const notes = (...ids: string[]) =>
    ids.map((photoId) => ({ photoId, offsetSeconds: 0, note: "", spoken: null }));

  it("reuses a summary that has every photo and the current transcript", () => {
    expect(
      summaryCoversWalk(
        { photo_notes: notes("a", "b"), transcript: "Coil cleaned." },
        { photoIds: ["a", "b"], transcript: "Coil cleaned." },
      ),
    ).toBe(true);
  });

  it("is out of date once a late snap lands", () => {
    expect(
      summaryCoversWalk(
        { photo_notes: notes("a"), transcript: null },
        { photoIds: ["a", "b"], transcript: "" },
      ),
    ).toBe(false);
  });

  it("is out of date once a transcript arrives after it", () => {
    expect(
      summaryCoversWalk(
        { photo_notes: notes("a"), transcript: null },
        { photoIds: ["a"], transcript: "Coil cleaned." },
      ),
    ).toBe(false);
  });
});
