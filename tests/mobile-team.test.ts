import { describe, expect, it } from "vitest";
import {
  inviteBlockedReason,
  inviteEmailError,
  isInviteExpired,
  memberActions,
  memberName,
  memberSubtitle,
  seatSummary,
  seatsUsed,
  sortRoster,
  type TeamMember,
} from "../apps/mobile/src/api/team-roster";

/*
 * The roster rules.
 *
 * These are gates, and a gate that is wrong is invisible until somebody
 * exercises it: the control appears, the server refuses, and the person sees an
 * error they had no way to predict. So every rule that decides whether a
 * control is drawn is pinned here.
 *
 * The permission matrix itself is not retested. `canManageMember` and friends
 * live in `@everlumen/shared` and have their own suite in
 * `tests/team-permissions.test.ts`. What is tested here is that this module
 * asks them the right question.
 */

const member = (over: Partial<TeamMember> = {}): TeamMember => ({
  id: "m1",
  user_id: "u1",
  role: "standard",
  created_at: "2026-01-01T00:00:00.000Z",
  profile: { email: "sam@site.test", full_name: "Sam Reyes", avatar_url: null },
  emailConfirmed: true,
  ...over,
});

describe("memberName", () => {
  it("prefers the name, falls back to the address", () => {
    expect(memberName(member())).toBe("Sam Reyes");
    expect(
      memberName(member({ profile: { email: "a@b.test", full_name: null, avatar_url: null } })),
    ).toBe("a@b.test");
  });

  it("never renders a uuid", () => {
    // The client calls this "unfriendly info", and a roster row reading
    // "8f3c1a2e-..." is the purest example of it.
    expect(memberName(member({ profile: null }))).toBe("Pending member");
    expect(
      memberName(member({ profile: { email: "  ", full_name: "  ", avatar_url: null } })),
    ).toBe("Pending member");
  });
});

describe("memberSubtitle", () => {
  it("shows the address under the name", () => {
    expect(memberSubtitle(member())).toBe("sam@site.test");
  });

  it("does not repeat the address when it is already the title", () => {
    expect(
      memberSubtitle(member({ profile: { email: "a@b.test", full_name: null, avatar_url: null } })),
    ).toBeUndefined();
  });
});

describe("sortRoster", () => {
  it("puts seniority first, then who joined first", () => {
    /*
     * Alphabetical is the obvious alternative and it is worse. The question a
     * roster answers on a phone is "who can approve this", which is a seniority
     * question, and sorting by name buries the one Admin among fifteen
     * Standards.
     */
    const rows = [
      member({ id: "d", role: "standard", created_at: "2026-01-04T00:00:00Z" }),
      member({ id: "b", role: "owner", created_at: "2026-01-02T00:00:00Z" }),
      member({ id: "c", role: "standard", created_at: "2026-01-01T00:00:00Z" }),
      member({ id: "a", role: "admin", created_at: "2026-01-03T00:00:00Z" }),
    ];
    expect(sortRoster(rows).map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
  });

  it("treats the legacy `member` spelling as standard", () => {
    // `member` is the historical name for Standard and still comes back from
    // the server on older rows. Sorting it as unknown would float it above the
    // owner.
    const rows = [
      member({ id: "legacy", role: "member", created_at: "2026-01-01T00:00:00Z" }),
      member({ id: "owner", role: "owner", created_at: "2026-01-02T00:00:00Z" }),
    ];
    expect(sortRoster(rows).map((r) => r.id)).toEqual(["owner", "legacy"]);
  });

  it("does not mutate the array it was given", () => {
    const rows = [member({ id: "a", role: "standard" }), member({ id: "b", role: "owner" })];
    sortRoster(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("seats", () => {
  it("counts an invitation as a seat", () => {
    // It is. A seat held by a pending invite is unavailable, and a screen that
    // said otherwise would offer an invite the server then refuses.
    expect(seatsUsed(3, 2)).toBe(5);
  });

  it("says how many are left rather than how many are used", () => {
    expect(seatSummary(3, 5)).toBe("2 of 5 seats free");
    expect(seatSummary(5, 5)).toBe("All 5 seats in use");
    expect(seatSummary(1, 1)).toBe("All 1 seat in use");
  });
});

describe("inviteBlockedReason", () => {
  it("lets an owner or admin invite into a free seat", () => {
    expect(inviteBlockedReason("owner", 1, 5)).toBeNull();
    expect(inviteBlockedReason("admin", 4, 5)).toBeNull();
  });

  it("stops a manager, who can re-role their crew but not add to it", () => {
    expect(inviteBlockedReason("manager", 1, 5)).toContain("owner or admin");
    expect(inviteBlockedReason("standard", 1, 5)).toContain("owner or admin");
  });

  it("stops everyone at the seat cap, and says why", () => {
    /*
     * The reason is the point. A disabled button with no explanation is how a
     * plan gate comes to read as a bug, which is the exact complaint that
     * started the mobile parity work.
     */
    const reason = inviteBlockedReason("owner", 5, 5);
    expect(reason).toContain("seat");
    expect(reason).toContain("web app");
  });

  it("denies an unrecognised role rather than falling through", () => {
    // A role this build has never heard of must never be treated as an admin.
    expect(inviteBlockedReason("wizard", 1, 5)).not.toBeNull();
    expect(inviteBlockedReason(null, 1, 5)).not.toBeNull();
  });
});

describe("inviteEmailError", () => {
  const roster = [member()];
  const invites = [{ email: "Pat@Site.test" }];

  it("accepts a new address", () => {
    expect(inviteEmailError("new@site.test", roster, invites)).toBeNull();
  });

  it("catches somebody who is already here, whatever the casing", () => {
    // Answering this on the device saves typing an address, sending it, waiting
    // for a round trip and being told something that was knowable instantly.
    expect(inviteEmailError("SAM@SITE.TEST", roster, invites)).toContain("already on the team");
    expect(inviteEmailError("pat@site.test", roster, invites)).toContain("already been invited");
    expect(inviteEmailError("  pat@site.test  ", roster, invites)).toContain(
      "already been invited",
    );
  });

  it("rejects an empty box and obvious nonsense", () => {
    expect(inviteEmailError("", roster, invites)).toContain("Enter an email");
    expect(inviteEmailError("   ", roster, invites)).toContain("Enter an email");
    expect(inviteEmailError("sam", roster, invites)).toContain("does not look like");
    expect(inviteEmailError("sam@site", roster, invites)).toContain("does not look like");
  });

  it("is loose rather than clever about what an address may contain", () => {
    // Strict validation rejects real addresses. The server is the thing that
    // has to be right; this only has to catch the typo.
    expect(inviteEmailError("first.last+site@sub.domain.co.uk", roster, invites)).toBeNull();
  });

  it("copes with a roster row that has no profile", () => {
    expect(inviteEmailError("new@site.test", [member({ profile: null })], [])).toBeNull();
  });
});

describe("memberActions", () => {
  it("gives an owner everything on everybody else", () => {
    const actions = memberActions("owner", member({ user_id: "them" }), "me");
    expect(actions.has("change_role")).toBe(true);
    expect(actions.has("remove")).toBe(true);
  });

  it("offers nothing on your own row, even as owner", () => {
    /*
     * Leaving is a separate and deliberately harder action. Self-demotion from
     * a roster row is one of the ways a workspace ends up with nobody who can
     * pay the bill.
     */
    expect(memberActions("owner", member({ user_id: "me" }), "me").size).toBe(0);
  });

  it("protects the owner row from an admin", () => {
    expect(memberActions("admin", member({ role: "owner", user_id: "them" }), "me").size).toBe(0);
  });

  it("holds a manager to their own crew", () => {
    const onStandard = memberActions("manager", member({ role: "standard", user_id: "t" }), "me");
    const onAdmin = memberActions("manager", member({ role: "admin", user_id: "t" }), "me");
    expect(onStandard.has("remove")).toBe(true);
    expect(onAdmin.size).toBe(0);
  });

  it("gives a standard member no actions at all", () => {
    expect(memberActions("standard", member({ user_id: "them" }), "me").size).toBe(0);
  });

  it("offers a resend only when the server said the address is unconfirmed", () => {
    /*
     * `null` means the server could not tell, which is not the same as
     * unconfirmed. Offering a resend on a guess sends real mail to somebody who
     * did not need it.
     */
    const unconfirmed = member({ user_id: "them", emailConfirmed: false });
    expect(memberActions("owner", unconfirmed, "me").has("resend_confirmation")).toBe(true);
    expect(
      memberActions("owner", member({ user_id: "them", emailConfirmed: null }), "me").has(
        "resend_confirmation",
      ),
    ).toBe(false);
    expect(
      memberActions("owner", member({ user_id: "them" }), "me").has("resend_confirmation"),
    ).toBe(false);
  });

  it("does not offer a resend on a row you cannot manage anyway", () => {
    const unconfirmedAdmin = member({ role: "admin", user_id: "them", emailConfirmed: false });
    expect(memberActions("manager", unconfirmedAdmin, "me").size).toBe(0);
  });
});

describe("isInviteExpired", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");

  it("reads the expiry against now", () => {
    expect(isInviteExpired({ expires_at: "2026-08-28T12:00:00.000Z" }, now)).toBe(true);
    expect(isInviteExpired({ expires_at: "2026-08-30T12:00:00.000Z" }, now)).toBe(false);
  });

  it("treats an unparseable date as live rather than expired", () => {
    // Showing "Expired" on a perfectly good invite would have somebody cancel
    // and resend it for no reason. The server is the authority either way.
    expect(isInviteExpired({ expires_at: "not a date" }, now)).toBe(false);
  });
});
