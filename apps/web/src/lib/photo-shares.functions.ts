import { rpcOp } from "./sitepix-api";
import type { PublicPhotoShare } from "@sitepix/api";

export type { PublicPhotoShare };

export const createPhotoShare = rpcOp<
  {
    photoId: string;
    expiresInHours: number;
    allowDownload: boolean;
  },
  unknown
>("createPhotoShare");

export const listPhotoShares = rpcOp<{ photoId: string }, unknown>("listPhotoShares");

export const revokePhotoShare = rpcOp<{ shareId: string }, unknown>("revokePhotoShare");

export const getPublicPhotoShare = rpcOp<{ token: string }, PublicPhotoShare>(
  "getPublicPhotoShare",
);
