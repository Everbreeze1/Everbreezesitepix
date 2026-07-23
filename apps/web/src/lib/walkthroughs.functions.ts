import { rpcOp } from "./sitepix-api";

export const createWalkthroughSession = rpcOp<{ projectId: string; title: string }, unknown>(
  "createWalkthroughSession",
);

export const saveWalkthroughPhoto = rpcOp<
  {
    projectId: string;
    walkthroughId: string;
    storagePath: string;
    sizeBytes: number;
    caption: string;
    offsetSeconds?: number;
    position?: number;
    takenAt: string;
    latitude?: number | null;
    longitude?: number | null;
  },
  unknown
>("saveWalkthroughPhoto");

export const finishWalkthroughSession = rpcOp<
  {
    walkthroughId: string;
    durationSeconds: number;
    liveTranscript?: string;
  },
  unknown
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
  unknown
>("ensureWalkthroughPhotoLinks");

export const updateWalkthroughVideoPath = rpcOp<
  {
    walkthroughId: string;
    videoPath: string;
    videoMimeType: string;
  },
  unknown
>("updateWalkthroughVideoPath");

export const setWalkthroughStatus = rpcOp<
  {
    walkthroughId: string;
    status: "recording" | "generating" | "ready" | "failed";
  },
  unknown
>("setWalkthroughStatus");

export const listProjectWalkthroughs = rpcOp<{ projectId: string }, unknown>(
  "listProjectWalkthroughs",
);

export const transcribeWalkthrough = rpcOp<
  {
    walkthroughId: string;
    audioBase64: string;
    mimeType: string;
  },
  unknown
>("transcribeWalkthrough", { idempotent: true });

export const generateWalkthroughReport = rpcOp<{ walkthroughId: string }, unknown>(
  "generateWalkthroughReport",
  { idempotent: true },
);

export const setWalkthroughShare = rpcOp<{ walkthroughId: string; enable: boolean }, unknown>(
  "setWalkthroughShare",
);

export const getPublicWalkthrough = rpcOp<{ token: string }, unknown>("getPublicWalkthrough");

export const createReportFromWalkthrough = rpcOp<{ walkthroughId: string }, unknown>(
  "createReportFromWalkthrough",
);
