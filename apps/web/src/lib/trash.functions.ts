import { rpcOp } from "./sitepix-api";

/** Must match apps/api trash service. */
export const TRASH_RETENTION_DAYS = 60;

export const listTrashedPhotos = rpcOp<{ projectId: string }, unknown>("listTrashedPhotos");

export const restorePhotos = rpcOp<{ photoIds: string[] }, unknown>("restorePhotos");

export const purgePhotos = rpcOp<{ photoIds: string[] }, unknown>("purgePhotos");

export const listTrashedProjects = rpcOp<undefined, unknown>("listTrashedProjects");

export const softDeleteProject = rpcOp<{ projectId: string }, unknown>("softDeleteProject");

export const restoreProject = rpcOp<{ projectId: string }, unknown>("restoreProject");

export const purgeProject = rpcOp<{ projectId: string }, unknown>("purgeProject");

export const getTrashCounts = rpcOp<undefined, unknown>("getTrashCounts");
