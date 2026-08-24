import { rpcOp } from "./everlumen-api";
import type {
  inviteSubcontractorService,
  listSubcontractorsService,
  setSubcontractorProjectsService,
  revokeSubcontractorService,
  lookupSubcontractorInviteService,
  acceptSubcontractorInviteService,
  acceptSubcontractorInviteSignupService,
} from "@everlumen/api";

/**
 * Subcontractor access (Team tier) via `/v1/rpc`.
 *
 * Separate from teams.functions.ts on purpose: a subcontractor is deliberately
 * NOT a team member - they hold no seat and live in their own tables - and
 * keeping the two client modules apart makes that hard to forget at the call
 * site. See apps/api/src/domains/subcontractors/service.ts.
 */

/** See walkthroughs.functions.ts - result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const inviteSubcontractor = rpcOp<
  { email: string; companyName?: string; projectIds: string[]; origin?: string },
  Result<typeof inviteSubcontractorService>
>("inviteSubcontractor");

export const listSubcontractors = rpcOp<undefined, Result<typeof listSubcontractorsService>>(
  "listSubcontractors",
);

export const setSubcontractorProjects = rpcOp<
  { subcontractorId: string; projectIds: string[] },
  Result<typeof setSubcontractorProjectsService>
>("setSubcontractorProjects");

export const revokeSubcontractor = rpcOp<
  { subcontractorId: string },
  Result<typeof revokeSubcontractorService>
>("revokeSubcontractor");

export const lookupSubcontractorInvite = rpcOp<
  { token: string },
  Result<typeof lookupSubcontractorInviteService>
>("lookupSubcontractorInvite");

export const acceptSubcontractorInvite = rpcOp<
  { token: string },
  Result<typeof acceptSubcontractorInviteService>
>("acceptSubcontractorInvite");

export const acceptSubcontractorInviteSignup = rpcOp<
  { token: string; fullName: string; password: string },
  Result<typeof acceptSubcontractorInviteSignupService>
>("acceptSubcontractorInviteSignup");
