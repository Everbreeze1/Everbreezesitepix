import { rpcOp } from "./sitepix-api";
import type {
  listProjectSummariesService,
  getWalkthroughSummaryService,
  generateSummaryFromPhotosService,
  generateSummaryForWalkthroughService,
  updateWalkthroughSummaryService,
  setSummaryShareService,
  deleteWalkthroughSummaryService,
  getPublicSummaryService,
} from "@sitepix/api";

/**
 * Walkthrough Summaries: their own object, their own operations.
 *
 * These used to be walkthrough ops on a row with `source = 'summary'`, which is
 * why opening one landed on `/walkthroughs/{id}` under a tab titled
 * "Walkthrough" with no video behind it. A summary is now a thing of its own
 * all the way down - table, service, route and title.
 *
 * Result types are derived from the service functions, so a change to a return
 * shape in apps/api surfaces here as a compile error rather than an `undefined`
 * at runtime. `import type` only; this never pulls apps/api into the bundle.
 */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const listProjectSummaries = rpcOp<
  { projectId: string },
  Result<typeof listProjectSummariesService>
>("listProjectSummaries");

export const getWalkthroughSummary = rpcOp<
  { summaryId: string },
  Result<typeof getWalkthroughSummaryService>
>("getWalkthroughSummary");

/** A summary written from photos alone. No walk behind it, and none implied. */
export const generateSummaryFromPhotos = rpcOp<
  { projectId: string; photoIds: string[]; title?: string },
  Result<typeof generateSummaryFromPhotosService>
>("generateSummaryFromPhotos", { idempotent: true });

/**
 * The Fast Summary Report for a recorded walk.
 *
 * Returns the existing summary untouched unless `force` is set, so the
 * automatic publish when a recording finishes cannot leave two copies behind if
 * it is retried.
 */
export const generateSummaryForWalkthrough = rpcOp<
  { walkthroughId: string; force?: boolean },
  Result<typeof generateSummaryForWalkthroughService>
>("generateSummaryForWalkthrough", { idempotent: true });

export const updateWalkthroughSummary = rpcOp<
  { summaryId: string; title?: string; markdown?: string },
  Result<typeof updateWalkthroughSummaryService>
>("updateWalkthroughSummary");

export const setSummaryShare = rpcOp<
  { summaryId: string; enable: boolean },
  Result<typeof setSummaryShareService>
>("setSummaryShare");

export const deleteWalkthroughSummary = rpcOp<
  { summaryId: string },
  Result<typeof deleteWalkthroughSummaryService>
>("deleteWalkthroughSummary");

export const getPublicSummary = rpcOp<{ token: string }, Result<typeof getPublicSummaryService>>(
  "getPublicSummary",
);

/** One photo of a summary, with the note that belongs to it. */
export interface SummaryPhoto {
  photoId: string;
  offsetSeconds: number;
  note: string;
  /** What was said on camera near this moment, or null if nobody spoke. */
  spoken: string | null;
  imageUrl: string;
  caption: string | null;
  takenAt: string | null;
}

export interface ProjectSummaryListItem {
  id: string;
  projectId: string;
  walkthroughId: string | null;
  title: string;
  markdown: string | null;
  status: string;
  shareToken: string | null;
  createdAt: string;
  updatedAt: string;
  photoCount: number;
  thumbUrl: string | null;
}
