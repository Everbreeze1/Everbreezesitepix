import { rpcOp } from "./sitepix-api";
import type { ProjectContributor, TeamActivityItem, TeamMemberContribution } from "@sitepix/api";

export type { ProjectContributor, TeamActivityItem, TeamMemberContribution };

export const getMyTeam = rpcOp<undefined, unknown>("getMyTeam");

export const createTeam = rpcOp<{ name: string }, unknown>("createTeam");

export const inviteMember = rpcOp<
  {
    email: string;
    role?: "admin" | "member";
    origin?: string;
  },
  unknown
>("inviteMember", { idempotent: true });

export const revokeInvite = rpcOp<{ inviteId: string }, unknown>("revokeInvite");

export const removeMember = rpcOp<{ memberId: string }, unknown>("removeMember");

export const updateMemberRole = rpcOp<{ memberId: string; role: "admin" | "member" }, unknown>(
  "updateMemberRole",
);

export const leaveTeam = rpcOp<undefined, unknown>("leaveTeam");

export const lookupInvite = rpcOp<{ token: string }, unknown>("lookupInvite");

export const acceptInvite = rpcOp<{ token: string }, unknown>("acceptInvite");

export const acceptInviteSignup = rpcOp<
  { token: string; fullName: string; password: string },
  unknown
>("acceptInviteSignup");

export const resendInvite = rpcOp<{ inviteId: string; origin?: string }, unknown>("resendInvite", {
  idempotent: true,
});

export const getTeamActivity = rpcOp<undefined, TeamActivityItem[]>("getTeamActivity");

export const getProjectContributors = rpcOp<{ projectId: string }, ProjectContributor[]>(
  "getProjectContributors",
);
