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
  setMemberProjectsService,
  getMemberProjectsService,
  getProjectAssigneesService,
  setProjectAssigneesService,
  leaveTeamService,
  lookupInviteService,
  acceptInviteService,
  acceptInviteSignupService,
  resendInviteService,
  resendMemberConfirmationService,
  getTeamActivityService,
  getProjectContributorsService,
  saveCompanyProfileService,
  dismissSetupPromptService,
} from "@sitepix/api";

export type { ProjectContributor, TeamActivityItem, TeamMemberContribution };

/** See walkthroughs.functions.ts - result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const getMyTeam = rpcOp<undefined, Result<typeof getMyTeamService>>("getMyTeam");

export const createTeam = rpcOp<{ name: string }, Result<typeof createTeamService>>("createTeam");

/**
 * The account setup answers. Every field optional - the wizard saves a step at
 * a time, and Settings saves one field at a time, so a partial payload has to
 * mean "change these" and not "these are all the answers now".
 *
 * `companyName` creates the team when the caller has none, which is the usual
 * case: a trial account has no team row until something makes one.
 */
export const saveCompanyProfile = rpcOp<
  {
    companyName?: string;
    industry?: string | null;
    trades?: string[];
    team_size?: string | null;
    project_volume?: string | null;
    goals?: string[];
    heard_from?: string | null;
    service_area?: string | null;
  },
  Result<typeof saveCompanyProfileService>
>("saveCompanyProfile");

export const dismissSetupPrompt = rpcOp<undefined, Result<typeof dismissSetupPromptService>>(
  "dismissSetupPrompt",
);

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
  // Mirrors the zod enum in the RPC registry. `owner` is absent on purpose:
  // ownership is transferred, not assigned, and the service rejects it.
  // `member` stays for older callers - the service folds it to `standard`.
  { memberId: string; role: "admin" | "manager" | "standard" | "restricted" | "member" },
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

/**
 * For a member who accepted their invite but never confirmed their email.
 * `resendInvite` refuses those - the invite is spent - so this asks GoTrue for
 * the confirmation mail again instead.
 */
export const resendMemberConfirmation = rpcOp<
  { memberId: string; origin?: string },
  Result<typeof resendMemberConfirmationService>
>("resendMemberConfirmation", { idempotent: true });

/*
 * These two were declared as bare arrays, but both services return a wrapper
 * object - `{ members, recent }` and `{ contributors }` respectively. Every
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

/**
 * Restricted-member job scoping. Separate from `updateMemberRole` because the
 * two answer different questions - which role, and which jobs - and only the
 * Restricted role has the second one.
 */
export const setMemberProjects = rpcOp<
  { memberId: string; projectIds: string[] },
  Result<typeof setMemberProjectsService>
>("setMemberProjects");

export const getMemberProjects = rpcOp<
  { memberId: string },
  Result<typeof getMemberProjectsService>
>("getMemberProjects");

/**
 * The same assignments, read from the project instead of from the person.
 *
 * `getProjectAssignees` takes a list because the projects grid draws a crew
 * stack per card and one request per card is sixty requests for one screen.
 * `canAssign` comes back with the data so the button appears exactly when the
 * write would be accepted, rather than the browser guessing from the roster.
 */
export const getProjectAssignees = rpcOp<
  { projectIds: string[] },
  Result<typeof getProjectAssigneesService>
>("getProjectAssignees");

export const setProjectAssignees = rpcOp<
  { projectId: string; userIds: string[] },
  Result<typeof setProjectAssigneesService>
>("setProjectAssignees");
