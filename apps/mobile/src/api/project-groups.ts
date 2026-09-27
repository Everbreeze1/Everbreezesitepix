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

/**
 * A group as `listProjectGroups` returns it.
 *
 * **Snake case, and a count rather than the ids.** This shape is the service's,
 * not one chosen here, and an earlier version of this file guessed at
 * `projectIds` and `photoUrls`. Nothing failed loudly: `memberIds` simply
 * returned `[]` for every group, so every group read "No projects yet" whatever
 * was actually in it and no cover ever rendered. Found on the device.
 *
 * The ids themselves are not in the list response at all. `getProjectGroup`
 * has them, which is why the membership picker fetches the detail rather than
 * reading the row it was handed.
 */
export type ProjectGroup = {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  /** How many projects are in the group. */
  project_count?: number;
  /** Signed cover URLs the service picked, newest photo per project, up to 4. */
  thumbnails?: string[];
};

/** The member project ids, which only the detail op carries. */
export async function getGroupProjectIds(groupId: string): Promise<string[]> {
  const result = await api.rpc<{ projects?: { id: string }[] }>("getProjectGroup", { groupId });
  return (result?.projects ?? [])
    .map((project) => project?.id)
    .filter((id): id is string => typeof id === "string");
}

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

/** A checklist on a project in a group, with its items. */
export type GroupChecklist = {
  id: string;
  name: string;
  total: number;
  done: number;
  items: { id: string; label: string; completed_at: string | null; position: number }[];
};

export type GroupTask = {
  id: string;
  title: string;
  status: string;
  priority: string | null;
  due_date: string | null;
};

/** A member project as `getProjectGroup` returns it: the row plus its rollups. */
export type GroupProject = {
  id: string;
  name: string;
  status: string;
  client_name: string | null;
  location: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  updated_at: string;
  cover_url: string | null;
  photo_count: number;
  report_count: number;
  checklists: GroupChecklist[];
  checklist_items_total: number;
  checklist_items_done: number;
  tasks: GroupTask[];
  tasks_open: number;
};

export type GroupDetail = {
  group: { id: string; name: string; description: string | null };
  projects: GroupProject[];
  totals: { projects: number; photos: number; reports: number; checklists: number; tasks: number };
};

/**
 * One group, with every project's checklists and tasks.
 *
 * The same op the web group page reads. Defaulted field by field, so a shape
 * change on the service is a missing number here rather than a crash.
 */
export async function getProjectGroupDetail(groupId: string): Promise<GroupDetail> {
  const result = await api.rpc<Partial<GroupDetail>>("getProjectGroup", { groupId });
  const projects = (result?.projects ?? []).map((project) => ({
    ...project,
    checklists: project.checklists ?? [],
    tasks: project.tasks ?? [],
    photo_count: project.photo_count ?? 0,
    report_count: project.report_count ?? 0,
    checklist_items_total: project.checklist_items_total ?? 0,
    checklist_items_done: project.checklist_items_done ?? 0,
    tasks_open: project.tasks_open ?? 0,
  }));
  return {
    group: result?.group ?? { id: groupId, name: "Group", description: null },
    projects,
    totals: result?.totals ?? {
      projects: projects.length,
      photos: 0,
      reports: 0,
      checklists: 0,
      tasks: 0,
    },
  };
}
