import { rpcOp } from "./sitepix-api";
import type {
  analyzePhotoService,
  chatWithAssistantService,
  summarizePhotosReportService,
  describeSiteLogPhotosService,
  summarizeWalkthroughsReportService,
  extractPhotoTextService,
} from "@sitepix/api";

/** See walkthroughs.functions.ts — result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const analyzePhoto = rpcOp<{ photoId: string }, Result<typeof analyzePhotoService>>(
  "analyzePhoto",
  { idempotent: true },
);

export const chatWithAssistant = rpcOp<
  {
    conversationId?: string;
    message: string;
    photoId?: string;
    title?: string;
  },
  Result<typeof chatWithAssistantService>
>("chatWithAssistant", { idempotent: true });

export const summarizePhotosReport = rpcOp<
  { photoIds: string[]; title?: string },
  Result<typeof summarizePhotosReportService>
>("summarizePhotosReport", { idempotent: true });

export const describeSiteLogPhotos = rpcOp<
  { photoIds: string[] },
  Result<typeof describeSiteLogPhotosService>
>("describeSiteLogPhotos", { idempotent: true });

export const summarizeWalkthroughsReport = rpcOp<
  { walkthroughIds: string[]; title?: string },
  Result<typeof summarizeWalkthroughsReportService>
>("summarizeWalkthroughsReport", { idempotent: true });

export const extractPhotoText = rpcOp<{ photoId: string }, Result<typeof extractPhotoTextService>>(
  "extractPhotoText",
  { idempotent: true },
);
