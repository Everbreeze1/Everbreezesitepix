import { rpcOp } from "./sitepix-api";

export const analyzePhoto = rpcOp<{ photoId: string }, unknown>("analyzePhoto", {
  idempotent: true,
});

export const chatWithAssistant = rpcOp<
  {
    conversationId?: string;
    message: string;
    photoId?: string;
    title?: string;
  },
  unknown
>("chatWithAssistant", { idempotent: true });

export const summarizePhotosReport = rpcOp<{ photoIds: string[]; title?: string }, unknown>(
  "summarizePhotosReport",
  { idempotent: true },
);

export const describeSiteLogPhotos = rpcOp<{ photoIds: string[] }, unknown>(
  "describeSiteLogPhotos",
  { idempotent: true },
);

export const summarizeWalkthroughsReport = rpcOp<
  { walkthroughIds: string[]; title?: string },
  unknown
>("summarizeWalkthroughsReport", { idempotent: true });

export const extractPhotoText = rpcOp<{ photoId: string }, unknown>("extractPhotoText", {
  idempotent: true,
});
