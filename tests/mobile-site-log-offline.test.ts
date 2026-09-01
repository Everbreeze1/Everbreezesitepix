import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A site log has to survive a basement.
 *
 * It is the technician's own record of a day - a photograph, what was done to
 * it, and what is still outstanding - and it is written ON the job, which is
 * exactly where there is no signal. It was going straight to the server: with
 * the radio off the write failed, the screen said "that did not save", and the
 * day's notes existed only in React state until somebody navigated away.
 *
 * That was never a decision. The module's own header says the rows are
 * "ordinary RLS reads and writes ... which is what the web app does", and on the
 * web an unreachable server is a broken page rather than a normal Tuesday.
 *
 * These assertions are structural on purpose. The behaviour they protect only
 * appears with the radio actually off, which no unit test can arrange - so what
 * is pinned is that the write goes through the queue at all.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("site log edits are queued, not sent", () => {
  const screen = () => read("apps/mobile/app/(app)/site-log/[logId].tsx");
  const handlers = () => read("apps/mobile/src/offline/handlers.ts");
  const outbox = () => read("apps/mobile/src/offline/outbox.ts");

  it("the queue knows the kind", () => {
    expect(outbox()).toContain('| "site_log_patch"');
  });

  it("the drain has a handler for it", () => {
    const h = handlers();
    expect(h).toContain("site_log_patch: async (row)");
    expect(h).toContain("saveSiteLog(payload.logId");
  });

  it("the screen enqueues rather than calling the server", () => {
    /*
     * The regression this exists for. A `saveSiteLog` import back on this
     * screen means somebody has restored the direct write, and it will look
     * perfectly fine on a desk.
     */
    const s = screen();
    expect(s).toContain('kind: "site_log_patch"');
    expect(s).toContain("enqueue(");
    expect(s).not.toMatch(/import \{[^}]*\bsaveSiteLog\b/);
  });

  it("keys the row per field, so two edits do not overwrite each other", () => {
    /*
     * Same rule as the project patch: a row id that ignored the field would let
     * a retyped title replace a queued note, and the note would be lost with no
     * error anywhere - the worst shape of offline bug, because the phone
     * reports success.
     */
    expect(handlers()).toContain("siteLogPatchRowId(field: string, logId: string)");
    expect(handlers()).toContain("`site-log-patch:${field}:${logId}`");

    const s = screen();
    for (const field of ['"title"', '"notes"', '"photos"']) {
      expect(s, field).toContain(`save(${field}`);
    }
  });

  it("carries the whole value, which is what makes a replay safe", () => {
    /*
     * The outbox retries. A patch carrying a delta would compound on the second
     * attempt; one carrying the whole `notes` object lands on the same content
     * however many times it runs.
     */
    const s = screen();
    expect(s).toContain("{ notes: next }");
    expect(s).toContain("{ photo_ids: next, notes: pruned }");
    expect(handlers()).toContain("the patch carries the whole value");
  });

  it("still reports a failure to QUEUE, which is a real one", () => {
    // Failing to reach the server is now normal and handled. Failing to write
    // the local row means the note is genuinely not kept, and must be said.
    expect(screen()).toContain("That could not be saved.");
  });
});

/*
 * The same question, asked of the other two writes that happen on a job.
 *
 * Ticking a photograph off a task and marking one up are both done standing in
 * front of the thing, and both went straight to the server.
 */

describe("ticking a task photo is queued", () => {
  const handlers = () => read("apps/mobile/src/offline/handlers.ts");
  const screen = () => read("apps/mobile/app/(app)/task/[id].tsx");

  it("has a kind and a handler", () => {
    expect(read("apps/mobile/src/offline/outbox.ts")).toContain('| "task_photo_patch"');
    expect(handlers()).toContain("task_photo_patch: async (row)");
  });

  it("is keyed per photo per task, so a tick and an untick cannot race", () => {
    // Toggling the same photo twice replaces its own row, so the last state
    // the person chose is the one that lands.
    expect(handlers()).toContain("`task-photo:${taskId}:${photoId}`");
    expect(screen()).toContain("taskPhotoRowId(id!, photoId)");
  });

  it("no longer writes straight to the server", () => {
    expect(screen()).not.toMatch(/import \{[^}]*setTaskPhotoStatus/);
  });

  it("relies on an upsert, which is what makes a replay safe", () => {
    /*
     * The write is an upsert on `(task_id, photo_id)` carrying the whole row,
     * so the queue can deliver it twice without compounding. `completed_at`
     * and `completed_by` are stamped by a trigger and never sent, which is also
     * what keeps a LATE delivery honest: the timestamp is when the server
     * recorded it, not when the phone guessed.
     */
    const api = read("apps/mobile/src/api/task-photos.ts");
    expect(api).toContain('onConflict: "task_id,photo_id"');
    expect(api).toContain("stamped by the trigger");
  });
});

describe("saving an annotated photo is queued", () => {
  const api = () => read("apps/mobile/src/api/photo-annotations.ts");

  it("hands off to the same photo_upload the camera uses", () => {
    /*
     * Rather than a new kind. The annotated copy is a photograph: it wants the
     * same durable local file, the same thumbnail rules and the same row shape,
     * and reusing the tested path is why this needed no new handler.
     */
    const s = api();
    expect(s).toContain('kind: "photo_upload"');
    expect(s).toContain("persistCapture(encoded.uri, outboxId)");
  });

  it("no longer uploads or inserts inline", () => {
    /*
     * The regression this guards. Marking up a defect is done standing in
     * front of it, and the old path needed signal for all three of upload,
     * thumbnail and insert.
     */
    /*
     * Plain string checks rather than multi-line regexes, which prettier
     * reflows and which then stop matching without anybody noticing - a test
     * that quietly passes on a regression is worse than no test.
     */
    const s = api().replace(/\s+/g, " ");
    expect(s).not.toContain('.from("site-photos") .upload(');
    expect(s).not.toContain('.from("photos") .insert(');
    // The one upload that remains is the queue's, in the handler.
    expect(s).toContain("enqueue(");
  });

  it("stops promising an id it cannot know", () => {
    // The row does not exist until the queue delivers it. Returning a
    // fabricated id would be worse than returning none.
    expect(api()).toContain("Promise<{ queued: true }>");
  });
});

describe("a half-typed title is not lost on the way out", () => {
  /*
   * Found on the phone: rename a site log, tap the header back arrow, and the
   * rename was gone. No error, no hint - the list simply still showed the old
   * name.
   *
   * The field writes `onBlur`, which is the right trigger: a write per
   * keystroke is a write per keystroke on a connection that may be one bar. But
   * the back button unmounts the screen without ever blurring the input, so the
   * commit never ran.
   *
   * The shape of it is what makes it worth a guard. This edit goes through the
   * outbox specifically so it survives having no signal on site - and it was
   * being thrown away by a back tap on a working connection.
   *
   * Verified on a device before and after: typing then tapping back left the
   * database on the previous title, and now leaves it on the typed one.
   */
  const screen = () =>
    readFileSync(join(process.cwd(), "apps/mobile/app/(app)/site-log/[logId].tsx"), "utf8");

  it("commits a pending title when the screen unmounts", () => {
    const s = screen();
    expect(s).toContain("titleRef");
    expect(s).toContain("savedTitleRef");
    // A cleanup that returns from an effect with no deps: runs once, on unmount.
    expect(s).toMatch(/useEffect\(\(\) => \{\s*return \(\) => \{/);
  });

  it("writes nothing when the title was never touched", () => {
    /*
     * The guard that keeps this from queueing on every screen exit. Without it
     * merely opening a log and leaving would enqueue a write, which on a phone
     * that opens twenty logs a day is twenty pointless rows.
     */
    expect(screen()).toContain("if (pending === savedTitleRef.current) return;");
  });

  it("still saves on blur, which is the ordinary path", () => {
    // The unmount commit is a backstop, not a replacement. Losing the blur save
    // would move every write to screen-exit and lose it on a crash.
    expect(screen()).toMatch(/onBlur=\{/);
    expect(screen()).toContain('save("title"');
  });

  it("reads the live value rather than a stale closure", () => {
    /*
     * The reason a ref exists at all: an unmount effect with no deps closes over
     * the title as it was on first render, which is "". Committing that would
     * rename every log to "Site log" on the way out - a worse bug than the one
     * being fixed.
     */
    const s = screen();
    expect(s).toContain("titleRef.current.trim()");
    expect(s).not.toMatch(/return \(\) => \{[\s\S]{0,200}title\.trim\(\)/);
  });
});
