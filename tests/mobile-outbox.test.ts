import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The offline outbox, exercised against real SQLite.
 *
 * `expo-sqlite` is native and cannot load here, so it is replaced with a thin
 * adapter over Node's built-in `node:sqlite`. The point is that the SQL under
 * test is the app's own, unmodified: the claim, the backoff arithmetic, and the
 * per-project exclusion are the parts that decide whether a photo is delivered
 * once, twice, or not at all, and re-implementing them in a fake would test the
 * fake instead.
 */

let db: DatabaseSync;

/*
 * `expo-sqlite` and `expo-crypto` are swapped for the doubles in
 * `tests/doubles/` by `resolve.alias` in vitest.config.ts. The SQLite double
 * runs this database, so the SQL exercised below is the app's own.
 */
const discardCapture = vi.fn();
vi.mock("../apps/mobile/src/offline/media", () => ({
  discardCapture: (...args: unknown[]) => discardCapture(...args),
  sweepOrphans: () => 0,
}));

type OutboxModule = typeof import("../apps/mobile/src/offline/outbox");
let outbox: OutboxModule;

beforeEach(async () => {
  db = new DatabaseSync(":memory:");
  discardCapture.mockClear();

  /*
   * Reset first, then hand the double its database.
   *
   * `db.ts` caches the open connection at module scope, so each test needs a
   * fresh module graph or it keeps talking to the previous test's database.
   * The reset also discards the double, which is why `__useDatabase` is called
   * on the instance imported afterwards: setting it on the pre-reset copy would
   * leave the instance the app actually imports holding nothing.
   */
  vi.resetModules();
  const sqlite = await import("./doubles/expo-sqlite");
  sqlite.__useDatabase(db);
  const crypto = await import("./doubles/expo-crypto");
  crypto.__resetIds();

  outbox = await import("../apps/mobile/src/offline/outbox");
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

async function enqueuePhoto(projectId: string | null, id?: string) {
  return outbox.enqueue({
    kind: "photo_upload",
    projectId,
    localUri: `file:///outbox/${id ?? "x"}.jpg`,
    payload: { projectId },
    id,
  });
}

describe("outbox queueing", () => {
  it("stores a row and counts it as outstanding", async () => {
    await enqueuePhoto("project-a", "row-1");
    const counts = await outbox.counts();
    expect(counts.pending).toBe(1);
    expect(counts.outstanding).toBe(1);
    expect(counts.failed).toBe(0);
  });

  it("enqueuing the same id twice does not duplicate the row", async () => {
    // The capture screen mints the id, copies the file, then enqueues. A retry
    // of that sequence after a crash must not queue the photo a second time.
    await enqueuePhoto("project-a", "row-1");
    await enqueuePhoto("project-a", "row-1");
    expect((await outbox.counts()).pending).toBe(1);
  });
});

describe("claiming", () => {
  it("marks the claimed row as sending", async () => {
    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    expect(row?.id).toBe("row-1");
    expect(row?.state).toBe("sending");
    expect((await outbox.counts()).sending).toBe(1);
  });

  it("never hands the same row to two drain passes", async () => {
    /*
     * The failure this prevents: a reconnect fires while a foreground event is
     * already draining, both loops claim the head row, and the photo uploads
     * twice. The claim flips state in the same statement that selects it, so
     * the loser gets nothing.
     */
    await enqueuePhoto("project-a", "row-1");
    const [first, second] = await Promise.all([outbox.claimNext(), outbox.claimNext()]);
    const claimed = [first, second].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it("returns null when nothing is due", async () => {
    expect(await outbox.claimNext()).toBeNull();
  });

  it("skips projects the caller has parked", async () => {
    /*
     * One stuck job must not block another. After a failure the drain parks
     * that project for the rest of the pass and moves on.
     */
    await enqueuePhoto("project-a", "row-a");
    await enqueuePhoto("project-b", "row-b");

    const row = await outbox.claimNext(["project-a"]);
    expect(row?.id).toBe("row-b");
  });

  it("parks rows with no project under one lane", async () => {
    await outbox.enqueue({ kind: "photo_upload", payload: {}, id: "row-null", projectId: null });
    expect(await outbox.claimNext([""])).toBeNull();
  });

  it("hands out the oldest row first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T09:00:00Z"));
    await enqueuePhoto("project-a", "older");
    vi.setSystemTime(new Date("2026-03-14T10:00:00Z"));
    await enqueuePhoto("project-a", "newer");

    expect((await outbox.claimNext())?.id).toBe("older");
  });
});

describe("failure handling", () => {
  it("schedules a retry instead of dropping the row", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T09:00:00Z"));

    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    await outbox.markFailed(row!, "Network request failed");

    // Back to pending, but not due yet, so an immediate re-drain leaves it be
    // rather than hammering a connection that is still down.
    expect((await outbox.counts()).pending).toBe(1);
    expect(await outbox.claimNext()).toBeNull();

    vi.setSystemTime(new Date("2026-03-14T09:00:06Z"));
    expect((await outbox.claimNext())?.id).toBe("row-1");
  });

  it("backs off further on each successive failure", async () => {
    vi.useFakeTimers();
    const start = new Date("2026-03-14T09:00:00Z");
    vi.setSystemTime(start);

    await enqueuePhoto("project-a", "row-1");

    let row = await outbox.claimNext();
    await outbox.markFailed(row!, "boom");
    const afterFirst = db.prepare("SELECT next_attempt FROM outbox WHERE id = 'row-1'").get() as {
      next_attempt: number;
    };

    vi.setSystemTime(new Date(afterFirst.next_attempt));
    row = await outbox.claimNext();
    await outbox.markFailed(row!, "boom");
    const afterSecond = db.prepare("SELECT next_attempt FROM outbox WHERE id = 'row-1'").get() as {
      next_attempt: number;
    };

    const firstGap = afterFirst.next_attempt - start.getTime();
    const secondGap = afterSecond.next_attempt - afterFirst.next_attempt;
    expect(secondGap).toBeGreaterThan(firstGap);
  });

  it("gives up after the attempt limit rather than retrying forever", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T09:00:00Z"));
    await enqueuePhoto("project-a", "row-1");

    for (let i = 0; i < outbox.MAX_ATTEMPTS; i += 1) {
      // Jump past whatever backoff was just scheduled.
      vi.setSystemTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
      const row = await outbox.claimNext();
      expect(row, `row should still be claimable on attempt ${i + 1}`).not.toBeNull();
      await outbox.markFailed(row!, "boom");
    }

    const counts = await outbox.counts();
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(0);
    // Failed rows wait for the user, not for another automatic pass.
    expect(await outbox.claimNext()).toBeNull();
  });

  it("fails a permanent error immediately", async () => {
    // A row-level security refusal will refuse identically in an hour. Retrying
    // it just buries the real reason under a queue that never empties.
    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    await outbox.markFailed(row!, "new row violates row-level security policy", true);

    const counts = await outbox.counts();
    expect(counts.failed).toBe(1);
    expect(counts.pending).toBe(0);
  });

  it("keeps the error message for the queue screen", async () => {
    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    await outbox.markFailed(row!, "Storage quota exceeded", true);

    const rows = await outbox.listRows();
    expect(rows[0].last_error).toContain("Storage quota exceeded");
  });
});

describe("crash recovery", () => {
  it("returns interrupted rows to the queue", async () => {
    /*
     * The app being killed mid-upload is normal: the OS reclaims a backgrounded
     * app whenever it wants memory. Without this the row sits in `sending`
     * forever, invisible to the drain and stuck in the banner's count, and the
     * photo is never delivered.
     */
    await enqueuePhoto("project-a", "row-1");
    await outbox.claimNext();
    expect((await outbox.counts()).sending).toBe(1);

    const recovered = await outbox.recoverInterrupted();

    expect(recovered).toBe(1);
    const counts = await outbox.counts();
    expect(counts.sending).toBe(0);
    expect(counts.pending).toBe(1);
  });

  it("leaves failed rows alone during recovery", async () => {
    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    await outbox.markFailed(row!, "nope", true);

    await outbox.recoverInterrupted();

    expect((await outbox.counts()).failed).toBe(1);
  });
});

describe("user actions", () => {
  it("retrying clears the failure and makes the row due now", async () => {
    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    await outbox.markFailed(row!, "nope", true);

    await outbox.retryFailed();

    const claimed = await outbox.claimNext();
    expect(claimed?.id).toBe("row-1");
    expect(claimed?.attempts).toBe(0);
    expect(claimed?.last_error).toBeNull();
  });

  it("discarding removes the row and releases its file", async () => {
    await enqueuePhoto("project-a", "row-1");
    await outbox.discard("row-1");

    expect((await outbox.counts()).outstanding).toBe(0);
    expect(discardCapture).toHaveBeenCalledWith("file:///outbox/row-1.jpg");
  });

  it("completing a row releases its file", async () => {
    await enqueuePhoto("project-a", "row-1");
    const row = await outbox.claimNext();
    await outbox.markDone(row!);

    expect((await outbox.counts()).outstanding).toBe(0);
    expect(discardCapture).toHaveBeenCalledWith("file:///outbox/row-1.jpg");
  });
});

describe("a full offline session", () => {
  it("delivers every capture exactly once after a reconnect", async () => {
    /*
     * The plan's acceptance test: twenty photos taken in airplane mode, then
     * signal returns. Every row drains, none is delivered twice, and the queue
     * ends empty.
     */
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-14T09:00:00Z"));

    for (let i = 0; i < 20; i += 1) {
      vi.setSystemTime(new Date(Date.now() + 1000));
      await enqueuePhoto("project-a", `row-${i}`);
    }
    expect((await outbox.counts()).outstanding).toBe(20);

    const delivered: string[] = [];
    for (;;) {
      const row = await outbox.claimNext();
      if (!row) break;
      delivered.push(row.id);
      await outbox.markDone(row);
    }

    expect(delivered).toHaveLength(20);
    expect(new Set(delivered).size).toBe(20);
    expect((await outbox.counts()).outstanding).toBe(0);
  });
});
