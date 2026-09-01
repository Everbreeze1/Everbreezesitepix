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
