import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import { uploadWalkthroughVideo } from "./walkthroughs";

/**
 * Site videos recorded against a project.
 *
 * The `videos` table and the `site-videos` bucket, read the way the web project
 * page reads them for its "Site videos" row. Separate from walkthroughs, which
 * have their own screen.
 */

export type ProjectVideo = {
  id: string;
  storage_path: string;
  created_at: string;
  duration_seconds: number;
  caption: string | null;
  mime_type: string | null;
  /** Signed for an hour, or null when the object would not sign. */
  url: string | null;
};

const VIDEO_BUCKET = "site-videos";

export async function listProjectVideos(projectId: string, limit = 30): Promise<ProjectVideo[]> {
  const { data, error } = await supabase
    .from("videos")
    .select("id, storage_path, created_at, duration_seconds, caption, mime_type")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data as Omit<ProjectVideo, "url">[]) ?? [];
  if (rows.length === 0) return [];

  const { data: signed } = await supabase.storage.from(VIDEO_BUCKET).createSignedUrls(
    rows.map((row) => row.storage_path),
    60 * 60,
  );
  return rows.map((row, index) => ({ ...row, url: signed?.[index]?.signedUrl ?? null }));
}

/** "2:05" for a clip's length. */
export function videoDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

/**
 * How long one site video may run, per plan, as the web recorder allows:
 * 5 minutes on Starter, 10 on Pro, 20 on Team.
 */
export const VIDEO_MAX_SECONDS: Record<string, number> = { starter: 300, pro: 600, team: 1200 };

export function videoMaxSeconds(plan: string | null | undefined): number {
  return VIDEO_MAX_SECONDS[plan ?? "starter"] ?? VIDEO_MAX_SECONDS.starter;
}

/** Where a site video is stored: the same shape the web recorder writes. */
export function siteVideoPath(userId: string, projectId: string, extension = "mp4"): string {
  return `${userId}/${projectId}/${randomUUID()}.${extension}`;
}

/**
 * Where a queued site video is stored: keyed on its outbox row, so a retry
 * uploads over the same object instead of leaving a second copy behind.
 */
export function queuedSiteVideoPath(userId: string, projectId: string, rowId: string): string {
  return `${userId}/${projectId}/${rowId}.mp4`;
}

/**
 * Save a recorded site video to a project: the file to `site-videos`, then
 * the `videos` row the project page lists, as web's `onVideoSave` does.
 *
 * Run by the offline queue (`video_upload`), never while someone waits on the
 * camera. Repeatable: the upload overwrites the same path, and the row is only
 * written when no row for that path exists yet, so a send that died between
 * the insert and the queue marking it done does not list the video twice.
 *
 * The object is removed again when the row cannot be written. A video the
 * table never recorded is unreachable forever (every delete path keys off
 * `videos.storage_path`), and videos are the largest objects the app stores.
 * The file is still on the phone, so a retry uploads it again.
 */
export async function saveSiteVideo(input: {
  userId: string;
  projectId: string;
  localUri: string;
  durationSeconds: number;
  /** Fixed by the caller for a repeatable send; a fresh one otherwise. */
  storagePath?: string;
  /** When it was recorded, for the caption; now when omitted. */
  recordedAt?: string;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const mimeType = "video/mp4";
  const path = input.storagePath ?? siteVideoPath(input.userId, input.projectId);
  await uploadWalkthroughVideo({
    localUri: input.localUri,
    storagePath: path,
    mimeType,
    onProgress: input.onProgress,
  });

  const { data: existing, error: lookupError } = await supabase
    .from("videos")
    .select("id")
    .eq("storage_path", path)
    .limit(1);
  if (lookupError) throw new Error(lookupError.message);
  if ((existing as unknown[] | null)?.length) return;

  let size: number | null = null;
  try {
    size = new File(input.localUri).size ?? null;
  } catch {
    size = null;
  }

  const recordedAt = input.recordedAt ? new Date(input.recordedAt) : new Date();
  const { error } = await supabase.from("videos").insert({
    project_id: input.projectId,
    uploaded_by: input.userId,
    storage_path: path,
    size_bytes: size,
    duration_seconds: Math.max(1, Math.round(input.durationSeconds)),
    transcript: null,
    caption: `Site video ${recordedAt.toLocaleString()}`,
    mime_type: mimeType,
  } as never);
  if (error) {
    void supabase.storage.from(VIDEO_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}
