import { supabase } from "@/lib/supabase";

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
