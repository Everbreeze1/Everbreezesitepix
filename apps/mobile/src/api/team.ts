import { randomUUID } from "expo-crypto";
import { api } from "@/lib/api";
import type { BillingTier } from "@everlumen/shared/team-permissions";
import type { TeamInvite, TeamMember } from "./team-roster";

/**
 * Team administration.
 *
 * Every one of these is an existing `/v1/rpc` op, and none of them could be a
 * direct RLS write. Inviting sends mail and mints a token with the service
 * role; removing a member has to detach their project assignments in the same
 * breath; re-roling is gated on the caller's own role and the team's plan.
 * These are the operations the API layer exists for.
 *
 * Nothing here goes through the offline outbox, and that is a decision rather
 * than an omission. The queue exists so field work survives a basement, and
 * team administration is not field work: it is done once, deliberately, and an
 * invite that silently sends itself twenty minutes later when signal returns is
 * worse than one that fails and says so.
 */

export type Team = {
  id: string;
  name: string | null;
  plan: string | null;
  subscription_status: string | null;
  member_limit: number | null;
};

export type MyTeam = {
  team: Team | null;
  members: TeamMember[];
  invites: TeamInvite[];
  myRole: string | null;
  plan: BillingTier;
  memberLimit: number;
  subscriptionStatus: string;
  isActive: boolean;
};

/**
 * The whole roster in one call.
 *
 * The op assembles it with the service role: profiles and email-confirmation
 * state live in tables a client cannot read, so a direct query would give a
 * list of uuids with no names on it.
 */
export async function getMyTeam(): Promise<MyTeam> {
  const result = await api.rpc<Partial<MyTeam>>("getMyTeam");
  return {
    team: result?.team ?? null,
    members: result?.members ?? [],
    invites: result?.invites ?? [],
    myRole: result?.myRole ?? null,
    // Defaulted the same way the server defaults them, so somebody with no
    // team sees an empty roster rather than a crash.
    plan: (result?.plan as BillingTier) ?? "starter",
    memberLimit: result?.memberLimit ?? 2,
    subscriptionStatus: result?.subscriptionStatus ?? "inactive",
    isActive: result?.isActive ?? false,
  };
}

export async function inviteMember(email: string, role: "admin" | "member"): Promise<void> {
  await api.rpc("inviteMember", { email, role }, { idempotencyKey: randomUUID() });
}

export async function revokeInvite(inviteId: string): Promise<void> {
  await api.rpc("revokeInvite", { inviteId });
}

export async function resendInvite(inviteId: string): Promise<void> {
  await api.rpc("resendInvite", { inviteId }, { idempotencyKey: randomUUID() });
}

export async function resendMemberConfirmation(memberId: string): Promise<void> {
  await api.rpc("resendMemberConfirmation", { memberId }, { idempotencyKey: randomUUID() });
}

export async function removeMember(memberId: string): Promise<void> {
  await api.rpc("removeMember", { memberId });
}

/**
 * `member` is still accepted by the server as the historical spelling of
 * `standard`, and the service normalises it. Mobile always sends the current
 * name.
 */
export async function updateMemberRole(
  memberId: string,
  role: "admin" | "manager" | "standard" | "restricted",
): Promise<void> {
  await api.rpc("updateMemberRole", { memberId, role });
}

export async function leaveTeam(): Promise<void> {
  await api.rpc("leaveTeam");
}
