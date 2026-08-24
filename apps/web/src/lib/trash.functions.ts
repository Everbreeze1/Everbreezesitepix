import { rpcOp } from "./everlumen-api";
import type {
  listTrashedPhotosService,
  restorePhotosService,
  purgePhotosService,
  listTrashedProjectsService,
  softDeleteProjectService,
  restoreProjectService,
  purgeProjectService,
  getTrashCountsService,
} from "@everlumen/api";

/** Must match apps/api trash service. */
export const TRASH_RETENTION_DAYS = 60;

/** See walkthroughs.functions.ts - result types are derived, not hand-written. */
type Result<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>;

export const listTrashedPhotos = rpcOp<
  { projectId: string },
  Result<typeof listTrashedPhotosService>
>("listTrashedPhotos");

export const restorePhotos = rpcOp<{ photoIds: string[] }, Result<typeof restorePhotosService>>(
  "restorePhotos",
);

export const purgePhotos = rpcOp<{ photoIds: string[] }, Result<typeof purgePhotosService>>(
  "purgePhotos",
);

export const listTrashedProjects = rpcOp<undefined, Result<typeof listTrashedProjectsService>>(
  "listTrashedProjects",
);

export const softDeleteProject = rpcOp<
  { projectId: string },
  Result<typeof softDeleteProjectService>
>("softDeleteProject");

export const restoreProject = rpcOp<{ projectId: string }, Result<typeof restoreProjectService>>(
  "restoreProject",
);

export const purgeProject = rpcOp<{ projectId: string }, Result<typeof purgeProjectService>>(
  "purgeProject",
);

export const getTrashCounts = rpcOp<undefined, Result<typeof getTrashCountsService>>(
  "getTrashCounts",
);
