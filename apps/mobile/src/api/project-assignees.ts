import { api } from "@/lib/api";
import { getMyTeam } from "./team";
import type { AssigneeMap, CrewCandidate } from "./project-assignees-view";

/**
 * The crew on a job.
 *
 * Two existing `/v1/rpc` ops the phone never called, and neither could be a
 * direct RLS write. Setting the crew proves team ownership with the service
 * role, so a pasted id from another company is refused; it validates every id
 * against `team_members`, so somebody who has left cannot be resurrected; and
 * it notifies the people it just added, diffing against what was there so
 * re-saving does not light up the whole crew again.
 *
 * The loop already closes at the other end: `project_assigned` is a
 * `NotificationType` the phone already routes. It just had no way to raise one.
 *
 * Not queued through the outbox. Assigning somebody sends them a push, and a
 * push that arrives twenty minutes late because signal returned - possibly
 * after the crew has changed again - is worse than a save that fails and says
 * so.
 */

export type { CrewCandidate } from "./project-assignees-view";

export type ProjectCrew = {
  /** User ids on this job, in the order the server returned them. */
  assigned: string[];
  /**
   * The server's own answer to whether this caller may change it.
   *
   * Taken rather than re-derived. The service returns it precisely so the
   * button appears if and only if the write would be accepted.
   */
  canAssign: boolean;
};

export async function getProjectCrew(projectId: string): Promise<ProjectCrew> {
  const result = await api.rpc<{ byProject?: AssigneeMap; canAssign?: boolean }>(
    "getProjectAssignees",
    // Takes an array even for one project: the list screen asks for a page of
    // them at once, and this is the same op paying for exactly what it needs.
    { projectIds: [projectId] },
  );
  return {
    assigned: result.byProject?.[projectId] ?? [],
    canAssign: Boolean(result.canAssign),
  };
}

export async function setProjectCrew(projectId: string, userIds: string[]): Promise<void> {
  // Whole-set, not add/remove: the sheet is a list of tickboxes and sending the
  // ticked set is what makes an untick a real instruction. Empty is legitimate,
  // and is how a job is unstaffed.
  await api.rpc("setProjectAssignees", { projectId, userIds });
}

/** Everybody who could be put on a job: the team roster. */
export async function listCrewCandidates(): Promise<CrewCandidate[]> {
  const team = await getMyTeam();
  return team.members.map((member) => ({
    userId: member.user_id,
    fullName: member.profile?.full_name ?? null,
    email: member.profile?.email ?? null,
    avatarUrl: member.profile?.avatar_url ?? null,
    role: member.role,
  }));
}
