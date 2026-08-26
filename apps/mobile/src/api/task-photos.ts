import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoIds,
  taskPhotoItemPatch,
  type TaskPhotoItem,
  type TaskPhotoStatus,
} from "@everlumen/shared";
import { signPhotoUrls, type PhotoListItem } from "./photos";
import { supabase } from "@/lib/supabase";

/**
 * The photos a task covers, each with its own state.
 *
 * This answers the complaint that a multi-photo task had "all lumped into one
 * button for showing completion, no details what was done and what needs to get
 * done". The judging rules live in `@everlumen/shared` so this screen and the
 * web one cannot disagree about whether a task is finished.
 */

export type TaskPhoto = {
  id: string;
  url: string | null;
  caption: string | null;
  taken_at: string | null;
};

export type TaskPhotoState = {
  photos: TaskPhoto[];
  items: Map<string, TaskPhotoItem>;
  /** True when this workspace predates the table, so the UI can stay quiet. */
  unavailable: boolean;
};

const EMPTY: TaskPhotoState = { photos: [], items: new Map(), unavailable: false };

export async function getTaskPhotoState(
  taskId: string,
  photoIdList: string[] | null | undefined,
): Promise<TaskPhotoState> {
  /*
   * `photo_ids` is a plain `uuid[]` with nothing enforcing uniqueness. A
   * duplicate inflates the denominator here but not in SQL, so the task reads
   * done and comes back in progress. `taskPhotoIds` is the shared dedupe.
   */
  const ids = taskPhotoIds(photoIdList);
  if (ids.length === 0) return EMPTY;

  const { data: photoRows, error } = await supabase
    .from("photos")
    .select("id, caption, storage_path, thumb_path, image_url, created_at, taken_at, phase, tags")
    // Trashed photos drop out rather than showing as broken tiles, and
    // `deleted_at` has no RLS predicate behind it.
    .is("deleted_at", null)
    .in("id", ids);

  if (error) throw new Error(error.message);

  const rows = (photoRows as PhotoListItem[]) ?? [];
  const urls = await signPhotoUrls(rows);

  // Ordered by the task's own list, not by the database, so the crew sees them
  // in the order the task was written.
  const byId = new Map(rows.map((row) => [row.id, row]));
  const photos: TaskPhoto[] = ids
    .map((id) => byId.get(id))
    .filter((row): row is PhotoListItem => Boolean(row))
    .map((row) => ({
      id: row.id,
      url: urls[row.id] ?? null,
      caption: row.caption,
      taken_at: row.taken_at,
    }));

  const { data: itemRows, error: itemError } = await supabase
    .from(TASK_PHOTO_ITEMS_TABLE as never)
    .select(TASK_PHOTO_ITEM_COLUMNS)
    .eq("task_id", taskId);

  if (itemError) {
    /*
     * A workspace whose migration has not been applied answers "does not
     * exist". That is not a failure worth showing a crew: the task still works,
     * it just has no per-photo state, so the panel hides itself.
     */
    if (isMissingTaskPhotoItems(itemError)) return { photos, items: new Map(), unavailable: true };
    throw new Error(itemError.message);
  }

  const index = indexTaskPhotoItems((itemRows as TaskPhotoItem[]) ?? []);
  return { photos, items: index.get(taskId) ?? new Map(), unavailable: false };
}

/**
 * Tick or untick one photo.
 *
 * `completed_at` and `completed_by` are stamped by the trigger, never sent from
 * here: who closed something and when is a fact of the write, and a client that
 * supplies its own is a client that can be wrong about it.
 */
export async function setTaskPhotoStatus(
  taskId: string,
  photoId: string,
  status: TaskPhotoStatus,
  note?: string | null,
): Promise<void> {
  const patch = taskPhotoItemPatch(taskId, photoId, status, note);
  const { error } = await supabase
    .from(TASK_PHOTO_ITEMS_TABLE as never)
    .upsert(patch as never, { onConflict: "task_id,photo_id" });
  if (error) throw new Error(error.message);
}
