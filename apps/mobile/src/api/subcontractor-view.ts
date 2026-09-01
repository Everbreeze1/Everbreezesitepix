import { personName } from "@everlumen/shared";
import {
  normaliseRole,
  type BillingTier,
  type StoredTeamRole,
} from "@everlumen/shared/team-permissions";

/**
 * Subcontractor access, as rules.
 *
 * Import-free apart from the shared permission matrix, so it can be tested.
 *
 * **What this feature actually is:** giving somebody outside the workspace a
 * login that can see named jobs and nothing else. That makes it the highest
 * consequence screen on the phone. Every other list shows a member of the team
 * their own team's work; this one hands a stranger a key, and the difference
 * between one job and all of them is a single tick.
 *
 * So two rules are enforced here rather than being left to the server to
 * refuse: only an owner or admin may do it, and an invite must name at least
 * one project. Both are checked server-side too. Checking here is not
 * duplication for its own sake, it is so the control is never offered in a
 * state that would be refused.
 */

export type SubcontractorProject = { id: string; name: string | null };

/** A row as `listSubcontractors` returns it. Field names are the service's. */
export type Subcontractor = {
  id: string;
  email: string;
  company_name: string | null;
  user_id: string | null;
  accepted_at: string | null;
  expires_at: string;
  created_at: string;
  /** Computed by the service: invited and not yet accepted. */
  pending: boolean;
  /** Computed by the service: pending, and past `expires_at`. */
  expired: boolean;
  projects: SubcontractorProject[];
};

/**
 * Why this person cannot invite an outside firm, or null.
 *
 * A string rather than a boolean, because a disabled control with no
 * explanation reads as a bug, and on this screen the explanation is the whole
 * point: subcontractor access is deliberately narrower than "manage the team".
 */
export function inviteBlockedReason(
  myRole: StoredTeamRole | string | null,
  tier: BillingTier,
): string | null {
  const role = normaliseRole(myRole);
  if (role !== "owner" && role !== "admin") {
    // Matches `requireTeamAdmin` in the service exactly. A manager can re-role
    // their own crew and still may not hand a key to an outside firm.
    return "Only an owner or admin can give an outside firm access.";
  }
  if (tier !== "team") {
    /*
     * Scoping a person to named jobs is what the Team tier sells, and it is the
     * same capability as the `restricted` role. Offering it on Pro would either
     * fail at the server or, far worse, appear to restrict somebody and not.
     */
    return "Giving an outside firm access to named jobs is part of the Team plan.";
  }
  return null;
}

/**
 * Whether a selection can be sent as an invite.
 *
 * The op requires `min(1)` projects. Inviting with none would be handing over a
 * login that can see nothing, which is not a lesser mistake than handing over
 * too much: it is a person who cannot work and does not know why.
 */
export function inviteSelectionError(projectIds: string[]): string | null {
  if (projectIds.length === 0) return "Choose at least one job for them to see.";
  // The op caps at 200, so one call cannot fan a firm across a whole workspace.
  if (projectIds.length > 200) return "That is more than 200 jobs. Choose fewer.";
  return null;
}

/**
 * What the row says about where this firm stands.
 *
 * Three states the service computes and one it does not, in the order an admin
 * cares about them: expired first, because it is the one that looks like
 * working access and is not.
 */
export type SubcontractorState = "expired" | "pending" | "active" | "no_projects";

export function stateOf(sub: Subcontractor): SubcontractorState {
  if (sub.expired) return "expired";
  if (sub.pending) return "pending";
  /*
   * Accepted, but scoped to nothing. Reached by taking the last job away, which
   * is how a firm is parked without revoking them, so it is a real and
   * deliberate state rather than an error.
   */
  if (sub.projects.length === 0) return "no_projects";
  return "active";
}

export function stateLabel(state: SubcontractorState): string {
  switch (state) {
    case "expired":
      return "Invite expired";
    case "pending":
      return "Invited";
    case "no_projects":
      return "No jobs";
    default:
      return "Active";
  }
}

/** The line under a firm's name. */
export function subcontractorSummary(sub: Subcontractor): string {
  const count = sub.projects.length;
  const jobs = count === 0 ? "no jobs" : `${count} job${count === 1 ? "" : "s"}`;
  const state = stateOf(sub);

  if (state === "expired") return `${sub.email} · invite expired`;
  if (state === "pending") return `${sub.email} · invited, ${jobs}`;
  return `${sub.email} · ${jobs}`;
}

/** What to call a firm: its company name, or the address it was invited at. */
export function subcontractorName(sub: Pick<Subcontractor, "company_name" | "email">): string {
  /*
   * The handle when there is no company name, for the same reason the team
   * roster uses one: the address is longer than a title line and breaks across
   * its own domain. Here it was doubly odd, because `subcontractorSubtitle`
   * already begins with the full address - so an unnamed firm was listed as
   * its email twice, once broken in half.
   */
  return personName(sub.company_name, sub.email, "Outside firm");
}

/**
 * The names of the jobs a firm can see, for the confirm before revoking.
 *
 * Named rather than counted, because "revoke access to 3 jobs" does not tell an
 * admin whether the one they are worried about is among them.
 */
export function projectNames(sub: Subcontractor): string[] {
  return sub.projects.map((project) => project.name?.trim() || "Untitled job");
}

export function companyNameError(name: string): string | null {
  // Optional on the op, so blank is fine. Only the cap is enforced.
  return name.trim().length > 120 ? "Keep the company name under 120 characters." : null;
}

export function emailError(email: string, existing: Pick<Subcontractor, "email">[]): string | null {
  const value = email.trim().toLowerCase();
  if (!value) return "Enter an email address.";
  // Deliberately loose, like the team invite: strict validation rejects real
  // addresses and the server is the thing that has to be right.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That does not look like an email address.";
  if (existing.some((sub) => sub.email.trim().toLowerCase() === value)) {
    /*
     * The service normalises case before hitting a partial unique index on
     * (team_id, email), so a duplicate is refused there anyway. Saying it here
     * saves typing an address, choosing jobs and sending, to be told something
     * knowable at the first keystroke.
     */
    return "That firm has already been invited.";
  }
  return null;
}
