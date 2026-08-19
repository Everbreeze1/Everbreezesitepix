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
  setMemberProjects,
  getMemberProjects,
  getProjectAssignees,
  setProjectAssignees,
  leaveTeam,
  resendInvite,
  resendMemberConfirmation,
  getTeamActivity,
  getProjectContributors,
  acceptInvite,
  acceptInviteSignup,
  lookupInvite,
  saveCompanyProfile,
  dismissSetupPrompt,
} from "@/lib/teams.functions";
export type {
  ProjectContributor,
  TeamActivityItem,
  TeamMemberContribution,
} from "@/lib/teams.functions";
export { createCheckoutSession, createBillingPortalSession } from "@/lib/billing.functions";
export type { BillingPlan } from "@/lib/billing.functions";
