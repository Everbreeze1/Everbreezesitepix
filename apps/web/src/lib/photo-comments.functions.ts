import { rpcOp } from "./sitepix-api";
import type { PhotoComment } from "@sitepix/api";

export type { PhotoComment };

export const listPhotoComments = rpcOp<{ photoId: string }, { comments: PhotoComment[] }>(
  "listPhotoComments",
);

export const getPhotoComment = rpcOp<{ commentId: string }, { comment: PhotoComment }>(
  "getPhotoComment",
);

export const createPhotoComment = rpcOp<
  {
    photoId: string;
    projectId: string;
    body: string;
    mentions?: string[];
  },
  { comment: PhotoComment }
>("createPhotoComment");

export const deletePhotoComment = rpcOp<{ commentId: string }, unknown>("deletePhotoComment");
