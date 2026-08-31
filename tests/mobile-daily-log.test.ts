import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  logBatches,
  MAX_LOG_PHOTOS,
  readySessions,
  stillInFlight,
  type SessionPhotoRow,
} from "../apps/mobile/src/offline/capture-session-rules";
import {
  dayLabel,
  localDay,
  photoCountLabel,
  previewEntries,
  shouldShowLog,
} from "../apps/mobile/src/api/daily-log-view";

/*
 * The Daily Log on the phone.
 *
 * The feature is specified as writing itself the moment a capture session
 * finishes. On the web that is easy: the upload completes, the photo ids are in
 * hand, one call. On the phone a capture session does not finish when the
 * camera closes - the shots go to the outbox and land whenever there is signal,
 * each getting its id only as its upload completes, possibly after the app has
 * been killed and reopened.
 *
 * So "has this session finished" is the whole feature, and it is what most of
 * this file tests. It runs in a background drain where a wrong answer is
 * invisible: too eager writes up half a day's work, too cautious never writes
 * it up at all.
 */

const base: SessionPhotoRow = {
  outboxId: "o1",
  sessionId: "s1",
  projectId: "p1",
  photoId: null,
  source: "camera",
  tzOffset: 420,
  createdAt: 1000,
  outboxState: "pending",
};

const row = (over: Partial<SessionPhotoRow>): SessionPhotoRow => ({ ...base, ...over });

describe("stillInFlight", () => {
  it("is done once the photo has an id", () => {
    // The id only exists because the upload landed.
    expect(stillInFlight(row({ photoId: "ph1", outboxState: null }))).toBe(false);
  });

  it("waits on a row the queue still intends to send", () => {
    expect(stillInFlight(row({ outboxState: "pending" }))).toBe(true);
    expect(stillInFlight(row({ outboxState: "sending" }))).toBe(true);
  });

  it("does NOT wait on a row that gave up", () => {
    /*
     * The judgement that matters. A `failed` row has exhausted its retries or
     * hit a permanent error, and waiting for it means the log for a day's work
     * never appears because one photograph of twenty could not be delivered.
     * The nineteen that landed are still the day's record.
     */
    expect(stillInFlight(row({ outboxState: "failed" }))).toBe(false);
  });

  it("does not wait on a row that has vanished from the outbox", () => {
    // Cleared by hand from the queue screen, or delivered by a build that did
    // not record the photo id. Either way nothing is coming.
    expect(stillInFlight(row({ outboxState: null }))).toBe(false);
  });
});

describe("readySessions", () => {
  it("holds a session back while any photo is still queued", () => {
    const rows = [
      row({ outboxId: "o1", photoId: "ph1", outboxState: null }),
      row({ outboxId: "o2", outboxState: "pending" }),
    ];
    expect(readySessions(rows)).toEqual([]);
  });

  it("releases it once everything has landed", () => {
    const rows = [
      row({ outboxId: "o1", photoId: "ph1", outboxState: null, createdAt: 1 }),
      row({ outboxId: "o2", photoId: "ph2", outboxState: null, createdAt: 2 }),
    ];
    const [session] = readySessions(rows);
    expect(session.photoIds).toEqual(["ph1", "ph2"]);
    expect(session.projectId).toBe("p1");
    expect(session.outboxIds).toEqual(["o1", "o2"]);
  });

  it("releases it when the stragglers have given up", () => {
    // Nineteen delivered, one dead. The log is written from the nineteen.
    const rows = [
      row({ outboxId: "o1", photoId: "ph1", outboxState: null }),
      row({ outboxId: "o2", outboxState: "failed" }),
    ];
    expect(readySessions(rows)[0].photoIds).toEqual(["ph1"]);
  });

  it("orders photos as they were taken, not as they were delivered", () => {
    /*
     * The queue delivers whatever it can, so ids arrive out of order on a bad
     * connection. The log should read as the order somebody walked the site.
     */
    const rows = [
      row({ outboxId: "o2", photoId: "late", createdAt: 200, outboxState: null }),
      row({ outboxId: "o1", photoId: "early", createdAt: 100, outboxState: null }),
    ];
    expect(readySessions(rows)[0].photoIds).toEqual(["early", "late"]);
  });

  it("keeps sessions apart", () => {
    // Several trips to the van, each its own timestamped section.
    const rows = [
      row({ sessionId: "s1", outboxId: "o1", photoId: "a", outboxState: null }),
      row({ sessionId: "s2", outboxId: "o2", photoId: "b", outboxState: null }),
      row({ sessionId: "s2", outboxId: "o3", outboxState: "pending" }),
    ];
    const ready = readySessions(rows);
    expect(ready).toHaveLength(1);
    expect(ready[0].sessionId).toBe("s1");
  });

  it("returns a session where everything failed, with no photos", () => {
    /*
     * Nothing to write up, but the caller still needs the outbox ids so it can
     * clear the rows. Without this they are re-read on every drain for the life
     * of the install.
     */
    const rows = [row({ outboxId: "o1", outboxState: "failed" })];
    const [session] = readySessions(rows);
    expect(session.photoIds).toEqual([]);
    expect(session.outboxIds).toEqual(["o1"]);
  });

  it("carries the technician's own timezone offset, not the server's", () => {
    /*
     * Load-bearing. The API runs in UTC, so a 6:30pm job in California is
     * already tomorrow to the server: grouping on the server's clock filed
     * Wednesday evening's photos into Thursday's log and then appended
     * Thursday morning's to the same page. Two work days merged into one.
     */
    const rows = [row({ photoId: "ph1", outboxState: null, tzOffset: 420 })];
    expect(readySessions(rows)[0].tzOffsetMinutes).toBe(420);
  });

  it("passes a zero offset through rather than dropping it", () => {
    // 0 is a real offset (UTC), and `undefined` means something different to
    // the server. A falsy check here would silently rewrite one as the other.
    const rows = [row({ photoId: "ph1", outboxState: null, tzOffset: 0 })];
    expect(readySessions(rows)[0].tzOffsetMinutes).toBe(0);
  });

  it("only passes a source the server's enum accepts", () => {
    const camera = readySessions([row({ photoId: "p", outboxState: null, source: "camera" })]);
    expect(camera[0].source).toBe("camera");
    // Anything else is dropped rather than sent, because the schema is an enum
    // and a stray value would fail the whole call.
    const junk = readySessions([row({ photoId: "p", outboxState: null, source: "scanner" })]);
    expect(junk[0].source).toBeUndefined();
  });

  it("is empty for an empty table", () => {
    expect(readySessions([])).toEqual([]);
  });
});

describe("logBatches", () => {
  const session = (count: number) => ({
    sessionId: "s1",
    projectId: "p1",
    photoIds: Array.from({ length: count }, (_, i) => `ph${i}`),
    source: "camera" as const,
    tzOffsetMinutes: 0,
    outboxIds: [],
  });

  it("sends a normal session in one call", () => {
    expect(logBatches(session(12))).toHaveLength(1);
  });

  it("splits rather than truncating past the server's cap", () => {
    /*
     * The server rejects the whole request over its cap rather than trimming,
     * so a technician who shot eighty in one pass would get no log at all - and
     * no error either, because this runs in a background drain with nobody to
     * show one to.
     */
    const batches = logBatches(session(MAX_LOG_PHOTOS + 20));
    expect(batches).toHaveLength(2);
    expect(batches[0]).toHaveLength(MAX_LOG_PHOTOS);
    expect(batches[1]).toHaveLength(20);
    // Nothing lost off the end.
    expect(batches.flat()).toHaveLength(MAX_LOG_PHOTOS + 20);
  });

  it("matches the cap the server actually enforces", () => {
    const service = readFileSync(
      join(process.cwd(), "apps/api/src/domains/projects/daily-log.ts"),
      "utf8",
    );
    expect(service).toContain(`const MAX_SESSION_PHOTOS = ${MAX_LOG_PHOTOS};`);
  });

  it("yields nothing for a session with no photos", () => {
    expect(logBatches(session(0))).toEqual([]);
  });
});

describe("dayLabel", () => {
  /*
   * Resolved against the device's clock, because the server refuses to say
   * which day a log belongs to and is right to refuse: it runs in UTC and
   * cannot know whose midnight matters.
   */
  const at = (iso: string) => new Date(iso);

  it("says Today for a log written today", () => {
    const now = at("2026-08-31T18:00:00Z");
    expect(dayLabel(now.toISOString(), now)).toBe("Today");
  });

  it("says Yesterday for the day before", () => {
    const now = new Date("2026-08-31T12:00:00Z");
    const earlier = new Date(now);
    earlier.setDate(earlier.getDate() - 1);
    expect(dayLabel(earlier.toISOString(), now)).toBe("Yesterday");
  });

  it("gives a date for anything older", () => {
    const now = new Date("2026-08-31T12:00:00Z");
    const older = new Date(now);
    older.setDate(older.getDate() - 9);
    const label = dayLabel(older.toISOString(), now);
    expect(label).not.toBe("Today");
    expect(label).not.toBe("Yesterday");
    expect(label.length).toBeGreaterThan(0);
  });

  it("compares local days, not elapsed hours", () => {
    /*
     * The bug this prevents: two instants three hours apart can be different
     * calendar days, and two instants twenty hours apart can be the same one.
     * Subtracting timestamps gets both wrong.
     */
    const now = new Date(2026, 7, 31, 0, 30);
    const lastNight = new Date(2026, 7, 30, 23, 30);
    expect(dayLabel(lastNight.toISOString(), now)).toBe("Yesterday");

    const earlyToday = new Date(2026, 7, 31, 0, 5);
    expect(dayLabel(earlyToday.toISOString(), now)).toBe("Today");
  });

  it("returns an empty string rather than Invalid Date", () => {
    // `created_at` is a real column so this should not happen, but a label
    // reading "Invalid Date" on a technician's own record is not acceptable.
    expect(dayLabel("not a date")).toBe("");
    expect(dayLabel("")).toBe("");
  });
});

describe("localDay", () => {
  it("pads, so string comparison works", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("previewEntries", () => {
  const entries = ["a", "b", "c", "d", "e", "f"];

  it("shows a few and counts the rest", () => {
    const { shown, hidden } = previewEntries(entries, 4);
    expect(shown).toEqual(["a", "b", "c", "d"]);
    expect(hidden).toBe(2);
  });

  it("hides nothing when everything fits", () => {
    expect(previewEntries(["a"], 4)).toEqual({ shown: ["a"], hidden: 0 });
  });

  it("never reports a negative remainder", () => {
    expect(previewEntries([], 4).hidden).toBe(0);
  });

  it("keeps the count and the lines in step", () => {
    // Computing the two apart is how a card ends up saying "+2 more" while
    // showing a different number of bullets.
    for (const limit of [1, 3, 6, 10]) {
      const { shown, hidden } = previewEntries(entries, limit);
      expect(shown.length + hidden).toBe(entries.length);
    }
  });
});

describe("shouldShowLog", () => {
  it("draws nothing on a project that has never had one", () => {
    // A permanent "no daily log yet" box under every photo grid explains a
    // feature instead of being one.
    expect(shouldShowLog([], false)).toBe(false);
  });

  it("draws while a capture session is still uploading", () => {
    expect(shouldShowLog([], true)).toBe(true);
  });

  it("draws once there is a log", () => {
    expect(shouldShowLog([{}], false)).toBe(true);
  });
});

describe("photoCountLabel", () => {
  it("gets the singular right", () => {
    expect(photoCountLabel(1)).toBe("1 photo");
    expect(photoCountLabel(0)).toBe("0 photos");
    expect(photoCountLabel(9)).toBe("9 photos");
  });
});

describe("the phone and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/projects/daily-log.ts"), "utf8");

  it("sends the field names the schema reads", () => {
    const client = readFileSync(join(process.cwd(), "apps/mobile/src/api/daily-log.ts"), "utf8");
    const s = service();
    for (const field of ["projectId", "photoIds", "source", "tzOffsetMinutes"]) {
      expect(s, `server ${field}`).toContain(`${field}:`);
      expect(client, `client ${field}`).toContain(field);
    }
  });

  it("relies on an op the server registers as idempotent", () => {
    /*
     * Load-bearing on the phone in a way it is not on the web. The browser
     * calls this once, in the foreground. The phone calls it from a background
     * drain that retries whenever the last attempt did not visibly succeed,
     * which includes a response lost after the server had already written the
     * section. Without the key that retry appends the day twice.
     */
    const registry = readFileSync(
      join(process.cwd(), "apps/api/src/domains/rpc/registry.ts"),
      "utf8",
    );
    const at = registry.indexOf("autoDailyLog: authed(");
    expect(at).toBeGreaterThan(-1);
    expect(registry.slice(at, at + 400)).toContain("idempotent: true");

    const flush = readFileSync(
      join(process.cwd(), "apps/mobile/src/offline/capture-session.ts"),
      "utf8",
    );
    expect(flush).toContain("idempotencyKey");
  });

  it("collects the photo id at the only moment it exists", () => {
    // Before the upload lands there is no id; after the outbox row is deleted
    // there is nothing left to attach it to.
    const handlers = readFileSync(
      join(process.cwd(), "apps/mobile/src/offline/handlers.ts"),
      "utf8",
    );
    const completeAt = handlers.indexOf("completeSessionPhoto(row.id, uploaded.id)");
    const uploadAt = handlers.indexOf("const uploaded = await uploadProjectPhoto(");
    expect(uploadAt).toBeGreaterThan(-1);
    expect(completeAt).toBeGreaterThan(uploadAt);
  });

  it("writes sessions up only after the drain has finished a pass", () => {
    const sync = readFileSync(join(process.cwd(), "apps/mobile/src/offline/sync.ts"), "utf8");
    expect(sync).toContain("flushCaptureSessions()");
  });
});
