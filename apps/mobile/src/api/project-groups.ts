import { api } from "@/lib/api";

/**
 * Project groups: user-owned collections of jobs.
 *
 * Through `/v1/rpc` throughout, because `listProjectGroups` does considerably
 * more than read a table: it joins the membership rows, picks a recent photo
 * per project and signs the storage URLs for them. Reassembling that from the
 * client would be three round trips and a second copy of the cover-photo rule.
 *
 * Groups are **owner-scoped**, not team-scoped. The RLS policy is
 * `owner_id = auth.uid()` with no teammate clause, so these are one person's
 * own filing rather than something a crew shares. Worth knowing before anybody
 * wires this into a screen that talks about "the team's groups": it would be
 * describing something the data does not do.
 */

export type ProjectGroup = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  /** Project ids in the group. The service attaches these to every row. */
  projectIds?: string[];
  /** Cover thumbnails the service picked and signed, newest photo per project. */
  photoUrls?: string[];
};

export async function listProjectGroups(): Promise<ProjectGroup[]> {
  const result = await api.rpc<{ groups?: ProjectGroup[] }>("listProjectGroups");
  return result?.groups ?? [];
}

export async function createProjectGroup(args: {
  name: string;
  description: string | null;
  projectIds: string[];
}): Promise<ProjectGroup> {
  const result = await api.rpc<{ group?: ProjectGroup } & ProjectGroup>("createProjectGroup", {
    name: args.name,
    description: args.description,
    projectIds: args.projectIds,
  });
  // The op has returned both shapes across its life. Defaulting rather than
  // guessing means a shape change is a missing name, not a crash.
  return (result?.group ?? result) as ProjectGroup;
}

export async function updateProjectGroup(
  id: string,
  patch: { name?: string; description?: string | null },
): Promise<void> {
  await api.rpc("updateProjectGroup", { id, ...patch });
}

export async function deleteProjectGroup(id: string): Promise<void> {
  await api.rpc("deleteProjectGroup", { id });
}

/**
 * Replace the whole membership list.
 *
 * A set, not an add or a remove, which is what the op offers and is the right
 * shape for a phone: the picker shows every project with a tick beside the ones
 * in the group, and saving sends what the person can see rather than a diff
 * they never expressed.
 */
export async function setGroupProjects(groupId: string, projectIds: string[]): Promise<void> {
  await api.rpc("setGroupProjects", { groupId, projectIds });
}
