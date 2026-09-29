import { api } from "@/lib/api";
import type { ReviewLink, ReviewLinkInput } from "./review-links-view";

/**
 * Review links: the web Settings page's Review Links section.
 *
 * The same two ops the web calls. `setReviewLinks` replaces the whole list,
 * so the screen always sends every row it shows, in order.
 */

export async function listReviewLinks(): Promise<ReviewLink[]> {
  const res = await api.rpc<{ links?: ReviewLink[] }>("listReviewLinks");
  return res?.links ?? [];
}

export async function setReviewLinks(links: ReviewLinkInput[]): Promise<ReviewLink[]> {
  const res = await api.rpc<{ links?: ReviewLink[] }>("setReviewLinks", { links });
  return res?.links ?? [];
}
