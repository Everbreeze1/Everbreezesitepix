import { describe, expect, it } from "vitest";
import {
  applyMention,
  memberLabel,
  mentionHandle,
  mentionMatches,
  mentionQueryAt,
  resolveMentions,
  type MentionMember,
} from "../apps/mobile/src/api/task-mentions";

/*
 * A mention writes a notification, so these rules decide who gets interrupted.
 * They match the web composer deliberately: if the two clients disagreed about
 * who a sentence names, the same comment would notify different people
 * depending on which app it was typed in.
 */

const dana: MentionMember = {
  user_id: "u1",
  full_name: "Dana Reyes",
  email: "dana@example.com",
};
const sam: MentionMember = { user_id: "u2", full_name: "Sam Okafor", email: "sam@example.com" };
const noName: MentionMember = { user_id: "u3", full_name: null, email: "jordan.k@example.com" };

const members = [dana, sam, noName];

describe("mentionHandle", () => {
  it("uses the first name", () => {
    expect(mentionHandle(dana)).toBe("Dana");
  });

  it("falls back to the email local part", () => {
    expect(mentionHandle(noName)).toBe("jordan.k");
  });

  it("has a last resort", () => {
    expect(mentionHandle({ full_name: null, email: null })).toBe("teammate");
    expect(mentionHandle({ full_name: "   ", email: null })).toBe("teammate");
  });
});

describe("mentionQueryAt", () => {
  it("reads the handle being typed at the caret", () => {
    const draft = "can you check @da";
    expect(mentionQueryAt(draft, draft.length)).toBe("da");
  });

  it("opens on a bare @", () => {
    expect(mentionQueryAt("hello @", 7)).toBe("");
  });

  it("does not reopen on an @handle typed earlier in the sentence", () => {
    /*
     * The caret is back in the middle fixing a word. Reading the whole draft
     * instead of the text before the cursor would pop the picker open over a
     * mention that was finished minutes ago.
     */
    const draft = "@Dana please check the roof";
    expect(mentionQueryAt(draft, draft.length)).toBeNull();
  });

  it("ignores an @ inside a word, like an email address", () => {
    const draft = "mail dana@example.com";
    expect(mentionQueryAt(draft, draft.length)).toBeNull();
  });
});

describe("applyMention", () => {
  it("replaces the partial handle and leaves the caret after it", () => {
    const draft = "can you check @da";
    const result = applyMention(draft, draft.length, dana);
    expect(result.text).toBe("can you check @Dana ");
    expect(result.cursor).toBe(result.text.length);
  });

  it("keeps whatever followed the caret", () => {
    const draft = "@da the roof";
    const result = applyMention(draft, 3, dana);
    expect(result.text).toBe("@Dana  the roof");
  });
});

describe("mentionMatches", () => {
  it("returns nothing when no mention is being typed", () => {
    expect(mentionMatches(members, null, "u9")).toEqual([]);
  });

  it("never offers the author themselves", () => {
    // Mentioning yourself notifies yourself, which is only ever noise.
    expect(mentionMatches(members, "", "u1").map((m) => m.user_id)).toEqual(["u2", "u3"]);
  });

  it("filters by what has been typed", () => {
    expect(mentionMatches(members, "sa", null).map((m) => m.user_id)).toEqual(["u2"]);
  });
});

describe("resolveMentions", () => {
  it("keeps people still named in the message", () => {
    expect(resolveMentions("thanks @Dana", ["u1"], members)).toEqual(["u1"]);
  });

  it("drops someone whose handle was deleted before sending", () => {
    /*
     * The bug this prevents: pick a name from the picker, then delete the text
     * and send something else. That teammate gets a "mentioned you" pointing at
     * a sentence that does not mention them.
     */
    expect(resolveMentions("never mind", ["u1"], members)).toEqual([]);
  });

  it("ignores a picked id that is no longer a member", () => {
    expect(resolveMentions("thanks @Dana", ["u404"], members)).toEqual([]);
  });

  it("notifies both teammates who share a handle", () => {
    /*
     * Two people called Dana produce one handle. Both are notified, which is
     * what web does. Diverging here would mean the same comment reaches
     * different people depending on where it was written, and that is worse
     * than one teammate too many.
     */
    const otherDana: MentionMember = {
      user_id: "u4",
      full_name: "Dana Whitfield",
      email: "danaw@example.com",
    };
    const resolved = resolveMentions("@Dana can you look", ["u1", "u4"], [dana, otherDana]);
    expect(resolved).toEqual(["u1", "u4"]);
  });
});

describe("memberLabel", () => {
  it("prefers the name, falls back to the handle", () => {
    expect(memberLabel(dana)).toBe("Dana Reyes");
    /*
     * The handle, not the whole address. A row title is one line at heading
     * weight and an address is wider than one: on the team roster the same
     * fallback rendered the workspace owner as "marklagura223@gmail" above
     * ".com". Every name in the app now goes through `personName`.
     *
     * The one exception is `watcherName`, which keeps the full address on
     * purpose, because the watcher list answers "who is getting mailed about
     * this" and the domain is the informative half there.
     */
    /*
     * Also makes this screen self-consistent: `mentionHandle` already took the
     * local part, so the same person was appearing two ways at once - as
     * "@jordan.k" in the composer and "jordan.k@example.com" in the header.
     */
    expect(memberLabel(noName)).toBe("jordan.k");
    expect(memberLabel(undefined)).toBe("Someone");
  });
});
