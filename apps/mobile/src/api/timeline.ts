import { api } from "@/lib/api";
import type { TimelineDay } from "./timeline-view";

/**
 * The timeline: photo activity bucketed by local calendar day.
 *
 * Through `/v1/rpc` rather than counted from a downloaded page of photos, and
 * the service comment says why: a busy month overruns any sane row limit, and
 * counts that quietly come up short are worse than no counts at all. The op
 * aggregates server-side and tells the caller when it hit its own ceiling.
 */

export type TimelineActivity = {
  days: TimelineDay[];
  totalPhotos: number;
  /** The range hit the row ceiling, so counts are a floor rather than a total. */
  capped: boolean;
};

export async function listTimelineActivity(args: {
  from: string;
  to: string;
  withThumbnails?: boolean;
}): Promise<TimelineActivity> {
  const result = await api.rpc<Partial<TimelineActivity>>("listTimelineActivity", {
    from: args.from,
    to: args.to,
    withThumbnails: args.withThumbnails ?? true,
    /*
     * The device's own zone, by name.
     *
     * The op prefers `timeZone` over `tzOffsetMinutes` because a name knows
     * when daylight saving starts and an offset does not, so a fixed offset
     * shifts half the calendar by an hour twice a year. Without either, a photo
     * taken at 7pm local lands on the following UTC day.
     */
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    tzOffsetMinutes: new Date().getTimezoneOffset(),
  });

  return {
    days: result?.days ?? [],
    totalPhotos: result?.totalPhotos ?? 0,
    capped: result?.capped ?? false,
  };
}
