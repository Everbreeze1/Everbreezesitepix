import { api } from "@/lib/api";
import type { TrashedProject } from "./trash-view";

/**
 * The workspace trash: whole projects, not photographs.
 *
 * `project/[id]/trash.tsx` already covers deleted photos within one job. This
 * is the other level, and the phone had none of it: a job deleted on the web
 * could not be found, let alone recovered, from a device.
 *
 * Everything here is scoped to `owner_id = auth.uid()` on the server, which
 * makes the list self-consistent in a way worth relying on: whatever comes back
 * is yours, so restoring or purging it cannot silently match zero rows.
 *
 * **Deleting is deliberately not here.** The project screen already trashes a
 * job through `applyProjectPatch`, a direct RLS update. Adding a second route
 * to the same act would leave two paths with different permission behaviour,
 * which is worse than the one wart the existing path has: that update does not
 * check how many rows it changed, so if RLS refuses a non-owner it matches
 * nothing, raises no error, and the screen reports success. Worth confirming on
 * hardware with two accounts before deciding whether to fix it here or in
 * `applyProjectPatch`, which is where it belongs.
 */

export type { TrashedProject } from "./trash-view";

export async function listTrashedProjects(): Promise<TrashedProject[]> {
  const result = await api.rpc<{ projects?: TrashedProject[] }>("listTrashedProjects");
  return result.projects ?? [];
}

export type TrashCounts = { projects: number; photos: number };

export async function getTrashCounts(): Promise<TrashCounts> {
  const result = await api.rpc<Partial<TrashCounts>>("getTrashCounts");
  return { projects: result.projects ?? 0, photos: result.photos ?? 0 };
}

export async function restoreProject(projectId: string): Promise<void> {
  await api.rpc("restoreProject", { projectId });
}

/** Permanent. Removes the rows and their storage objects. */
export async function purgeProject(projectId: string): Promise<void> {
  await api.rpc("purgeProject", { projectId });
}
