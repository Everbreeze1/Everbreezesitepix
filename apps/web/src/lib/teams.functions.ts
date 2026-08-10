import { rpcOp } from "./sitepix-api";
import type {
  ProjectContributor,
  TeamActivityItem,
  TeamMemberContribution,
  getMyTeamService,
  createTeamService,
  inviteMemberService,
  revokeInviteService,
  removeMemberService,
  updateMemberRoleService,
  leaveTeamService,
  lookupInviteService,
  acceptInviteService,
  acceptInviteSignupService,
  resendInviteService,
  getTeamActivityService,
  getProjectContributorsService,
} from "@sitepix/api";

export type { ProjectContributor, TeamActivityItem, TeamMemberContribution };

/** See walkthroughs.functions.ts — result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const getMyTeam = rpcOp<undefined, Result<typeof getMyTeamService>>("getMyTeam");

export const createTeam = rpcOp<{ name: string }, Result<typeof createTeamService>>("createTeam");

export const inviteMember = rpcOp<
  {
    email: string;
    role?: "admin" | "member";
    origin?: string;
  },
  Result<typeof inviteMemberService>
>("inviteMember", { idempotent: true });

export const revokeInvite = rpcOp<{ inviteId: string }, Result<typeof revokeInviteService>>(
  "revokeInvite",
);

export const removeMember = rpcOp<{ memberId: string }, Result<typeof removeMemberService>>(
  "removeMember",
);

export const updateMemberRole = rpcOp<
  { memberId: string; role: "admin" | "member" },
  Result<typeof updateMemberRoleService>
>("updateMemberRole");

export const leaveTeam = rpcOp<undefined, Result<typeof leaveTeamService>>("leaveTeam");

export const lookupInvite = rpcOp<{ token: string }, Result<typeof lookupInviteService>>(
  "lookupInvite",
);

export const acceptInvite = rpcOp<{ token: string }, Result<typeof acceptInviteService>>(
  "acceptInvite",
);

export const acceptInviteSignup = rpcOp<
  { token: string; fullName: string; password: string },
  Result<typeof acceptInviteSignupService>
>("acceptInviteSignup");

export const resendInvite = rpcOp<
  { inviteId: string; origin?: string },
  Result<typeof resendInviteService>
>("resendInvite", { idempotent: true });

/*
 * These two were declared as bare arrays, but both services return a wrapper
 * object — `{ members, recent }` and `{ contributors }` respectively. Every
 * call site already cast the result back to the real shape, which is what kept
 * the mistake invisible. Deriving from the service keeps the two in step.
 */
export const getTeamActivity = rpcOp<undefined, Result<typeof getTeamActivityService>>(
  "getTeamActivity",
);

export const getProjectContributors = rpcOp<
  { projectId: string },
  Result<typeof getProjectContributorsService>
>("getProjectContributors");
