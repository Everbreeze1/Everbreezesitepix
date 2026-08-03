import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { signPhotoUrls } from "../../lib/photo-urls";

/** Month-view day cells show one representative photo each. */
const DAY_THUMB_WIDTH = 400;
/** Ceiling on rows pulled for a range — a year of heavy use stays under this. */
const MAX_ROWS = 6000;

export interface TimelineDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  photoCount: number;
  projectCount: number;
  /** Representative photo for the day. Only populated when thumbnails asked for. */
  coverUrl: string | null;
  projectNames: string[];
}

export interface TimelineActivity {
  days: TimelineDay[];
  totalPhotos: number;
}

export const listTimelineActivityInputSchema = z.object({
  /** Inclusive ISO instant for the start of the range. */
  from: z.string().datetime(),
  /** Exclusive ISO instant for the end of the range. */
  to: z.string().datetime(),
  projectId: z.string().uuid().optional(),
  /**
   * Minutes to subtract from UTC to reach the viewer's local time, i.e. exactly
   * what `new Date().getTimezoneOffset()` returns. Without this a photo taken
   * at 7pm local lands on the following UTC day and the calendar is off by one.
   */
  tzOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  /** Month view needs a thumbnail per day; the year heatmap only needs counts. */
  withThumbnails: z.boolean().default(false),
});

/**
 * Photo activity bucketed by local calendar day.
 *
 * Reads through the caller's client rather than the admin one, so RLS scopes
 * this to projects they can actually see and no extra permission check is
 * needed here.
 */
export async function listTimelineActivityService(
  ctx: AuthedContext,
  data: z.infer<typeof listTimelineActivityInputSchema>,
): Promise<TimelineActivity> {
  let query = (ctx.supabase as any)
    .from("photos")
    .select("id, project_id, storage_path, image_url, taken_at, created_at")
    .eq("archived", false)
    // Walkthrough frames are capture artefacts, not a record of a day's work.
    .or("phase.is.null,phase.neq.walkthrough")
    .gte("created_at", data.from)
    .lt("created_at", data.to)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);
  if (data.projectId) query = query.eq("project_id", data.projectId);

  const { data: rows, error } = await query;
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  const photos = (rows as any[]) ?? [];
  if (!photos.length) return { days: [], totalPhotos: 0 };

  const offsetMs = data.tzOffsetMinutes * 60_000;
  /** Shift into the viewer's local frame, then take the calendar date. */
  const localDate = (iso: string) => new Date(new Date(iso).getTime() - offsetMs).toISOString().slice(0, 10);

  const byDay = new Map<
    string,
    { photos: any[]; projectIds: Set<string> }
  >();
  for (const p of photos) {
    // taken_at is when the shutter fired; created_at is when it synced. Prefer
    // the former so photos uploaded the next morning land on the day they were
    // actually shot.
    const key = localDate(p.taken_at ?? p.created_at);
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.photos.push(p);
      if (p.project_id) bucket.projectIds.add(p.project_id);
    } else {
      byDay.set(key, { photos: [p], projectIds: new Set(p.project_id ? [p.project_id] : []) });
    }
  }

  // Cover photo per day, resolved only when the caller will render them.
  const covers = new Map<string, any>();
  if (data.withThumbnails) {
    for (const [date, bucket] of byDay) {
      const cover = bucket.photos.find((p) => p.image_url || p.storage_path);
      if (cover) covers.set(date, cover);
    }
  }
  const signed = data.withThumbnails
    ? await signPhotoUrls(
        Array.from(covers.values())
          .filter((p) => !p.image_url && p.storage_path)
          .map((p) => p.storage_path),
        DAY_THUMB_WIDTH,
      )
    : {};

  // Project names for the day tooltip / detail header.
  const allProjectIds = Array.from(
    new Set(Array.from(byDay.values()).flatMap((b) => Array.from(b.projectIds))),
  );
  const projectNames = new Map<string, string>();
  if (allProjectIds.length) {
    const { data: projectRows } = await (ctx.supabase as any)
      .from("projects")
      .select("id, name")
      .in("id", allProjectIds);
    ((projectRows as any[]) ?? []).forEach((p) => projectNames.set(p.id, p.name ?? ""));
  }

  const days: TimelineDay[] = Array.from(byDay.entries())
    .map(([date, bucket]) => {
      const cover = covers.get(date);
      return {
        date,
        photoCount: bucket.photos.length,
        projectCount: bucket.projectIds.size,
        coverUrl: cover ? (cover.image_url ?? signed[cover.storage_path] ?? null) : null,
        projectNames: Array.from(bucket.projectIds)
          .map((id) => projectNames.get(id) ?? "")
          .filter(Boolean),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  return { days, totalPhotos: photos.length };
}
