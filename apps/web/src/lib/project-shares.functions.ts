import { rpcOp } from "./sitepix-api";
import type { ProjectShareState, PublicProjectShare } from "@sitepix/api";

export type { ProjectShareState, PublicProjectShare };

/** Current link state for a project, without changing it. */
export const getProjectShare = rpcOp<{ projectId: string }, ProjectShareState>("getProjectShare");

/** Owner's on/off switch for the link the project's QR code points at. */
export const setProjectShare = rpcOp<{ projectId: string; enable: boolean }, ProjectShareState>(
  "setProjectShare",
);

/** Anonymous read behind `/share/projects/$token`. */
export const getPublicProjectShare = rpcOp<{ token: string }, PublicProjectShare>(
  "getPublicProjectShare",
);
