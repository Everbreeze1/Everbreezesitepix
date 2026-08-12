import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { signPhotoUrls } from "../../lib/photo-urls";

/**
 * Ceiling on rows pulled for a range. The count-only mode (the year heatmap)
 * gets the higher one: its rows are three small columns rather than six, and a
 * whole year of heavy use has to fit in a single request or the shading lies.
 */
const MAX_ROWS_WITH_THUMBS = 6000;
const MAX_ROWS_COUNT_ONLY = 20000;
/**
 * Days of slack added to each end of the `created_at` window.
 *
 * Buckets key off `taken_at` but the range filter has to run against
 * `created_at` (the only column with an index that suits it). A photo shot at
 * 6pm on the 31st and synced the next morning would otherwise fall outside a
 * window that ends at the month boundary, and the last day of every month would
 * read light. Fetch a little wider, then trim by local date.
 */
const SYNC_DRIFT_DAYS = 3;
const DAY_MS = 86_400_000;

/**
 * A PostgREST array literal with every element quoted.
 *
 * `.overlaps()` joins the values on commas and quotes nothing, so a tag that
 * contains a comma would silently split into two and match the wrong photos.
 */
const pgArray = (values: string[]) =>
  `{${values.map((v) => `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

/**
 * Maps an instant to the calendar date it fell on for the viewer.
 *
 * Prefers the IANA zone. A fixed offset cannot be right for a whole range:
 * `getTimezoneOffset()` reports whatever is in force *today*, so a viewer in
 * New York paging back from August to January buckets by UTC-4 when January is
 * really UTC-5 — every photo shot in the last hour of a day lands on the next
 * day. The day panel derives its window from a real local date and so gets it
 * right, which leaves the cell and the panel disagreeing about the same photo.
 */
function makeLocalDate(timeZone: string | undefined, tzOffsetMinutes: number) {
  if (timeZone) {
    try {
      const fmt = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
      // en-CA is expected to yield YYYY-MM-DD; confirm before relying on it,
      // since ICU builds vary and the keys are compared as strings.
      if (/^\d{4}-\d{2}-\d{2}$/.test(fmt.format(new Date(0)))) {
        return (iso: string) => fmt.format(new Date(iso));
      }
    } catch {
      // Unknown zone — fall through to the offset.
    }
  }
  const offsetMs = tzOffsetMinutes * 60_000;
  return (iso: string) => new Date(new Date(iso).getTime() - offsetMs).toISOString().slice(0, 10);
}

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
  /**
   * The range hit the row ceiling, so counts are a floor rather than a total.
   * Callers should say so instead of presenting short numbers as fact.
   */
  capped: boolean;
}

export const listTimelineActivityInputSchema = z.object({
  /** Inclusive ISO instant for the start of the range. */
  from: z.string().datetime(),
  /** Exclusive ISO instant for the end of the range. */
  to: z.string().datetime(),
  /** Empty/omitted means every project the caller can see. */
  projectIds: z.array(z.string().uuid()).max(200).optional(),
  /** Any-of tag filter, matching how the gallery's tag pills combine. */
  tags: z.array(z.string().min(1).max(128)).max(64).optional(),
  /**
   * The viewer's IANA zone, e.g. "America/New_York". Preferred over
   * `tzOffsetMinutes` because it knows when daylight saving starts and stops.
   */
  timeZone: z.string().min(1).max(64).optional(),
  /**
   * Minutes to subtract from UTC to reach the viewer's local time, i.e. exactly
   * what `new Date().getTimezoneOffset()` returns. Without this a photo taken
   * at 7pm local lands on the following UTC day and the calendar is off by one.
   * Only a fallback now — see `timeZone`.
   */
  tzOffsetMinutes: z.number().int().min(-840).max(840).default(0),
  /** Month view needs a thumbnail per day; the year heatmap only needs counts. */
  withThumbnails: z.boolean().default(false),
});

/**
 * Photo activity bucketed by local calendar day.
 *
 * This is what the gallery's calendar draws its day cells from. It exists as an
 * aggregate rather than the page counting a downloaded slice of photos, because
 * a busy month overruns any sane row limit and counts that quietly come up
 * short are worse than no counts at all.
 *
 * Reads through the caller's client rather than the admin one, so RLS scopes
 * this to projects they can actually see and no extra permission check is
 * needed here.
 */
export async function listTimelineActivityService(
  ctx: AuthedContext,
  data: z.infer<typeof listTimelineActivityInputSchema>,
): Promise<TimelineActivity> {
  const maxRows = data.withThumbnails ? MAX_ROWS_WITH_THUMBS : MAX_ROWS_COUNT_ONLY;
  const fromMs = Date.parse(data.from);
  const toMs = Date.parse(data.to);
  const slack = SYNC_DRIFT_DAYS * DAY_MS;

  let query = (ctx.supabase as any)
    .from("photos")
    // The heatmap never renders a pixel, so it does not pay for the columns
    // that would let it. At 20k rows those three columns are the difference
    // between a small response and a few megabytes.
    .select(
      data.withThumbnails
        ? "id, project_id, storage_path, thumb_path, image_url, taken_at, created_at"
        : "project_id, taken_at, created_at",
    )
    .eq("archived", false)
    .is("deleted_at", null)
    // Walkthrough frames are capture artefacts, not a record of a day's work.
    .or("phase.is.null,phase.neq.walkthrough")
    .not("storage_path", "like", "%/walkthroughs/%")
    .gte("created_at", new Date(fromMs - slack).toISOString())
    .lt("created_at", new Date(toMs + slack).toISOString())
    .order("created_at", { ascending: false })
    .limit(maxRows);
  if (data.projectIds?.length) query = query.in("project_id", data.projectIds);
  if (data.tags?.length) query = query.filter("tags", "ov", pgArray(data.tags));

  const { data: rows, error } = await query;
  if (error) throw Object.assign(new Error(error.message), { status: 400 });
  const photos = (rows as any[]) ?? [];
  const capped = photos.length >= maxRows;
  if (!photos.length) return { days: [], totalPhotos: 0, capped: false };

  const localDate = makeLocalDate(data.timeZone, data.tzOffsetMinutes);
  // taken_at is when the shutter fired; created_at is when it synced. Prefer
  // the former so photos uploaded the next morning land on the day they were
  // actually shot.
  const shotAt = (p: any): string => p.taken_at ?? p.created_at;

  // The slack above deliberately over-fetches; these bound what we keep.
  const firstDate = localDate(data.from);
  const lastDate = localDate(new Date(toMs - 1).toISOString());

  const byDay = new Map<string, { photos: any[]; projectIds: Set<string> }>();
  for (const p of photos) {
    const key = localDate(shotAt(p));
    if (key < firstDate || key > lastDate) continue;
    const bucket = byDay.get(key);
    if (bucket) {
      bucket.photos.push(p);
      if (p.project_id) bucket.projectIds.add(p.project_id);
    } else {
      byDay.set(key, { photos: [p], projectIds: new Set(p.project_id ? [p.project_id] : []) });
    }
  }

  // Cover photo per day, resolved only when the caller will render them. Rows
  // arrive in created_at order but buckets key off taken_at, so pick the newest
  // by the same clock the day cell was built from — otherwise the cover is
  // whichever photo happened to sync last.
  const covers = new Map<string, any>();
  if (data.withThumbnails) {
    for (const [date, bucket] of byDay) {
      const cover = bucket.photos
        .filter((p) => p.image_url || p.storage_path)
        .sort((a, b) => +new Date(shotAt(b)) - +new Date(shotAt(a)))[0];
      if (cover) covers.set(date, cover);
    }
  }
  const coverPhotos = data.withThumbnails
    ? Array.from(covers.values()).filter((p) => !p.image_url && p.storage_path)
    : [];
  const signed = coverPhotos.length
    ? await signPhotoUrls(
        coverPhotos.map((p) => p.storage_path),
        {
          thumbByPath: Object.fromEntries(
            coverPhotos.map((p) => [p.storage_path, p.thumb_path ?? null]),
          ),
        },
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

  let totalPhotos = 0;
  const days: TimelineDay[] = Array.from(byDay.entries())
    .map(([date, bucket]) => {
      const cover = covers.get(date);
      totalPhotos += bucket.photos.length;
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

  return { days, totalPhotos, capped };
}
