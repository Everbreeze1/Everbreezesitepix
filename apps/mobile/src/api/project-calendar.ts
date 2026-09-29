import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { signPhotoUrls, type PhotoListItem } from "./photos";
import type { TimelineActivity } from "./timeline";

/**
 * One project's photos, by calendar day.
 *
 * The web project page's Calendar tab is the gallery calendar scoped to one
 * job, and this is the same pair of reads: day counts from the
 * `listTimelineActivity` aggregate (so a busy month is counted server side
 * rather than from whatever page of photos happens to be loaded), and the
 * photos of one tapped day fetched on their own.
 */

export async function listProjectPhotoActivity(args: {
  projectId: string;
  from: string;
  to: string;
}): Promise<TimelineActivity> {
  const result = await api.rpc<Partial<TimelineActivity>>("listTimelineActivity", {
    from: args.from,
    to: args.to,
    projectIds: [args.projectId],
    withThumbnails: false,
    // Named zone first, offset as the fallback: see `listTimelineActivity`.
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffsetMinutes: new Date().getTimezoneOffset(),
  });
  return {
    days: result?.days ?? [],
    totalPhotos: result?.totalPhotos ?? 0,
    capped: result?.capped ?? false,
  };
}

/** A day's panel is a panel, not a feed. The web caps it at the same number. */
const DAY_PHOTO_LIMIT = 500;

/**
 * The photos taken on one local calendar day.
 *
 * Windowed on `taken_at` with a `created_at` fallback, the same way the server
 * buckets the day counts, so opening a day never contradicts its own number.
 * `date` is `YYYY-MM-DD` in the device's zone.
 */
export async function listProjectDayPhotos(
  projectId: string,
  date: string,
): Promise<{ photos: PhotoListItem[]; urls: Record<string, string> }> {
  const [year, month, day] = date.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day + 1, 0, 0, 0, 0);
  const from = start.toISOString();
  const to = end.toISOString();

  const { data, error } = await (supabase as any)
    .from("photos")
    .select("id, caption, storage_path, thumb_path, image_url, created_at, taken_at, phase, tags")
    .eq("project_id", projectId)
    .is("deleted_at", null)
    .eq("hidden", false)
    .or(
      `and(taken_at.gte.${from},taken_at.lt.${to}),and(taken_at.is.null,created_at.gte.${from},created_at.lt.${to})`,
    )
    .order("taken_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(DAY_PHOTO_LIMIT);
  if (error) throw new Error(error.message);

  const photos = (data as PhotoListItem[]) ?? [];
  const urls = await signPhotoUrls(photos);
  return { photos, urls };
}
