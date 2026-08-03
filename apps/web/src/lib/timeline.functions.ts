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
}

export const listTimelineActivity = rpcOp<
  {
    from: string;
    to: string;
    projectId?: string;
    tzOffsetMinutes?: number;
    withThumbnails?: boolean;
  },
  TimelineActivity
>("listTimelineActivity");
