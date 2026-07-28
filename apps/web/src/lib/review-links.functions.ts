import { rpcOp } from "./sitepix-api";

export interface ReviewLink {
  id: string;
  platform: "google" | "nicejob" | "custom";
  url: string;
  label: string | null;
  position: number;
}

export const listReviewLinks = rpcOp<undefined, { links: ReviewLink[] }>("listReviewLinks");

export const setReviewLinks = rpcOp<
  { links: Array<{ platform: "google" | "nicejob" | "custom"; url: string; label?: string | null }> },
  { links: ReviewLink[] }
>("setReviewLinks");
