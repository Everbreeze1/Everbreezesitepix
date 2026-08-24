import { rpcOp } from "./everlumen-api";
import type { ProjectShareState, PublicProjectShare } from "@everlumen/api";

export type { ProjectShareState, PublicProjectShare };

/** Current link state for a project, without changing it. */
export const getProjectShare = rpcOp<{ projectId: string }, ProjectShareState>("getProjectShare");

/**
 * Current link state, publishing it if the project has never been shared or
 * un-shared before. Opening the QR dialog is the act; a link its owner switched
 * off is left alone. See `ensureProjectShareService`.
 */
export const ensureProjectShare = rpcOp<{ projectId: string }, ProjectShareState>(
  "ensureProjectShare",
);

/** Owner's on/off switch for the link the project's QR code points at. */
export const setProjectShare = rpcOp<{ projectId: string; enable: boolean }, ProjectShareState>(
  "setProjectShare",
);

/** Anonymous read behind `/share/projects/$token`. */
export const getPublicProjectShare = rpcOp<{ token: string }, PublicProjectShare>(
  "getPublicProjectShare",
);
