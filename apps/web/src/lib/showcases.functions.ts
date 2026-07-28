import { rpcOp } from "./sitepix-api";

export interface ShowcaseSummary {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string;
  revoked_at: string | null;
  item_count: number;
  cover_image_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ShowcaseItemDetail {
  id: string;
  photo_id: string;
  caption: string | null;
  position: number;
  image_url: string;
}

export interface ShowcaseDetail {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string;
  revoked_at: string | null;
  items: ShowcaseItemDetail[];
}

export interface PublicShowcase {
  status: "ok" | "not_found" | "revoked";
  showcase: {
    title: string;
    tagline: string | null;
    layout: string;
    items: Array<{ photo_id: string; caption: string | null; image_url: string }>;
  } | null;
  company: { name: string | null; logo_url: string | null } | null;
}

export const listShowcases = rpcOp<undefined, { showcases: ShowcaseSummary[] }>("listShowcases");

export const getShowcase = rpcOp<{ id: string }, ShowcaseDetail | null>("getShowcase");

export const createShowcase = rpcOp<{ title: string; tagline?: string | null }, { id: string }>(
  "createShowcase",
);

export const updateShowcase = rpcOp<
  {
    id: string;
    title?: string;
    tagline?: string | null;
    layout?: "grid" | "masonry" | "featured";
    coverPhotoId?: string | null;
  },
  { ok: true }
>("updateShowcase");

export const deleteShowcase = rpcOp<{ id: string }, { ok: true }>("deleteShowcase");

export const setShowcaseItems = rpcOp<
  { showcaseId: string; items: Array<{ photoId: string; caption?: string | null }> },
  { ok: true }
>("setShowcaseItems");

export const setShowcaseShare = rpcOp<{ id: string; enable: boolean }, { ok: true }>(
  "setShowcaseShare",
);

export const getPublicShowcase = rpcOp<{ token: string }, PublicShowcase>("getPublicShowcase");
