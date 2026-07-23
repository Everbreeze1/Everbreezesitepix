/**
 * Privileged team ops via `/v1/rpc`.
 * Prefer importing from here inside the teams feature.
 */
export {
  getMyTeam,
  createTeam,
  inviteMember,
  revokeInvite,
  removeMember,
  updateMemberRole,
  leaveTeam,
  setTeamPlan,
  resendInvite,
  getTeamActivity,
  getProjectContributors,
  acceptInvite,
  acceptInviteSignup,
  lookupInvite,
} from "@/lib/teams.functions";
export type {
  ProjectContributor,
  TeamActivityItem,
  TeamMemberContribution,
} from "@/lib/teams.functions";
