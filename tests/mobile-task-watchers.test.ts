import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  addableWatchers,
  addWarning,
  commentAuthor,
  sortedWatchers,
  watcherName,
  watcherSummary,
  type WatcherLike,
} from "../apps/mobile/src/api/task-watchers-view";

/*
 * Who else is told about a task.
 *
 * A watcher gets an email and a notification when the task moves, so this is a
 * rule about interrupting people.
 *
 * The file also covers `commentAuthor`, because the two share one correction.
 * `listTaskCollaboration` returns camelCase throughout and the phone was
 * reading snake_case:
 *
 *   comments   read as `author_id` / `created_at` against `authorId` /
 *              `createdAt`. Every comment in every thread rendered with a
 *              fallback author name and a BLANK timestamp, because
 *              `relativeTime(undefined)` returns "" rather than throwing.
 *
 *   watchers   typed `unknown[]` and dropped. The wrong field names cost
 *              nothing until the moment something tried to read them, which is
 *              why they survived: the bug was invisible while the feature was
 *              missing.
 */

const watcher = (over: Partial<WatcherLike>): WatcherLike => ({
  userId: "u-sam",
  fullName: "Sam Whitfield",
  email: "sam@site.test",
  avatarUrl: null,
  ...over,
});

describe("watcherName", () => {
  it("prefers a name, then an email, then a placeholder", () => {
    /*
     * The email fallback matters more here than elsewhere. The question this
     * list answers is "who is getting mailed about this", and an address
     * answers it where "Teammate" does not.
     */
    expect(watcherName(watcher({}))).toBe("Sam Whitfield");
    expect(watcherName(watcher({ fullName: null }))).toBe("sam@site.test");
    expect(watcherName(watcher({ fullName: "  ", email: null }))).toBe("Teammate");
  });
});

describe("commentAuthor", () => {
  it("reads the comment's own fields, not a roster lookup", () => {
    expect(commentAuthor({ authorName: "Sam", authorEmail: "s@x.test" })).toBe("Sam");
    expect(commentAuthor({ authorName: null, authorEmail: "s@x.test" })).toBe("s@x.test");
    expect(commentAuthor({ authorName: null, authorEmail: null })).toBe("Someone");
  });
});

describe("addableWatchers", () => {
  const roster = [
    { user_id: "u-sam", full_name: "Sam", email: null },
    { user_id: "u-alex", full_name: "Alex", email: null },
    { user_id: "u-me", full_name: "Me", email: null },
  ];

  it("hides anyone already watching", () => {
    // The server would accept it - the upsert ignores duplicates - but an
    // action that visibly does nothing is worse than one not offered.
    const out = addableWatchers(roster, [watcher({ userId: "u-sam" })], null);
    expect(out.map((c) => c.user_id)).toEqual(["u-alex", "u-me"]);
  });

  it("hides the caller", () => {
    expect(addableWatchers(roster, [], "u-me").map((c) => c.user_id)).toEqual(["u-sam", "u-alex"]);
  });

  it("offers everybody when nobody is watching", () => {
    expect(addableWatchers(roster, [], null)).toHaveLength(3);
  });

  it("returns the caller's own richer member type", () => {
    /*
     * Generic on purpose. Widening to the loose shape made the result fail to
     * satisfy the mention helpers it is handed on to, which is how this was
     * found - tsc, not a test.
     */
    const rich = [{ user_id: "u-sam", full_name: "Sam", email: null, extra: 1 }];
    const out = addableWatchers(rich, [], null);
    expect(out[0].extra).toBe(1);
  });
});

describe("watcherSummary", () => {
  it("says what watching means, not just how many", () => {
    /*
     * The count is already on the section heading. What somebody needs before
     * adding a colleague is that it emails them.
     */
    expect(watcherSummary([])).toContain("Nobody is being told");
    expect(watcherSummary([watcher({})])).toBe("Sam Whitfield is told when this task moves.");
    expect(
      watcherSummary([watcher({}), watcher({ userId: "u-alex", fullName: "Alex Doyle" })]),
    ).toBe("Sam Whitfield and Alex Doyle are told when this task moves.");
  });

  it("counts the remainder past two", () => {
    const many = ["a", "b", "c", "d"].map((id) =>
      watcher({ userId: id, fullName: id.toUpperCase() }),
    );
    expect(watcherSummary(many)).toBe("A, B and 2 more are told when this task moves.");
  });
});

describe("addWarning", () => {
  it("names one person, counts several", () => {
    expect(addWarning(["Sam"])).toBe("Sam will be emailed when this task changes.");
    expect(addWarning(["Sam", "Alex"])).toBe("2 people will be emailed when this task changes.");
  });
});

describe("sortedWatchers", () => {
  it("is alphabetical, because the list is scanned for a name", () => {
    const rows = [
      watcher({ userId: "1", fullName: "Zoe" }),
      watcher({ userId: "2", fullName: "Alex" }),
    ];
    expect(sortedWatchers(rows).map((w) => w.fullName)).toEqual(["Alex", "Zoe"]);
  });

  it("does not mutate what it was given", () => {
    const rows = [
      watcher({ userId: "1", fullName: "Zoe" }),
      watcher({ userId: "2", fullName: "Alex" }),
    ];
    sortedWatchers(rows);
    expect(rows.map((w) => w.fullName)).toEqual(["Zoe", "Alex"]);
  });
});

describe("the phone reads the field names the service sends", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/tasks/service.ts"), "utf8");
  const client = () =>
    readFileSync(join(process.cwd(), "apps/mobile/src/api/task-comments.ts"), "utf8");
  const screen = () =>
    readFileSync(join(process.cwd(), "apps/mobile/app/(app)/task/[id].tsx"), "utf8");

  it("declares comments in the camelCase the service returns", () => {
    /*
     * The regression this file exists for. `comment.author_id` on a payload
     * carrying `authorId` is `undefined`, not an error, and
     * `relativeTime(undefined)` is "" rather than a throw, so the thread looked
     * merely unstyled rather than broken.
     */
    const s = service();
    for (const field of ["authorId:", "authorName:", "createdAt:", "authorAvatarUrl:"]) {
      expect(s, `service ${field}`).toContain(field);
    }
    const c = client();
    expect(c).toContain("authorId:");
    expect(c).toContain("createdAt:");
    expect(c).not.toMatch(/^\s*author_id:/m);
    expect(c).not.toMatch(/^\s*created_at:/m);
  });

  it("declares watchers in camelCase too", () => {
    expect(service()).toContain("userId: w.user_id");
    const c = client();
    expect(c).toContain("userId:");
    expect(c).not.toMatch(/^\s*user_id\??:/m);
  });

  it("no longer reads a comment author out of the roster", () => {
    /*
     * A lookup fails outright for anybody who has left the team, which is
     * exactly whose old comments sit in a long thread. The service already
     * joins `profiles` and sends the name.
     */
    const s = screen();
    expect(s).toContain("commentAuthor(comment)");
    expect(s).not.toContain("byId.get(comment.author");
  });

  it("sends the web origin for the emails, not the API host", () => {
    /*
     * `addTaskWatchers` mails everybody it adds, and the link in that mail must
     * point at the web app. The two hosts have been confused once already and
     * it was a total outage.
     */
    const c = client();
    expect(c).toContain("webAppUrl");
    expect(service()).toContain("origin: z.string().url().optional()");
  });
});
