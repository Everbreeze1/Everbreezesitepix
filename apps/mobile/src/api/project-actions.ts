import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { ProjectListItem } from "./projects";

/**
 * The project header's organise actions, as the web `ProjectActionsMenu` runs
 * them: file a job under a group, fold it into another job, and open its site
 * in Maps.
 *
 * Group membership and the merge go through `/v1/rpc` for the same reasons the
 * web gives. `addProjectToGroup` checks the caller may see both rows, and
 * `combineProjects` moves every project-scoped table with the service role
 * before deleting the source, which is not something a client should attempt
 * one table at a time over RLS.
 */

export type MergeTarget = {
  id: string;
  name: string;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
};

/** The groups this job is already filed under, so the sheet can tick them. */
export async function listProjectGroupMemberships(projectId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("project_group_members" as never)
    .select("group_id")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return ((data as { group_id: string }[] | null) ?? []).map((row) => row.group_id);
}

export async function addProjectToGroup(groupId: string, projectId: string): Promise<void> {
  await api.rpc("addProjectToGroup", { groupId, projectId });
}

/**
 * Jobs this one can be merged into.
 *
 * Only jobs the viewer created, as on the web: `combineProjectsService`
 * refuses a pair unless both rows are the caller's own, so listing a
 * teammate's job here would offer a merge the server is certain to reject.
 */
export async function listMergeTargets(projectId: string): Promise<MergeTarget[]> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (!userId) throw new Error("Not signed in");
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, street, city, state, zip")
    .eq("created_by", userId)
    .is("deleted_at", null)
    .neq("id", projectId)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as MergeTarget[] | null) ?? [];
}

/** Move everything on `sourceId` into `targetId` and remove the source. */
export async function combineProjects(sourceId: string, targetId: string): Promise<string> {
  const result = await api.rpc<{ targetId?: string }>("combineProjects", { sourceId, targetId });
  return result?.targetId ?? targetId;
}

/** "Oak St, Sacramento, CA" for a merge row, or null when there is no address. */
export function mergeTargetAddress(target: MergeTarget): string | null {
  return [target.street, target.city, target.state, target.zip].filter(Boolean).join(", ") || null;
}

/** Narrow merge targets by name or address, every word must match. */
export function searchMergeTargets(targets: MergeTarget[], query: string): MergeTarget[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return targets;
  return targets.filter((target) => {
    const haystack = `${target.name} ${mergeTargetAddress(target) ?? ""}`.toLowerCase();
    return words.every((word) => haystack.includes(word));
  });
}

/**
 * A Google Maps link for the job site, the one the web menu opens.
 *
 * The pin wins over the address when there is one: it is where the crew
 * actually stood, and an address search can land on the wrong side of a big
 * lot. Null when the job has neither, so the menu can leave the row out.
 */
export function projectMapsUrl(
  project: Pick<
    ProjectListItem,
    "latitude" | "longitude" | "street" | "city" | "state" | "zip" | "location"
  >,
): string | null {
  if (project.latitude != null && project.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${project.latitude},${project.longitude}`;
  }
  const address =
    [project.street, project.city, project.state, project.zip].filter(Boolean).join(", ") ||
    project.location;
  if (!address) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
