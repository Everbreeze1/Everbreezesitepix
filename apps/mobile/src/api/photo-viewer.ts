import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import {
  TASK_PHOTO_ITEMS_TABLE,
  TASK_PHOTO_ITEM_COLUMNS,
  isMissingTaskPhotoItems,
  type TaskPhotoItem,
} from "@everlumen/shared";
import { supabase } from "@/lib/supabase";
import { signPhotoUrls, type PhotoListItem } from "./photos";
import type { TaskRow } from "./tasks";

/**
 * Reads and writes behind the photo viewer that no other screen needed.
 *
 * The grids hand the viewer a `PhotoListItem`, which is what a tile needs and
 * no more. The details panel also wants where the photo was taken and who took
 * it, the full-size original rather than the grid's thumbnail, the workspace
 * tag library with its colours, and the tasks that cover this one photo. Each is
 * fetched for the photo on screen only, so paging through two hundred photos
 * costs one small read per photo actually looked at.
 */

/**
 * A grid row plus the columns the details panel shows that a grid row does not
 * carry. A whole row, so a photo opened by deep link before its grid page has
 * loaded can still be drawn from this alone.
 */
export type PhotoDetail = PhotoListItem & {
  project_id: string;
  latitude: number | null;
  longitude: number | null;
  uploaded_by: string | null;
};

export async function getPhotoDetail(photoId: string): Promise<PhotoDetail | null> {
  const { data, error } = await supabase
    .from("photos")
    .select(
      "id, project_id, caption, storage_path, thumb_path, image_url, tags, phase, latitude, longitude, uploaded_by, taken_at, created_at",
    )
    .eq("id", photoId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PhotoDetail | null) ?? null;
}

/**
 * The original file, signed, for zooming in.
 *
 * Grids sign the 1400px thumbnail, which is the right call for a tile and the
 * wrong one for a pinch-zoom onto a rating plate. The thumbnail stays on screen
 * as the placeholder while this loads, so nothing goes blank.
 */
export async function signOriginal(photo: PhotoListItem): Promise<string | null> {
  const urls = await signPhotoUrls([photo], false);
  return urls[photo.id] ?? null;
}

/* ------------------------------------------------------------------- tags */

export type LibraryTag = { id: string; name: string; color: string | null };

/**
 * The workspace tag library, the same `tags` table web's picker lists.
 *
 * Tags are shared across projects, so a tag made on one job is offered on
 * every other; this is why the picker reads the library rather than whatever
 * tags happen to be on this project's photos.
 */
export async function listTagLibrary(): Promise<LibraryTag[]> {
  const { data, error } = await supabase
    .from("tags")
    .select("id, name, color")
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);
  return (data as LibraryTag[]) ?? [];
}

/**
 * Add a tag to the library, or return the one that already has this name.
 *
 * Looked up first because two people creating "north-wall" at once should end
 * up with one tag, and the name is compared case-insensitively as web does.
 */
export async function createLibraryTag(
  name: string,
  color: string,
  userId: string | null,
): Promise<LibraryTag> {
  const { data: existing } = await supabase
    .from("tags")
    .select("id, name, color")
    .ilike("name", name)
    .maybeSingle();
  if (existing) return existing as LibraryTag;

  const { data, error } = await supabase
    .from("tags")
    .insert({ name, color, created_by: userId } as never)
    .select("id, name, color")
    .single();
  if (error) throw new Error(error.message);
  return data as LibraryTag;
}

/* ------------------------------------------------------------------ tasks */

const TASK_FIELDS =
  "id, project_id, title, description, status, priority, due_date, completed_at, assignee_user_id, assignee_email, photo_ids, position, updated_at";

export type PhotoTasks = {
  tasks: TaskRow[];
  /** This photo's own row per task, keyed by task id. */
  items: Record<string, TaskPhotoItem>;
  /** True when the workspace predates per-photo task state. */
  unavailable: boolean;
};

/**
 * The tasks that cover this photo, with this photo's own state on each.
 *
 * The same read as web's `PhotoTasksPanel`: tasks on the project whose
 * `photo_ids` contains the photo, open first. A task can cover twelve photos,
 * so "done" here means this photo is done, not that the task is.
 */
export async function listPhotoTasks(projectId: string, photoId: string): Promise<PhotoTasks> {
  const { data, error } = await supabase
    .from("tasks")
    .select(TASK_FIELDS)
    .eq("project_id", projectId)
    .contains("photo_ids", [photoId])
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const tasks = (data as TaskRow[]) ?? [];
  if (tasks.length === 0) return { tasks, items: {}, unavailable: false };

  const { data: itemRows, error: itemError } = await supabase
    .from(TASK_PHOTO_ITEMS_TABLE as never)
    .select(TASK_PHOTO_ITEM_COLUMNS)
    .eq("photo_id", photoId)
    .in(
      "task_id",
      tasks.map((task) => task.id),
    );
  if (itemError) {
    if (isMissingTaskPhotoItems(itemError)) return { tasks, items: {}, unavailable: true };
    throw new Error(itemError.message);
  }
  const items: Record<string, TaskPhotoItem> = {};
  for (const item of (itemRows as TaskPhotoItem[]) ?? []) items[item.task_id] = item;
  return { tasks, items, unavailable: false };
}

/* ------------------------------------------------------------------ share */

/**
 * Hand a photo file on this phone to the system share sheet.
 *
 * Through `expo-sharing` on both platforms. React Native's own `Share` carries
 * a file on iOS only, which is why Android used to be sent to the link half of
 * the sheet instead.
 */
export async function shareLocalPhoto(uri: string, title: string, mimeType = "image/jpeg") {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("This phone has no way to share a file from the app.");
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle: title });
}

/**
 * Hand the photograph itself to the system share sheet.
 *
 * Web's `sharePhotoNative`: the file, so the sheet offers Photos, Messages,
 * AirDrop, Drive and the rest. The original is copied into the cache first
 * because the share sheet wants a local file, not a signed URL.
 */
export async function sharePhotoFile(url: string, title: string): Promise<void> {
  if (!url) throw new Error("This photo is not ready to share yet.");
  const dir = new Directory(Paths.cache, "shared-photos");
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = await File.downloadFileAsync(url, dir, { idempotent: true });
  await shareLocalPhoto(file.uri, title, file.type || "image/jpeg");
}
