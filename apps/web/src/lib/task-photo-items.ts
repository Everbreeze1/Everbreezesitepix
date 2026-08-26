/*
 * Moved to `@everlumen/shared` so the mobile task screens judge photo-level
 * completion by the same rules.
 *
 * The module was already dependency-free, and the rules in it carry real bug
 * history: `photo_ids` is a plain `uuid[]` with nothing enforcing uniqueness, a
 * duplicate inflates the denominator in JavaScript but not in SQL, and
 * `completed_at`/`completed_by` are stamped by the trigger rather than sent by
 * a client that can be wrong about them. Reimplementing any of that a second
 * time for the phone is how the two clients start disagreeing about whether a
 * task is finished.
 *
 * Re-exported here so the existing imports keep working.
 */
export {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  indexTaskPhotoItems,
  isMissingTaskPhotoItems,
  taskPhotoItemErrorMessage,
  taskPhotoIds,
  taskPhotoProgress,
  taskStatusFromPhotos,
  photoIsDone,
  photoPositionInTask,
  taskWorkSummary,
  taskPhotoItemPatch,
  taskPhotoItemRows,
  type TaskPhotoStatus,
  type TaskPhotoItem,
  type TaskPhotoItemIndex,
  type TaskPhotoProgress,
  type TaskWorkSummary,
} from "@everlumen/shared";

/** Task status values, kept here because web imports them from this path. */
export type TaskStatus = "open" | "in_progress" | "done";
