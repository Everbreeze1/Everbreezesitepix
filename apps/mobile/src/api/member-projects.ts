import { api } from "@/lib/api";

/**
 * Which jobs a Restricted member is allowed on.
 *
 * The phone could already demote somebody to Restricted and had no way to say
 * which jobs they may see, which leaves that person fenced to NOTHING until
 * somebody opens the web. Half a permission change is worse than none: the
 * manager thinks they have scoped a colleague, and the colleague opens the app
 * to an empty list.
 *
 * The same `project_assignments` table as the project crew, read from the other
 * end. Putting a Restricted member on a job both staffs it and grants them
 * sight of it - there is no second table and no separate idea of "visible but
 * not assigned", which is worth knowing before wondering why the two screens
 * move together.
 */

export type MemberProjects = { projectIds: string[] };

export async function getMemberProjects(memberId: string): Promise<string[]> {
  const result = await api.rpc<Partial<MemberProjects>>("getMemberProjects", { memberId });
  return result?.projectIds ?? [];
}

export async function setMemberProjects(memberId: string, projectIds: string[]): Promise<void> {
  // Empty is allowed and is the point: taking every job away is how a
  // Restricted member is parked without being removed from the team.
  await api.rpc("setMemberProjects", { memberId, projectIds });
}
