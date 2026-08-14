import { rpcOp } from "./sitepix-api";
import type {
  createWalkthroughSessionService,
  saveWalkthroughPhotoService,
  finishWalkthroughSessionService,
  ensureWalkthroughPhotoLinksService,
  updateWalkthroughVideoPathService,
  setWalkthroughStatusService,
  listProjectWalkthroughsService,
  transcribeWalkthroughService,
  generateWalkthroughReportService,
  setWalkthroughShareService,
  getPublicWalkthroughService,
  createReportFromWalkthroughService,
  generateWalkthroughSummaryService,
  regenerateWalkthroughSummaryService,
} from "@sitepix/api";

/**
 * Result types are derived from the service functions rather than written out
 * by hand, so a change to a return shape in apps/api surfaces here as a compile
 * error instead of an `undefined` at runtime. These ops were previously all
 * declared `unknown`, which pushed every call site into `any`-style property
 * access that the compiler could not check.
 *
 * `import type` only - this never pulls apps/api into the client bundle.
 */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const createWalkthroughSession = rpcOp<
  { projectId: string; title: string },
  Result<typeof createWalkthroughSessionService>
>("createWalkthroughSession");

export const saveWalkthroughPhoto = rpcOp<
  {
    projectId: string;
    walkthroughId: string;
    storagePath: string;
    thumbPath?: string | null;
    sizeBytes: number;
    caption: string;
    offsetSeconds?: number;
    position?: number;
    takenAt: string;
    latitude?: number | null;
    longitude?: number | null;
  },
  Result<typeof saveWalkthroughPhotoService>
>("saveWalkthroughPhoto");

export const finishWalkthroughSession = rpcOp<
  {
    walkthroughId: string;
    durationSeconds: number;
    liveTranscript?: string;
  },
  Result<typeof finishWalkthroughSessionService>
>("finishWalkthroughSession", { idempotent: true });

export const ensureWalkthroughPhotoLinks = rpcOp<
  {
    walkthroughId: string;
    photos: Array<{
      photoId: string;
      offsetSeconds?: number;
      position?: number;
    }>;
  },
  Result<typeof ensureWalkthroughPhotoLinksService>
>("ensureWalkthroughPhotoLinks");

export const updateWalkthroughVideoPath = rpcOp<
  {
    walkthroughId: string;
    videoPath: string;
    videoMimeType: string;
  },
  Result<typeof updateWalkthroughVideoPathService>
>("updateWalkthroughVideoPath");

export const setWalkthroughStatus = rpcOp<
  {
    walkthroughId: string;
    status: "recording" | "generating" | "ready" | "failed";
  },
  Result<typeof setWalkthroughStatusService>
>("setWalkthroughStatus");

export const listProjectWalkthroughs = rpcOp<
  { projectId: string },
  Result<typeof listProjectWalkthroughsService>
>("listProjectWalkthroughs");

export const transcribeWalkthrough = rpcOp<
  {
    walkthroughId: string;
    audioBase64: string;
    mimeType: string;
  },
  Result<typeof transcribeWalkthroughService>
>("transcribeWalkthrough", { idempotent: true });

export const generateWalkthroughReport = rpcOp<
  { walkthroughId: string },
  Result<typeof generateWalkthroughReportService>
>("generateWalkthroughReport", { idempotent: true });

export const setWalkthroughShare = rpcOp<
  { walkthroughId: string; enable: boolean },
  Result<typeof setWalkthroughShareService>
>("setWalkthroughShare");

export const getPublicWalkthrough = rpcOp<
  { token: string },
  Result<typeof getPublicWalkthroughService>
>("getPublicWalkthrough");

export const createReportFromWalkthrough = rpcOp<
  { walkthroughId: string },
  Result<typeof createReportFromWalkthroughService>
>("createReportFromWalkthrough");

/**
 * Creates a WALKTHROUGH row, not a project page - a Summary is the AI's notes
 * on a set of photos, which is a walkthrough with no walk. It lands in the
 * Walkthroughs tab and opens at /walkthroughs/$id. See
 * supabase/migrations/20260814000000_walkthrough_source.sql.
 */
export const generateWalkthroughSummary = rpcOp<
  { projectId: string; photoIds: string[]; title?: string },
  Result<typeof generateWalkthroughSummaryService>
>("generateWalkthroughSummary", { idempotent: true });

export const regenerateWalkthroughSummary = rpcOp<
  { walkthroughId: string },
  Result<typeof regenerateWalkthroughSummaryService>
>("regenerateWalkthroughSummary", { idempotent: true });
