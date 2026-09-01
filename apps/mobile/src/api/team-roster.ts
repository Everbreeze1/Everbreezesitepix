import { personName } from "@everlumen/shared";
import {
  canManageMember,
  normaliseRole,
  type BillingTier,
  type StoredTeamRole,
  type TeamRole,
} from "@everlumen/shared/team-permissions";

/**
 * The roster, as rules rather than as a screen.
 *
 * Nothing here imports React or the API client, so all of it is tested
 * directly. That matters more for this feature than for most: the gating is
 * what stops a Manager from removing an Admin, and a gate that is wrong is
 * invisible until somebody exercises it, at which point the server refuses and
 * the person sees an error they could not have predicted from the UI.
 *
 * The permission model itself is **not** reimplemented here. `can`,
 * `canManageMember`, `assignableRoles` and `roleAllowedOnTier` live in
 * `@everlumen/shared` and are the same functions the web app and the API gate
 * on. This module is the ordering, the counting and the wording around them.
 */

export type TeamProfile = {
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

export type TeamMember = {
  id: string;
  user_id: string;
  role: StoredTeamRole | string;
  created_at: string;
  profile: TeamProfile | null;
  /** Null when the server could not tell, which is not the same as false. */
  emailConfirmed: boolean | null;
};

export type TeamInvite = {
  id: string;
  email: string;
  role: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
};

/**
 * What to call somebody.
 *
 * Falls all the way through rather than rendering a uuid, because a roster row
 * reading "8f3c1a2e-..." is the "unfriendly info" complaint in its purest form.
 */
export function memberName(member: Pick<TeamMember, "profile">): string {
  /*
   * The handle, not the whole address.
   *
   * A row title is one line at heading weight, and a full address does not fit
   * one: "marklagura223@gmail.com" wrapped and broke after the "@gmail", so the
   * owner of the workspace was listed as "marklagura223@gmail" over ".com".
   * That reads as a rendering fault rather than as a person.
   *
   * The address is not lost - `memberSubtitle` now always shows it, so the row
   * says the same two things it did, in the order that fits.
   */
  return personName(member.profile?.full_name, member.profile?.email);
}

/**
 * The line under the name: the full address.
 *
 * Shown whenever there is one, including when the title was derived from it.
 * It used to be suppressed in that case to avoid saying the same thing twice,
 * which was right when the title WAS the address and is wrong now that the
 * title is only its first half - suppressing it would hide which domain, and
 * on a roster that is often the thing being checked.
 */
export function memberSubtitle(member: Pick<TeamMember, "profile">): string | undefined {
  const email = member.profile?.email?.trim();
  if (!email) return undefined;
  return email === memberName(member) ? undefined : email;
}

/**
 * Roster order: seniority first, then who joined first.
 *
 * Alphabetical is the other obvious choice and it is worse here. The question
 * a roster answers on a phone is "who can approve this", and that is a
 * seniority question. Sorting by name buries the one Admin among fifteen
 * Standards.
 */
const RANK: Record<TeamRole, number> = {
  owner: 0,
  admin: 1,
  manager: 2,
  standard: 3,
  restricted: 4,
};

export function sortRoster<T extends Pick<TeamMember, "role" | "created_at">>(members: T[]): T[] {
  return [...members].sort((a, b) => {
    const byRank = RANK[normaliseRole(a.role)] - RANK[normaliseRole(b.role)];
    if (byRank !== 0) return byRank;
    return a.created_at.localeCompare(b.created_at);
  });
}

/** Seats in use: people plus invitations, because an invite holds a seat. */
export function seatsUsed(memberCount: number, inviteCount: number): number {
  return memberCount + inviteCount;
}

/**
 * The seat line under the header.
 *
 * Deliberately says how many are left rather than how many are used. "3 of 5
 * seats" is a fact; "2 seats left" is the thing that decides whether the invite
 * button is worth tapping.
 */
export function seatSummary(used: number, limit: number): string {
  const left = Math.max(0, limit - used);
  if (left === 0) return `All ${limit} seat${limit === 1 ? "" : "s"} in use`;
  return `${left} of ${limit} seat${limit === 1 ? "" : "s"} free`;
}

/**
 * Why inviting is unavailable, or null when it is available.
 *
 * A string rather than a boolean, because a disabled button with no
 * explanation is the single most common way a plan gate reads as a bug. The
 * caller shows this text next to the control.
 */
export function inviteBlockedReason(
  myRole: StoredTeamRole | string | null,
  used: number,
  limit: number,
): string | null {
  const role = normaliseRole(myRole);
  if (role !== "owner" && role !== "admin") {
    return "Only an owner or admin can invite people.";
  }
  if (used >= limit) {
    return `Every seat on your plan is in use. Remove somebody, or add seats from the web app.`;
  }
  return null;
}

/**
 * Whether an address can be invited, and why not if it cannot.
 *
 * The server checks all of this too. Checking here as well is not duplication
 * for its own sake: on a phone the alternative is typing an address, tapping
 * send, waiting for a round trip and being told the person is already on the
 * team, which is four steps to learn something answerable instantly.
 */
export function inviteEmailError(
  email: string,
  members: Pick<TeamMember, "profile">[],
  invites: Pick<TeamInvite, "email">[],
): string | null {
  const value = email.trim().toLowerCase();
  if (!value) return "Enter an email address.";
  // Deliberately loose. Strict address validation rejects real addresses, and
  // the server is the one that has to be right.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return "That does not look like an email address.";

  if (members.some((m) => m.profile?.email?.trim().toLowerCase() === value)) {
    return "They are already on the team.";
  }
  if (invites.some((i) => i.email.trim().toLowerCase() === value)) {
    return "They have already been invited.";
  }
  return null;
}

/**
 * The actions available on one roster row.
 *
 * Returned as a set rather than three booleans so the caller cannot ask a
 * question this module did not answer. An empty set is normal: it is what
 * every row looks like to a Standard member.
 */
export type MemberAction = "change_role" | "remove" | "resend_confirmation";

export function memberActions(
  actorRole: StoredTeamRole | string | null,
  member: Pick<TeamMember, "role" | "user_id" | "emailConfirmed">,
  actorUserId: string | null,
): Set<MemberAction> {
  const actions = new Set<MemberAction>();

  /*
   * Yourself is not manageable from this screen, even as an owner.
   *
   * Leaving is a separate, deliberately harder action, and self-demotion from
   * a roster row is how a workspace ends up with nobody who can pay the bill.
   */
  if (member.user_id === actorUserId) return actions;

  if (canManageMember(actorRole ?? "standard", member.role)) {
    actions.add("change_role");
    actions.add("remove");
  }

  /*
   * The resend is offered to anyone who can manage the member, and only when
   * the server actually said the address is unconfirmed. `null` means it could
   * not tell, and offering a resend on a guess sends real mail to somebody who
   * did not need it.
   */
  if (member.emailConfirmed === false && actions.size > 0) {
    actions.add("resend_confirmation");
  }

  return actions;
}

/** Whether an invite has run out, which the server enforces and the row shows. */
export function isInviteExpired(invite: Pick<TeamInvite, "expires_at">, now = new Date()): boolean {
  const at = new Date(invite.expires_at);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() <= now.getTime();
}

/**
 * What the empty roster says.
 *
 * A workspace with no team is the normal starting state, not an error, and the
 * difference matters: someone who has never invited anybody should be told what
 * a team is for, not told that something failed.
 */
export function rosterEmptyBody(tier: BillingTier): string {
  return tier === "starter"
    ? "Invite your second seat and you will both see the same projects, photos and checklists."
    : "Invite the people you work with. Everyone you add sees the same projects, photos and checklists.";
}
