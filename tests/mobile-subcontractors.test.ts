import { describe, expect, it } from "vitest";
import {
  companyNameError,
  emailError,
  inviteBlockedReason,
  inviteSelectionError,
  projectNames,
  stateLabel,
  stateOf,
  subcontractorName,
  subcontractorSummary,
  type Subcontractor,
} from "../apps/mobile/src/api/subcontractor-view";

/*
 * Subcontractor access.
 *
 * This feature hands somebody outside the workspace a login that can see named
 * jobs and nothing else, which makes it the highest-consequence screen in the
 * app: every other list shows a member of the team their own team's work, and
 * the difference between one job and all of them is a single tick.
 *
 * So the gates are tested rather than trusted, and they are tested against what
 * the service actually enforces (`requireTeamAdmin`, `projectIds: min(1)`), not
 * against what seems reasonable.
 */

const sub = (over: Partial<Subcontractor> = {}): Subcontractor => ({
  id: "s1",
  email: "office@sparks.test",
  company_name: "Sparks Electrical",
  user_id: "u1",
  accepted_at: "2026-08-01T00:00:00.000Z",
  expires_at: "2026-09-01T00:00:00.000Z",
  created_at: "2026-07-25T00:00:00.000Z",
  pending: false,
  expired: false,
  projects: [{ id: "p1", name: "Riverside" }],
  ...over,
});

describe("inviteBlockedReason", () => {
  it("lets an owner or admin on the Team plan invite", () => {
    expect(inviteBlockedReason("owner", "team")).toBeNull();
    expect(inviteBlockedReason("admin", "team")).toBeNull();
  });

  it("stops a manager, matching requireTeamAdmin exactly", () => {
    /*
     * A manager can re-role their own crew and still may not hand a key to an
     * outside firm. The service refuses with the same distinction; this is here
     * so the control is never offered in a state that would be refused.
     */
    expect(inviteBlockedReason("manager", "team")).toContain("owner or admin");
    expect(inviteBlockedReason("standard", "team")).toContain("owner or admin");
    expect(inviteBlockedReason("restricted", "team")).toContain("owner or admin");
  });

  it("denies an unrecognised role rather than falling through", () => {
    expect(inviteBlockedReason("wizard", "team")).not.toBeNull();
    expect(inviteBlockedReason(null, "team")).not.toBeNull();
  });

  it("gates on the Team plan, because scoping to named jobs is what it sells", () => {
    /*
     * Offering it on Pro would either fail at the server or, far worse, appear
     * to restrict somebody and not. That is the same reasoning that makes the
     * `restricted` role Team-only.
     */
    expect(inviteBlockedReason("owner", "pro")).toContain("Team plan");
    expect(inviteBlockedReason("owner", "starter")).toContain("Team plan");
  });

  it("reports the role problem before the plan problem", () => {
    // A manager on Pro cannot do this for two reasons, and the one they can act
    // on is neither: telling them to upgrade would be wrong advice.
    expect(inviteBlockedReason("manager", "pro")).toContain("owner or admin");
  });
});

describe("inviteSelectionError", () => {
  it("requires at least one job, matching the op", () => {
    /*
     * Inviting with none hands over a login that can see nothing. That is not a
     * lesser mistake than handing over too much: it is a person who cannot work
     * and does not know why.
     */
    expect(inviteSelectionError([])).toContain("at least one");
    expect(inviteSelectionError(["p1"])).toBeNull();
  });

  it("caps at the op's own limit", () => {
    // So one call cannot fan a firm across an entire workspace by accident.
    const many = Array.from({ length: 201 }, (_, i) => `p${i}`);
    expect(inviteSelectionError(many)).toContain("200");
    expect(inviteSelectionError(many.slice(0, 200))).toBeNull();
  });
});

describe("stateOf", () => {
  it("reports expired before pending, because it looks like access and is not", () => {
    expect(stateOf(sub({ pending: true, expired: true }))).toBe("expired");
  });

  it("reports pending for an invite nobody has accepted", () => {
    expect(stateOf(sub({ pending: true, expired: false, accepted_at: null }))).toBe("pending");
  });

  it("distinguishes accepted-but-scoped-to-nothing from active", () => {
    /*
     * Reached by taking the last job away, which is how a firm is parked
     * between phases without revoking them. A real and deliberate state, not an
     * error, and it must not read as "Active".
     */
    expect(stateOf(sub({ projects: [] }))).toBe("no_projects");
    expect(stateOf(sub())).toBe("active");
  });

  it("has a readable word for every state", () => {
    for (const state of ["expired", "pending", "no_projects", "active"] as const) {
      expect(stateLabel(state).length).toBeGreaterThan(0);
    }
    expect(stateLabel("no_projects")).not.toContain("_");
  });
});

describe("subcontractorName", () => {
  it("prefers the company, falls back to the address", () => {
    expect(subcontractorName(sub())).toBe("Sparks Electrical");
    expect(subcontractorName(sub({ company_name: null }))).toBe("office@sparks.test");
    expect(subcontractorName(sub({ company_name: "   " }))).toBe("office@sparks.test");
  });
});

describe("subcontractorSummary", () => {
  it("always shows the address, because that is who actually holds the login", () => {
    expect(subcontractorSummary(sub())).toContain("office@sparks.test");
  });

  it("says how many jobs, and gets the singular right", () => {
    expect(subcontractorSummary(sub())).toContain("1 job");
    expect(
      subcontractorSummary(
        sub({
          projects: [
            { id: "p1", name: "A" },
            { id: "p2", name: "B" },
          ],
        }),
      ),
    ).toContain("2 jobs");
    expect(subcontractorSummary(sub({ projects: [] }))).toContain("no jobs");
  });

  it("leads with the problem when the invite expired", () => {
    expect(subcontractorSummary(sub({ pending: true, expired: true }))).toContain("expired");
  });
});

describe("projectNames", () => {
  it("names the jobs rather than counting them", () => {
    /*
     * For the confirm before revoking. "Revoke access to 3 jobs" does not tell
     * an admin whether the one they are worried about is among them.
     */
    expect(projectNames(sub({ projects: [{ id: "p1", name: "Riverside" }] }))).toEqual([
      "Riverside",
    ]);
  });

  it("never renders a blank row for a job with no name", () => {
    expect(projectNames(sub({ projects: [{ id: "p1", name: null }] }))).toEqual(["Untitled job"]);
  });
});

describe("emailError", () => {
  const existing = [sub()];

  it("accepts a new address", () => {
    expect(emailError("new@firm.test", existing)).toBeNull();
  });

  it("catches a firm already invited, whatever the casing", () => {
    /*
     * The service lowercases before hitting a partial unique index on
     * (team_id, email), so a duplicate is refused there anyway. Saying it here
     * saves typing an address, choosing jobs and sending, to be told something
     * knowable at the first keystroke.
     */
    expect(emailError("OFFICE@SPARKS.TEST", existing)).toContain("already been invited");
    expect(emailError("  office@sparks.test ", existing)).toContain("already been invited");
  });

  it("rejects an empty box and obvious nonsense", () => {
    expect(emailError("", existing)).toContain("Enter an email");
    expect(emailError("sparks", existing)).toContain("does not look like");
  });

  it("is loose rather than clever about what an address may contain", () => {
    expect(emailError("first.last+jobs@sub.domain.co.uk", existing)).toBeNull();
  });
});

describe("companyNameError", () => {
  it("allows blank, because the op does", () => {
    expect(companyNameError("")).toBeNull();
    expect(companyNameError("Sparks")).toBeNull();
  });

  it("caps at the op's limit", () => {
    expect(companyNameError("x".repeat(121))).toContain("120");
  });
});
