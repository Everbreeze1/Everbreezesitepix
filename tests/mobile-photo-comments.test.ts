import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  authorLabel,
  bodySegments,
  canDeleteComment,
  commentError,
  commentsSummary,
  MAX_COMMENT_LENGTH,
  mentionCandidates,
  mentionHandle,
  mentionQuery,
  mentionsInBody,
  withMention,
  type Mentionable,
} from "../apps/mobile/src/api/photo-comments-view";

/*
 * Commenting on a photograph.
 *
 * Most of these are ordinary text rules, but two of them decide who gets a push
 * notification, and those are the reason this file is thorough. A mention that
 * fires wrongly interrupts a colleague about a photo that does not mention them;
 * one that fails silently leaves a question nobody knows was asked. Neither is
 * visible to the person who wrote the comment, so neither would ever be
 * reported as a bug.
 */

const SAM: Mentionable = { userId: "u-sam", fullName: "Sam Whitfield", email: "sam@site.test" };
const SAMIRA: Mentionable = { userId: "u-samira", fullName: "Samira Khan", email: "sk@site.test" };
const NO_NAME: Mentionable = { userId: "u-anon", fullName: null, email: "dispatch@site.test" };
const NOTHING: Mentionable = { userId: "u-void", fullName: null, email: null };

describe("mentionHandle", () => {
  it("is the first name, so it can be typed and read inline", () => {
    expect(mentionHandle(SAM)).toBe("Sam");
  });

  it("falls back to the email local part, then to a word that is not blank", () => {
    expect(mentionHandle(NO_NAME)).toBe("dispatch");
    expect(mentionHandle(NOTHING)).toBe("teammate");
  });

  it("keeps accents and apostrophes, because those are names", () => {
    /*
     * `\w` is ASCII. Using it would cut "Jiménez" at the accent, and the handle
     * inserted into the text would then not match the handle looked for at send
     * time, so the mention would silently notify nobody.
     */
    expect(mentionHandle({ userId: "u1", fullName: "José Álvarez", email: null })).toBe("José");
    expect(mentionHandle({ userId: "u2", fullName: "Siobhán O'Brien", email: null })).toBe(
      "Siobhán",
    );
    expect(mentionHandle({ userId: "u3", fullName: "Anne-Marie Roux", email: null })).toBe(
      "Anne-Marie",
    );
  });

  it("strips anything a handle could not contain", () => {
    // Otherwise the inserted text and the search pattern disagree.
    expect(mentionHandle({ userId: "u4", fullName: "(Dave)", email: null })).toBe("Dave");
    expect(mentionHandle({ userId: "u5", fullName: "!!!", email: "ops@site.test" })).toBe("ops");
  });
});

describe("mentionQuery", () => {
  it("finds the handle being typed at the caret", () => {
    expect(mentionQuery("look at @sa", 11)).toBe("sa");
    expect(mentionQuery("@sa", 3)).toBe("sa");
  });

  it("returns an empty string for a bare @, which is not the same as null", () => {
    // Empty opens the picker showing everybody; null closes it.
    expect(mentionQuery("hello @", 7)).toBe("");
    expect(mentionQuery("hello ", 6)).toBeNull();
  });

  it("ignores an @ that is not at the caret", () => {
    // The caret is at the start, so nothing is being typed yet.
    expect(mentionQuery("@sam and more", 0)).toBeNull();
    // Caret after "more": the handle is finished and no longer being edited.
    expect(mentionQuery("@sam and more", 13)).toBeNull();
  });

  it("does not treat an email address as a mention", () => {
    // No whitespace before the @, so this is sam@site, not a handle.
    expect(mentionQuery("write to sam@site", 17)).toBeNull();
  });

  it("survives a caret out of range", () => {
    expect(mentionQuery("@sam", 999)).toBe("sam");
    expect(mentionQuery("@sam", -5)).toBeNull();
  });
});

describe("mentionCandidates", () => {
  const people = [SAM, SAMIRA, NO_NAME];

  it("shows nobody when no handle is being typed", () => {
    expect(mentionCandidates(people, null, "u-me")).toEqual([]);
  });

  it("shows everybody for a bare @", () => {
    expect(mentionCandidates(people, "", "u-me")).toHaveLength(3);
  });

  it("matches on name or email, case-insensitively", () => {
    expect(mentionCandidates(people, "sam", "u-me").map((p) => p.userId)).toEqual([
      "u-sam",
      "u-samira",
    ]);
    expect(mentionCandidates(people, "dispatch", "u-me").map((p) => p.userId)).toEqual(["u-anon"]);
  });

  it("never offers you yourself", () => {
    // The server drops a self-mention before notifying, so offering it is
    // offering something that does nothing.
    expect(mentionCandidates(people, "sam", "u-sam").map((p) => p.userId)).toEqual(["u-samira"]);
  });

  it("caps the list, because it sits above the keyboard", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      userId: `u${i}`,
      fullName: `Sam ${i}`,
      email: null,
    }));
    expect(mentionCandidates(many, "sam", null)).toHaveLength(6);
  });
});

describe("withMention", () => {
  it("completes the half-typed handle at the caret", () => {
    const result = withMention("look at @sa", 11, "Sam");
    expect(result.text).toBe("look at @Sam ");
    // Caret lands after the trailing space, ready for the next word.
    expect(result.cursor).toBe(result.text.length);
  });

  it("keeps whatever follows the caret, without doubling the space", () => {
    // "@Sam  can" is a double space nobody typed and everybody notices.
    const result = withMention("@sa can you check", 3, "Sam");
    expect(result.text).toBe("@Sam can you check");
    // Caret sits on the space, so the next keystroke continues the sentence.
    expect(result.cursor).toBe("@Sam".length);
  });

  it("inserts when there is no partial handle to replace", () => {
    const result = withMention("check this", 10, "Sam");
    expect(result.text).toBe("check this @Sam ");
  });

  it("does not start a comment with a space", () => {
    expect(withMention("", 0, "Sam").text).toBe("@Sam ");
  });

  it("does not double the space after existing whitespace", () => {
    expect(withMention("check ", 6, "Sam").text).toBe("check @Sam ");
  });
});

describe("mentionsInBody", () => {
  /*
   * The rule the web version gets wrong, and the reason this is a function
   * rather than a Set the composer appends to. There, an id chosen from the
   * picker is never removed, so deleting the handle you just inserted still
   * notifies that person about a comment that does not mention them.
   */

  it("notifies somebody whose handle is still written", () => {
    expect(mentionsInBody("@Sam can you check this", [{ userId: "u-sam", handle: "Sam" }])).toEqual(
      ["u-sam"],
    );
  });

  it("does NOT notify somebody whose handle was deleted again", () => {
    // Picked from the list, then the sentence was rewritten without them.
    expect(mentionsInBody("can you check this", [{ userId: "u-sam", handle: "Sam" }])).toEqual([]);
  });

  it("notifies only the teammate actually picked when two share a name", () => {
    /*
     * Sam Whitfield and Samira Khan both handle as something starting "Sam".
     * Only the id chosen from the picker is eligible, so `@Sam` cannot reach
     * both, and cannot reach the wrong one.
     */
    const picked = [{ userId: "u-sam", handle: "Sam" }];
    expect(mentionsInBody("@Sam please look", picked)).toEqual(["u-sam"]);
    // And Samira's own handle does not match Sam's entry.
    expect(mentionsInBody("@Samira please look", picked)).toEqual([]);
  });

  it("ignores a handle typed by hand that was never picked", () => {
    // A silent no-op is recoverable. Guessing which Sam was meant is not.
    expect(mentionsInBody("@Sam look at this", [])).toEqual([]);
  });

  it("is case-insensitive, because autocorrect capitalises", () => {
    expect(mentionsInBody("@sam look", [{ userId: "u-sam", handle: "Sam" }])).toEqual(["u-sam"]);
  });

  it("never notifies the same person twice", () => {
    // Picking the same name twice is normal: type it, delete it, type it again.
    const picked = [
      { userId: "u-sam", handle: "Sam" },
      { userId: "u-sam", handle: "Sam" },
    ];
    expect(mentionsInBody("@Sam @Sam", picked)).toEqual(["u-sam"]);
  });

  it("handles several people in one comment", () => {
    const picked = [
      { userId: "u-sam", handle: "Sam" },
      { userId: "u-samira", handle: "Samira" },
    ];
    expect(mentionsInBody("@Sam and @Samira, the riser is wrong", picked)).toEqual([
      "u-sam",
      "u-samira",
    ]);
  });

  it("survives a body with no handles at all", () => {
    expect(mentionsInBody("", [{ userId: "u-sam", handle: "Sam" }])).toEqual([]);
  });
});

describe("bodySegments", () => {
  it("splits mentions out so they can be tinted", () => {
    expect(bodySegments("hi @Sam ok")).toEqual([
      { text: "hi ", mention: false },
      { text: "@Sam", mention: true },
      { text: " ok", mention: false },
    ]);
  });

  it("returns one plain segment when there is nothing to highlight", () => {
    expect(bodySegments("no mentions")).toEqual([{ text: "no mentions", mention: false }]);
    expect(bodySegments("")).toEqual([{ text: "", mention: false }]);
  });

  it("gives the same answer when called twice on the same string", () => {
    /*
     * A shared global regex keeps `lastIndex` between calls, so the second
     * render of the same comment would come out differently from the first.
     * This is exactly the kind of bug that only shows on a re-render.
     */
    const once = bodySegments("hi @Sam ok");
    const twice = bodySegments("hi @Sam ok");
    expect(twice).toEqual(once);
  });

  it("handles a mention at each end", () => {
    expect(bodySegments("@Sam")).toEqual([{ text: "@Sam", mention: true }]);
    expect(bodySegments("ping @Sam")).toEqual([
      { text: "ping ", mention: false },
      { text: "@Sam", mention: true },
    ]);
  });
});

describe("commentError", () => {
  it("refuses an empty or whitespace-only comment", () => {
    expect(commentError("")).toContain("Write something");
    expect(commentError("   \n ")).toContain("Write something");
  });

  it("mirrors the server's own ceiling", () => {
    expect(commentError("x".repeat(MAX_COMMENT_LENGTH))).toBeNull();
    expect(commentError("x".repeat(MAX_COMMENT_LENGTH + 5))).toContain("5 characters too long");
  });

  it("measures the trimmed body, the way the server does", () => {
    // Otherwise a trailing newline could fail on the client and pass on the
    // server, or the other way round.
    expect(commentError(`  ${"x".repeat(MAX_COMMENT_LENGTH)}  `)).toBeNull();
  });
});

describe("canDeleteComment", () => {
  it("offers a delete to the author only", () => {
    /*
     * The database's answer, not a guess: the policy is "Authors delete own
     * comments" with `author_id = auth.uid()`. An admin pressing a delete would
     * get a silent no-op from RLS.
     */
    expect(canDeleteComment({ authorId: "u-sam" }, "u-sam")).toBe(true);
    expect(canDeleteComment({ authorId: "u-sam" }, "u-boss")).toBe(false);
  });

  it("offers nothing when nobody is signed in", () => {
    expect(canDeleteComment({ authorId: "u-sam" }, null)).toBe(false);
  });
});

describe("authorLabel", () => {
  it("prefers a name, falls back to an email, then says Someone", () => {
    expect(authorLabel({ authorName: "Sam", authorEmail: "s@x.test" })).toBe("Sam");
    /*
     * The handle, not the whole address. A byline sits on a card beside a
     * timestamp and a delete button, and at that width a full address truncated
     * to "marklagura223@gmail..." - long enough to fill the row and too short
     * to say who wrote it.
     *
     * The fallback ORDER still matches the server's. Only the rendering of the
     * address differs, because the server's copy builds notification prose,
     * which has room for it.
     */
    expect(authorLabel({ authorName: null, authorEmail: "s@x.test" })).toBe("s");
    expect(authorLabel({ authorName: null, authorEmail: "marklagura223@gmail.com" })).toBe(
      "marklagura223",
    );
    expect(authorLabel({ authorName: "  ", authorEmail: null })).toBe("Someone");
  });
});

describe("commentsSummary", () => {
  it("counts, and gets the singular right", () => {
    expect(commentsSummary(0)).toBe("No comments yet");
    expect(commentsSummary(1)).toBe("1 comment");
    expect(commentsSummary(4)).toBe("4 comments");
  });
});

describe("the client and the server agree", () => {
  const service = () =>
    readFileSync(join(process.cwd(), "apps/api/src/domains/photos/comments.ts"), "utf8");

  it("mirrors the length bounds the server enforces", () => {
    // Two copies on purpose: the server validates, the client explains. If they
    // ever diverge it should show up in a diff.
    expect(service()).toContain(`max(${MAX_COMMENT_LENGTH})`);
    expect(service()).toContain("min(1)");
  });

  it("sends the field names the server reads", () => {
    /*
     * Invented field names have been the most common bug in this app's API
     * layer, and they typecheck perfectly because the client declares its own
     * shapes. So this reads the schema rather than trusting it.
     */
    const s = service();
    for (const field of ["photoId", "projectId", "body", "mentions"]) {
      expect(s, field).toContain(`${field}:`);
    }
  });

  it("still relies on the server dropping a self-mention", () => {
    // `mentionCandidates` never offers you yourself, but a stale pending entry
    // could still carry your own id. The server is the backstop.
    expect(service()).toContain("filter((id) => id !== ctx.userId)");
  });

  it("links a mention notification at the photo, which the phone can route", () => {
    /*
     * The other half of the loop. The server writes `?photo=<id>` and
     * `notificationTarget` turns it into the project screen with the lightbox
     * already open on that photograph. If the server ever dropped the query the
     * notification would still arrive and land somewhere useless.
     */
    expect(service()).toContain("?photo=");
    const target = readFileSync(
      join(process.cwd(), "apps/mobile/src/api/notification-target.ts"),
      "utf8",
    );
    expect(target).toContain("query.photo");
  });
});
