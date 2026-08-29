import { describe, expect, it } from "vitest";
import {
  defaultSiteLogTitle,
  mergeDescriptions,
  noteFor,
  openTodoCount,
  photoIdsOf,
  pruneNotes,
  siteLogSummary,
  withNoteText,
  withTodoAdded,
  withTodoRemoved,
  withTodoToggled,
  type PhotoNote,
  type SiteLogRow,
} from "../apps/mobile/src/api/site-log-notes";

/*
 * The site log document.
 *
 * The rule worth guarding here is the merge: what happens when the model's
 * descriptions arrive and somebody has already typed something. Getting it
 * backwards silently destroys work, at the exact moment the person was trying
 * to save themselves time.
 */

const log = (over: Partial<SiteLogRow> = {}): SiteLogRow => ({
  id: "l1",
  project_id: "p1",
  title: "Site log",
  photo_ids: ["a", "b"],
  notes: {},
  created_at: "2026-08-29T09:00:00.000Z",
  updated_at: "2026-08-29T09:00:00.000Z",
  ...over,
});

describe("noteFor", () => {
  it("returns an empty note for a photo nobody wrote about", () => {
    expect(noteFor({}, "a")).toEqual({ notes: "", todos: [] });
    expect(noteFor(null, "a")).toEqual({ notes: "", todos: [] });
  });

  it("repairs a row written by an older client", () => {
    /*
     * `notes` is jsonb written by two clients across a year of schema changes.
     * A missing key, a null, and a `todos` that is not an array all occur, and
     * each one crashes a `.map` at render time.
     */
    const broken = { a: { notes: null, todos: null } } as unknown as Record<string, PhotoNote>;
    expect(noteFor(broken, "a")).toEqual({ notes: "", todos: [] });

    const partly = { a: { notes: "Real", todos: [{ id: "1", text: "Do it", done: false }, null] } };
    expect(noteFor(partly as never, "a").todos).toHaveLength(1);
  });
});

describe("photoIdsOf", () => {
  it("survives a null or malformed column", () => {
    expect(photoIdsOf({ photo_ids: null })).toEqual([]);
    expect(photoIdsOf({ photo_ids: ["a", null, "b"] as never })).toEqual(["a", "b"]);
  });
});

describe("mergeDescriptions", () => {
  it("never overwrites something somebody typed", () => {
    /*
     * The whole reason this is a function rather than an object spread at the
     * call site. A spread in the wrong order is a one-character difference that
     * destroys work.
     */
    const current = { a: { notes: "Cracked lintel, north wall", todos: [] } };
    const merged = mergeDescriptions(current, { a: "A wall.", b: "A pipe." }, ["a", "b"]);

    expect(merged.a.notes).toBe("Cracked lintel, north wall");
    expect(merged.b.notes).toBe("A pipe.");
  });

  it("fills a note that is only whitespace", () => {
    const merged = mergeDescriptions({ a: { notes: "   ", todos: [] } }, { a: "A wall." }, ["a"]);
    expect(merged.a.notes).toBe("A wall.");
  });

  it("keeps every to-do untouched", () => {
    // To-dos are decisions somebody made. The model is not asked about them and
    // must not be able to affect them.
    const current = { a: { notes: "", todos: [{ id: "1", text: "Reseal", done: true }] } };
    expect(mergeDescriptions(current, { a: "A wall." }, ["a"]).a.todos).toEqual(current.a.todos);
  });

  it("covers every photo, including ones the model said nothing about", () => {
    const merged = mergeDescriptions({}, {}, ["a", "b"]);
    expect(Object.keys(merged)).toEqual(["a", "b"]);
    expect(merged.a).toEqual({ notes: "", todos: [] });
  });

  it("ignores descriptions for photos no longer in the log", () => {
    const merged = mergeDescriptions({}, { a: "A wall.", gone: "Stale." }, ["a"]);
    expect(Object.keys(merged)).toEqual(["a"]);
  });
});

describe("pruneNotes", () => {
  it("drops notes for photos that were removed", () => {
    // Otherwise removing a photo and adding it back resurrects a note somebody
    // deleted, and the jsonb grows forever on a log that gets edited often.
    const notes = {
      a: { notes: "Kept", todos: [] },
      gone: { notes: "Dropped", todos: [] },
    };
    expect(Object.keys(pruneNotes(notes, ["a"]))).toEqual(["a"]);
  });
});

describe("editing notes and to-dos", () => {
  it("sets the text without disturbing the to-dos", () => {
    const notes = { a: { notes: "old", todos: [{ id: "1", text: "Reseal", done: false }] } };
    const next = withNoteText(notes, "a", "new");
    expect(next.a.notes).toBe("new");
    expect(next.a.todos).toHaveLength(1);
  });

  it("adds, toggles and removes a to-do", () => {
    let notes: Record<string, PhotoNote> = {};
    notes = withTodoAdded(notes, "a", "Reseal the joint", "t1");
    expect(notes.a.todos).toEqual([{ id: "t1", text: "Reseal the joint", done: false }]);

    notes = withTodoToggled(notes, "a", "t1");
    expect(notes.a.todos[0].done).toBe(true);

    notes = withTodoRemoved(notes, "a", "t1");
    expect(notes.a.todos).toEqual([]);
  });

  it("refuses an empty to-do", () => {
    // A row that cannot be read and cannot be ticked off. Same rule the
    // annotation editor applies to a zero-length stroke.
    expect(withTodoAdded({}, "a", "   ", "t1")).toEqual({});
  });

  it("trims a to-do rather than storing the padding", () => {
    expect(withTodoAdded({}, "a", "  Reseal  ", "t1").a.todos[0].text).toBe("Reseal");
  });

  it("does not mutate what it was given", () => {
    const notes = { a: { notes: "old", todos: [] } };
    withNoteText(notes, "a", "new");
    expect(notes.a.notes).toBe("old");
  });
});

describe("defaultSiteLogTitle", () => {
  it("dates the log from local parts, not UTC", () => {
    /*
     * `toISOString` on a log made at 9pm names it after the following day,
     * which is the day the crew was not on site.
     */
    expect(defaultSiteLogTitle(new Date(2026, 7, 29, 21, 30))).toBe("Site log 2026-08-29");
  });

  it("pads single digits", () => {
    expect(defaultSiteLogTitle(new Date(2026, 0, 4))).toBe("Site log 2026-01-04");
  });
});

describe("siteLogSummary", () => {
  it("counts photos, written notes and to-dos", () => {
    const row = log({
      photo_ids: ["a", "b", "c"],
      notes: {
        a: { notes: "Cracked", todos: [{ id: "1", text: "Fix", done: false }] },
        b: { notes: "  ", todos: [] },
      },
    });
    expect(siteLogSummary(row)).toBe("3 photos · 1 noted · 1 to do");
  });

  it("says only what there is", () => {
    expect(siteLogSummary(log({ photo_ids: ["a"], notes: {} }))).toBe("1 photo");
    expect(siteLogSummary(log({ photo_ids: [], notes: {} }))).toBe("0 photos");
  });

  it("ignores notes for photos no longer on the log", () => {
    // A log whose photos were later deleted should not claim a note against
    // one that is gone.
    const row = log({ photo_ids: ["a"], notes: { gone: { notes: "Stale", todos: [] } } });
    expect(siteLogSummary(row)).toBe("1 photo");
  });
});

describe("openTodoCount", () => {
  it("counts only what is still open", () => {
    const row = log({
      photo_ids: ["a", "b"],
      notes: {
        a: {
          notes: "",
          todos: [
            { id: "1", text: "Done", done: true },
            { id: "2", text: "Open", done: false },
          ],
        },
        b: { notes: "", todos: [{ id: "3", text: "Open", done: false }] },
      },
    });
    expect(openTodoCount(row)).toBe(2);
  });

  it("is zero on an empty log", () => {
    expect(openTodoCount(log({ photo_ids: [], notes: {} }))).toBe(0);
  });
});
