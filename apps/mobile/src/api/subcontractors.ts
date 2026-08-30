import { api } from "@/lib/api";
import type { Subcontractor } from "./subcontractor-view";

/**
 * Subcontractor access: a login for somebody outside the workspace, scoped to
 * named jobs.
 *
 * Every one of these goes through `/v1/rpc`, and none of them could be a client
 * write. The service runs `requireTeamAdmin` and then works with the **service
 * role**: it reads `team_members` to check the caller's role, verifies every
 * project belongs to the caller's team before linking it, mints an invite token
 * and sends mail. A client doing any of that would be a client deciding who can
 * see what.
 *
 * That is also why there is no optimistic update anywhere here. Handing out
 * access is the one place in this app where showing a state the server has not
 * confirmed would be actively dangerous: an admin who sees "revoked" and walks
 * away, on a write that failed, has a stranger still holding a key.
 */

export async function listSubcontractors(): Promise<Subcontractor[]> {
  const result = await api.rpc<{ subcontractors?: Subcontractor[] }>("listSubcontractors");
  return result?.subcontractors ?? [];
}

/**
 * Invite a firm, scoped to the jobs chosen.
 *
 * `projectIds` is `min(1)` on the op. There is no "invite now, scope later"
 * path, deliberately: it would mean a live login existing for a period with
 * nobody having decided what it can see.
 */
export async function inviteSubcontractor(args: {
  email: string;
  companyName?: string;
  projectIds: string[];
}): Promise<void> {
  await api.rpc("inviteSubcontractor", {
    email: args.email,
    ...(args.companyName ? { companyName: args.companyName } : {}),
    projectIds: args.projectIds,
  });
}

/**
 * Replace the whole list of jobs a firm can see.
 *
 * A set, not an add or a remove, matching the op. Empty **is** allowed here and
 * is not allowed on invite: taking the last job away is how a firm is parked
 * without revoking them, which is a thing admins do between phases of work.
 */
export async function setSubcontractorProjects(
  subcontractorId: string,
  projectIds: string[],
): Promise<void> {
  await api.rpc("setSubcontractorProjects", { subcontractorId, projectIds });
}

/** End a firm's access entirely. Their login stops working. */
export async function revokeSubcontractor(subcontractorId: string): Promise<void> {
  await api.rpc("revokeSubcontractor", { subcontractorId });
}
