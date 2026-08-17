/**
 * A task spread over several photos, said once.
 *
 * `tasks.photo_ids` is a uuid[] and `tasks.status` is a single column, so until
 * now a job raised against twelve photos had one state covering all twelve. The
 * photo viewer's circle wrote that column, which meant ticking the work off on
 * the third photo closed it on the other eleven; the project tab had one pill
 * per task and no way to say which photos were handled.
 *
 * `task_photo_items` (supabase/migrations/20260906000000_task_photo_items.sql)
 * holds the per-photo half: done or not, what was done, by whom. This module is
 * the client-side mirror of the rollup in that migration -
 * `taskStatusFromPhotos` is `task_photo_rollup_status` in the same order with
 * the same branches - so a row updates optimistically to exactly the state the
 * database is about to write. If one changes, change both.
 *
 * Membership stays in `photo_ids`. Nothing here decides which photos a task
 * covers; it only reports what has happened to them.
 */

export type TaskStatus = "open" | "in_progress" | "done";
export type TaskPhotoStatus = "open" | "done";

export const TASK_PHOTO_ITEMS_TABLE = "task_photo_items";

/** The columns every caller selects. One spelling, so the shapes agree. */
export const TASK_PHOTO_ITEM_COLUMNS =
  "task_id, photo_id, status, note, completed_by, completed_at, updated_at";

export interface TaskPhotoItem {
  task_id: string;
  photo_id: string;
  status: TaskPhotoStatus;
  /** What was done to this photo, in the words of whoever closed it. */
  note: string | null;
  completed_by: string | null;
  completed_at: string | null;
  updated_at?: string | null;
}

/** task id -> photo id -> item. Built once per load, read per row. */
export type TaskPhotoItemIndex = Map<string, Map<string, TaskPhotoItem>>;

export function indexTaskPhotoItems(items: TaskPhotoItem[]): TaskPhotoItemIndex {
  const index: TaskPhotoItemIndex = new Map();
  items.forEach((item) => {
    let byPhoto = index.get(item.task_id);
    if (!byPhoto) {
      byPhoto = new Map();
      index.set(item.task_id, byPhoto);
    }
    byPhoto.set(item.photo_id, item);
  });
  return index;
}

/**
 * Postgres and PostgREST codes that really do mean "that table is not there".
 *
 * `42P01` is Postgres' undefined_table, which older PostgREST passes through as
 * `relation "public.x" does not exist`. Current versions answer from the schema
 * cache instead and return `PGRST205` with a different sentence, so both have to
 * be listed or the guard only works on one deployment.
 */
const MISSING_TABLE_CODES = new Set(["42P01", "PGRST205"]);

/**
 * The table is created by a migration the operator pastes into the SQL editor,
 * the way every other table in this project is, so the app has to survive the
 * window between deploying the code and running it. Same shape as the guard the
 * tasks panels already use around `tasks` itself: a missing table is not an
 * error worth showing a crew member, it just means no per-photo detail yet.
 *
 * Keyed on the error CODE, not on the message text.
 *
 * The message test this replaces asked whether the text mentioned
 * `task_photo_items` - and every error Postgres raises about a table names that
 * table. So a row-level-security refusal (`new row violates row-level security
 * policy for table "task_photo_items"`) and a foreign key violation
 * (`insert or update on table "task_photo_items" violates ...`) both matched, and
 * both callers that guard a WRITE with this would answer them by turning the
 * per-photo UI off for the session and telling the user to run a migration that
 * is already applied. A teammate whose access had lapsed would be sent to the SQL
 * editor; a tick that the database refused would look like a missing feature.
 *
 * An unrecognised code now falls through and the real message is shown, which for
 * a genuinely missing table is `Could not find the table 'public.task_photo_items'
 * in the schema cache` - already the clearest possible instruction.
 */
export function isMissingTaskPhotoItems(
  error: { message?: string; code?: string } | null | undefined,
): boolean {
  const code = String(error?.code ?? "");
  if (code) return MISSING_TABLE_CODES.has(code);
  // No code at all: a transport-level failure or a hand-rolled error object.
  // Fall back to the two sentences the server uses for a missing relation.
  const message = String(error?.message ?? "");
  return /does not exist|schema cache/i.test(message);
}

export interface TaskPhotoProgress {
  /** Photos the task covers, from `photo_ids`. */
  total: number;
  done: number;
  remaining: number;
  /** True once the task is worth breaking down, which is the case this exists for. */
  isMulti: boolean;
  /** 0 to 100, for the bar. 0 when the task carries no photos. */
  percent: number;
  /** "5 of 12 photos done", or "Done" / "Not started" at the ends. */
  label: string;
  /** The short form that fits inside a row pill: "5/12". */
  shortLabel: string;
}

export function taskPhotoProgress(
  photoIds: string[] | null | undefined,
  itemsForTask?: Map<string, TaskPhotoItem> | null,
): TaskPhotoProgress {
  /*
   * Deduplicated, matching `task_photo_rollup_status`.
   *
   * `photo_ids` is a uuid[] with no uniqueness behind it, and the table it is
   * counted against is keyed (task_id, photo_id) - so one photo listed twice can
   * only ever have one row. Walking the raw array counted that photo twice and
   * the SQL counted it once, which put the two halves into disagreement in the
   * one place they exist to agree: the tick showed the task done and the reload
   * put it back to in progress. Counting distinct photos is also simply what
   * "which photos are handled" means.
   */
  const ids = Array.from(new Set(photoIds ?? []));
  const total = ids.length;
  /*
   * Counted over `photo_ids` rather than over the item rows, matching the SQL.
   * An item left behind by a photo since dropped from the task must not count,
   * or a task reads "12 of 11" and can never be finished.
   */
  const done = ids.reduce((n, id) => n + (itemsForTask?.get(id)?.status === "done" ? 1 : 0), 0);
  const remaining = total - done;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);

  let label: string;
  if (total === 0) label = "";
  else if (done === 0) label = `0 of ${total} photos done`;
  else if (done === total) label = total === 1 ? "Photo done" : `All ${total} photos done`;
  else label = `${done} of ${total} photos done`;

  return {
    total,
    done,
    remaining,
    isMulti: total > 1,
    percent,
    label,
    shortLabel: total === 0 ? "" : `${done}/${total}`,
  };
}

/**
 * The status the database is about to derive, so an optimistic row shows what a
 * reload would.
 *
 * Mirror of `task_photo_rollup_status`. A task carrying no photos keeps the
 * status it was given: nothing rolls up, and that is the majority of tasks.
 */
export function taskStatusFromPhotos(
  photoIds: string[] | null | undefined,
  itemsForTask: Map<string, TaskPhotoItem> | null | undefined,
  current: TaskStatus,
): TaskStatus {
  const { total, done } = taskPhotoProgress(photoIds, itemsForTask);
  if (total === 0) return current;
  if (done >= total) return "done";
  if (done > 0) return "in_progress";
  if (current === "done") return "open";
  return current;
}

/** Whether this one photo is outstanding on this one task. */
export function photoIsDone(
  itemsForTask: Map<string, TaskPhotoItem> | null | undefined,
  photoId: string,
): boolean {
  return itemsForTask?.get(photoId)?.status === "done";
}

/**
 * Where a photo sits in its task, for the line under a title in the photo
 * viewer. The point is that a crew member looking at one picture can see the
 * job is bigger than the picture, which is exactly what the single shared
 * status column used to hide from them.
 *
 * Null when the task covers this photo alone, because "1 of 1" is noise.
 */
export function photoPositionInTask(
  photoIds: string[] | null | undefined,
  photoId: string,
  itemsForTask?: Map<string, TaskPhotoItem> | null,
): string | null {
  // Deduplicated for the same reason `taskPhotoProgress` is: the position and
  // the total both have to be counted in photos, or "Photo 3 of 2" is reachable.
  const ids = Array.from(new Set(photoIds ?? []));
  if (ids.length <= 1) return null;
  const position = ids.indexOf(photoId);
  if (position < 0) return null;
  const { done, total } = taskPhotoProgress(ids, itemsForTask);
  return `Photo ${position + 1} of ${total} in this task, ${done} done`;
}

export interface TaskWorkSummary {
  /** Notes left on photos that are closed, newest write last. Never blanks. */
  done: string[];
  /** How many closed photos carried no note. */
  doneWithoutNote: number;
  /** Photos still outstanding. */
  remaining: number;
}

/**
 * "What was done and what needs to get done", which is the sentence the client
 * used and the thing a single completion pill could not express.
 */
export function taskWorkSummary(
  photoIds: string[] | null | undefined,
  itemsForTask?: Map<string, TaskPhotoItem> | null,
): TaskWorkSummary {
  // Deduplicated, so a photo listed twice is not reported as two outstanding
  // jobs or its note read out twice. Same rule as `taskPhotoProgress`.
  const ids = Array.from(new Set(photoIds ?? []));
  const notes: string[] = [];
  let doneWithoutNote = 0;
  let remaining = 0;

  ids.forEach((id) => {
    const item = itemsForTask?.get(id);
    if (item?.status === "done") {
      const note = item.note?.trim();
      if (note) notes.push(note);
      else doneWithoutNote += 1;
    } else {
      remaining += 1;
    }
  });

  return { done: notes, doneWithoutNote, remaining };
}

/**
 * The row to upsert when a photo is ticked or unticked.
 *
 * `completed_at` and `completed_by` are stamped by the trigger, not sent from
 * here: who closed something and when is a fact of the write, and a client that
 * supplies its own is a client that can be wrong about it.
 */
export function taskPhotoItemPatch(
  taskId: string,
  photoId: string,
  status: TaskPhotoStatus,
  note?: string | null,
): { task_id: string; photo_id: string; status: TaskPhotoStatus; note: string | null } {
  return {
    task_id: taskId,
    photo_id: photoId,
    status,
    note: note?.trim() ? note.trim() : null,
  };
}
