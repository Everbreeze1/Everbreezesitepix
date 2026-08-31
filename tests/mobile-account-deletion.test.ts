import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  confirmationError,
  confirmationMatches,
  deletionBlockedReason,
  WHAT_IS_DELETED,
  WHAT_REMAINS,
} from "../apps/mobile/src/api/account-deletion-view";

/*
 * Closing an account.
 *
 * The most destructive thing the app can do, and the one write with no undo of
 * any kind: `auth.admin.deleteUser` cascades through every table with a key to
 * `auth.users`. So the rules are tested rather than trusted, and the two that
 * matter are the owner refusal and the typed confirmation.
 */

describe("deletionBlockedReason", () => {
  it("lets an ordinary member close their account", () => {
    expect(deletionBlockedReason("standard", 5)).toBeNull();
    expect(deletionBlockedReason("admin", 5)).toBeNull();
    expect(deletionBlockedReason("manager", 5)).toBeNull();
    expect(deletionBlockedReason(null, 0)).toBeNull();
  });

  it("lets a sole owner close, because there is nobody to orphan", () => {
    expect(deletionBlockedReason("owner", 0)).toBeNull();
  });

  it("refuses an owner with colleagues, and says why", () => {
    /*
     * A product gap rather than a rule. Ownership cannot be transferred
     * anywhere: `updateMemberRole` accepts admin, manager, standard and
     * restricted, and there is no transfer or delete-team op. So an owner can
     * neither leave, nor hand the workspace on, nor take it with them, and
     * deleting them would orphan a workspace people are still working in.
     */
    const reason = deletionBlockedReason("owner", 1);
    expect(reason).not.toBeNull();
    expect(reason).toContain("transferred");
    expect(reason).toContain("support");
  });

  it("treats only the exact string 'owner' as an owner", () => {
    /*
     * Deliberately not through `normaliseRole`, which maps anything
     * unrecognised to `standard`. That is right for a permission check and
     * wrong here: this decides whether to ALLOW a deletion, so an unfamiliar
     * role must not be quietly treated as safe to delete... but nor should it
     * be treated as an owner and blocked for the wrong reason. Only "owner"
     * blocks.
     */
    expect(deletionBlockedReason("Owner", 1)).toBeNull();
    expect(deletionBlockedReason("wizard", 1)).toBeNull();
  });
});

describe("confirmationMatches", () => {
  it("needs the address, not a checkbox", () => {
    // Typing the address is the difference between deciding and mis-tapping.
    expect(confirmationMatches("sam@site.test", "sam@site.test")).toBe(true);
    expect(confirmationMatches("", "sam@site.test")).toBe(false);
    expect(confirmationMatches("yes", "sam@site.test")).toBe(false);
  });

  it("is case-insensitive and trimmed, matching the server", () => {
    expect(confirmationMatches("  SAM@SITE.TEST ", "sam@site.test")).toBe(true);
  });

  it("never matches when the account has no address on file", () => {
    // The server refuses this case outright rather than deleting.
    expect(confirmationMatches("sam@site.test", null)).toBe(false);
    expect(confirmationMatches("", null)).toBe(false);
  });

  it("does not match a different address", () => {
    expect(confirmationMatches("someone@else.test", "sam@site.test")).toBe(false);
  });
});

describe("confirmationError", () => {
  it("asks for the address, then says when it is wrong", () => {
    expect(confirmationError("", "sam@site.test")).toContain("Type your email");
    expect(confirmationError("nope@x.test", "sam@site.test")).toContain("does not match");
    expect(confirmationError("sam@site.test", "sam@site.test")).toBeNull();
  });
});

describe("what the screen tells somebody", () => {
  it("says the photographs go, because that is the actual question", () => {
    const all = WHAT_IS_DELETED.join(" ").toLowerCase();
    expect(all).toContain("photo");
  });

  it("says what stays, which is the half people are surprised by", () => {
    /*
     * A teammate's photograph on a shared project is theirs, not yours, and it
     * stays. Saying so prevents both the wrong expectation and the support
     * ticket that follows it.
     */
    expect(WHAT_REMAINS.length).toBeGreaterThan(0);
    expect(WHAT_REMAINS.join(" ").toLowerCase()).toContain("teammate");
  });
});

describe("the client and the server agree", () => {
  it("blocks the same case the service blocks", () => {
    /*
     * Two copies on purpose: the server refuses, the client decides what to
     * draw. If they ever diverge it should be visible in a diff, so this reads
     * the server's own reason rather than assuming they match.
     */
    const service = readFileSync(
      join(process.cwd(), "apps/api/src/domains/account/delete-account.ts"),
      "utf8",
    );

    // Same trigger condition.
    expect(service).toContain('role === "owner" && otherMemberCount > 0');
    // And the server does its own read rather than trusting the client's answer.
    expect(service).toContain("accountDeletionBlockedReason");
    expect(service).toContain("team_members");
  });

  it("requires the typed email on the server too", () => {
    const service = readFileSync(
      join(process.cwd(), "apps/api/src/domains/account/delete-account.ts"),
      "utf8",
    );
    expect(service).toContain("confirmEmail");
    expect(service).toContain("does not match this account");
  });
});
