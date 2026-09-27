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
 * Save a recorded site video to a project: the file to `site-videos`, then
 * the `videos` row the project page lists, as web's `onVideoSave` does.
 *
 * The object is removed again when the row cannot be written. A video the
 * table never recorded is unreachable forever (every delete path keys off
 * `videos.storage_path`), and videos are the largest objects the app stores.
 */
export async function saveSiteVideo(input: {
  userId: string;
  projectId: string;
  localUri: string;
  durationSeconds: number;
  onProgress?: (percent: number) => void;
}): Promise<void> {
  const mimeType = "video/mp4";
  const path = siteVideoPath(input.userId, input.projectId);
  await uploadWalkthroughVideo({
    localUri: input.localUri,
    storagePath: path,
    mimeType,
    onProgress: input.onProgress,
  });

  let size: number | null = null;
  try {
    size = new File(input.localUri).size ?? null;
  } catch {
    size = null;
  }

  const { error } = await supabase.from("videos").insert({
    project_id: input.projectId,
    uploaded_by: input.userId,
    storage_path: path,
    size_bytes: size,
    duration_seconds: Math.max(1, Math.round(input.durationSeconds)),
    transcript: null,
    caption: `Site video ${new Date().toLocaleString()}`,
    mime_type: mimeType,
  } as never);
  if (error) {
    void supabase.storage.from(VIDEO_BUCKET).remove([path]);
    throw new Error(error.message);
  }
}
