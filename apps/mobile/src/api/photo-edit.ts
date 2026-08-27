import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { chunkIds, type PhotoPatch } from "./photo-patch";
import type { PhotoListItem } from "./photos";

/**
 * Editing photos after they have been captured.
 *
 * Separate from `photos.ts`, which is capture and reads. Everything here is a
 * mutation over a set of ids, because that is the shape the field needs: a
 * person tags twenty photos as "after" in one go far more often than one at a
 * time.
 *
 * The write contracts are the web app's, deliberately. `PhotoBulkActionBar.tsx`
 * trashes with `deleted_at`, moves with `project_id`, and tags with `tags`, all
 * as direct RLS updates. A mobile-only convention here would produce rows the
 * web gallery renders differently.
 *
 * The patch shapes themselves live in `photo-patch.ts`, which has no imports so
 * it can be tested. This file is only the part that talks to the network.
 */

export {
  chunkIds,
  mergeTags,
  phasePatch,
  PHOTO_IN_CHUNK_SIZE,
  restorePhotos,
  trashPhotos,
  withoutTag,
  type PhotoPatch,
  type PhotoPhaseValue,
} from "./photo-patch";

/**
 * Apply one patch to many photos.
 *
 * Errors throw rather than being returned. A bulk action that half-failed and
 * reported success is the worst outcome here: the grid would show the change,
 * the database would not have it, and nobody would know which photos were
 * actually written until a report came out wrong.
 */
export async function applyPhotoPatch(ids: string[], patch: PhotoPatch): Promise<void> {
  for (const idChunk of chunkIds(ids)) {
    const { error } = await supabase
      .from("photos")
      .update(patch as never)
      .in("id", idChunk);
    if (error) throw new Error(error.message);
  }
}

export type TrashedPhoto = {
  id: string;
  storage_path: string;
  image_url: string | null;
  caption: string | null;
  tags: string[] | null;
  taken_at: string | null;
  created_at: string;
  deleted_at: string;
};

/**
 * What is in a project's trash.
 *
 * Read through `/v1` rather than directly, because the op already exists and
 * already caps the result at 500. A client-side read would have to reproduce
 * that cap and would drift from it.
 */
export async function listTrashedPhotos(projectId: string): Promise<TrashedPhoto[]> {
  const result = await api.rpc("listTrashedPhotos", { projectId });
  const rows = (result as { photos?: TrashedPhoto[] } | TrashedPhoto[]) ?? [];
  return Array.isArray(rows) ? rows : (rows.photos ?? []);
}

/** Narrows a trashed row to the shape the photo grid and signing helpers expect. */
export function asPhotoListItem(photo: TrashedPhoto): PhotoListItem {
  return {
    id: photo.id,
    caption: photo.caption,
    storage_path: photo.storage_path,
    // The trash read does not select `thumb_path`, so signing falls back to the
    // original. Acceptable on a screen showing at most 500 rows that someone is
    // about to restore.
    thumb_path: null,
    image_url: photo.image_url,
    created_at: photo.created_at,
    taken_at: photo.taken_at,
    phase: null,
    tags: photo.tags,
  };
}
