import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readsAsDatabaseInternals } from "../apps/api/src/lib/errors";

/*
 * The floor under raw database messages reaching customers.
 *
 * `jsonFromUnknownError` forwards the message of any error carrying no status,
 * and 101 services across 32 files do `throw new Error(error.message)` with a
 * PostgrestError in hand. So Postgres's own words went to the phone. Found by
 * screenshotting the comment composer, which showed:
 *
 *     new row violates row-level security policy for table "photo_comments"
 *
 * The per-domain mapping (`photoCommentErrorMessage`) is still the real fix,
 * because it can say something the reader can act on. This only guarantees that
 * what leaks instead is a sentence rather than a schema.
 */

describe("what counts as the database talking", () => {
  const INTERNALS = [
    'new row violates row-level security policy for table "photo_comments"',
    'insert or update on table "task_photo_items" violates foreign key constraint "task_photo_items_photo_id_fkey"',
    'relation "public.feedback" does not exist',
    'column "message" does not exist',
    'invalid input syntax for type uuid: "nope"',
    'duplicate key value violates unique constraint "photos_pkey"',
    "permission denied for table device_push_tokens",
    'null value in column "project_id" violates not-null constraint',
    "42501: permission denied",
    "PGRST205: could not find the table",
  ];

  it("recognises every shape seen in this repo", () => {
    for (const message of INTERNALS) {
      expect(readsAsDatabaseInternals(message), message).toBe(true);
    }
  });
});

describe("prose written for a person still gets through", () => {
  /*
   * The half that matters most. An allow-list here would have been safer
   * against leaks and would have collapsed every one of these to a generic
   * line, which trades one leak for a hundred regressions. These are real
   * messages from the services, and a customer needs to read them.
   */
  const HUMAN = [
    "Choose at least one project for this subcontractor.",
    "You own a workspace that other people are still working in.",
    "That firm has already been invited.",
    "The email does not match this account.",
    "That photo is no longer part of this task. Reload and try again.",
    "Only the assignee, the person who assigned it, or a manager can mark this photo done.",
    "You do not have access to comment on this job. Ask whoever owns it to share it with you.",
    "This workspace is on the Free plan. Upgrade to invite more people.",
  ];

  it("passes ordinary sentences untouched", () => {
    for (const message of HUMAN) {
      expect(readsAsDatabaseInternals(message), message).toBe(false);
    }
  });

  it("does not trip on the word 'table' or 'column' in ordinary copy", () => {
    // The patterns are anchored on Postgres's own phrasing, not on vocabulary.
    expect(readsAsDatabaseInternals("Add a table to this page on the web.")).toBe(false);
    expect(readsAsDatabaseInternals("That column of photos is empty.")).toBe(false);
    expect(readsAsDatabaseInternals("Your security settings were saved.")).toBe(false);
  });
});

describe("the phone applies the same rule as the server", () => {
  const state = () => readFileSync(join(process.cwd(), "apps/mobile/src/ui/State.tsx"), "utf8");

  it("ErrorState swaps schema text and nothing else", () => {
    /*
     * 67 places in the app throw a Supabase `error.message` straight to the UI,
     * and none of them cross the API, so the server-side floor cannot catch
     * them. `ErrorState` is where most of them render.
     */
    const s = state();
    expect(s).toContain("readsAsDatabaseInternals(message)");
    expect(s).toContain("The server refused that");
  });

  it("keeps rendering the real message when it is readable", () => {
    /*
     * The half that must not regress. The component's own note says the real
     * text is deliberate: a field app that says "Something went wrong" gives
     * the person holding it nothing to act on. "Network request failed" has to
     * survive, or this fix has broken the thing it was protecting.
     */
    const s = state();
    expect(s).toMatch(/: message;/);
    expect(s).not.toMatch(/const readable = "Something went wrong"/);
  });

  it("both sides import one predicate rather than each keeping a copy", () => {
    // Two lists of Postgres phrasings would drift, and the drift would be
    // silent: the phone would leak a shape the server had already learned.
    expect(state()).toContain('from "@everlumen/shared"');
    expect(readFileSync(join(process.cwd(), "apps/api/src/lib/errors.ts"), "utf8")).toContain(
      'from "@everlumen/shared"',
    );
  });
});
