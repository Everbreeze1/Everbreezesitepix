import { rpcOp } from "./sitepix-api";

export interface TimelineDay {
  /** Local calendar date, YYYY-MM-DD. */
  date: string;
  photoCount: number;
  projectCount: number;
  coverUrl: string | null;
  projectNames: string[];
}

export interface TimelineActivity {
  days: TimelineDay[];
  totalPhotos: number;
  /** The range hit the server's row ceiling - counts are a floor, not a total. */
  capped: boolean;
}

/**
 * Photo counts bucketed by local calendar day. Powers the gallery calendar's
 * day cells and its year heatmap; the day panel loads actual photos separately,
 * so this stays an aggregate no matter how large the range is.
 */
export const listTimelineActivity = rpcOp<
  {
    from: string;
    to: string;
    projectIds?: string[];
    tags?: string[];
    /** IANA zone. Preferred over the offset, which can't know about DST. */
    timeZone?: string;
    tzOffsetMinutes?: number;
    withThumbnails?: boolean;
  },
  TimelineActivity
>("listTimelineActivity");
