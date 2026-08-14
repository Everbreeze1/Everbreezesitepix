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
  /** Portfolio-site state, so the list can show and toggle it inline. */
  slug: string | null;
  service_type: string | null;
  city: string | null;
  state: string | null;
  on_site: boolean;
  featured: boolean;
}

export interface ShowcaseItemDetail {
  id: string;
  photo_id: string;
  caption: string | null;
  position: number;
  image_url: string;
}

export interface ShowcaseSectionDetail {
  id: string;
  project_id: string | null;
  project_name: string | null;
  title: string | null;
  body_html: string | null;
  position: number;
  items: ShowcaseItemDetail[];
}

export interface ShowcaseCompany {
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
}

export interface ShowcaseDetail {
  id: string;
  title: string;
  tagline: string | null;
  layout: string;
  share_token: string;
  revoked_at: string | null;
  intro_html: string | null;
  outro_html: string | null;
  accent_color: string | null;
  show_contact: boolean;
  show_reviews: boolean;
  cover_photo_id: string | null;
  cover_image_url: string | null;
  sections: ShowcaseSectionDetail[];
  /** Portfolio-site metadata - edited separately via updateShowcaseSite. */
  slug: string | null;
  service_type: string | null;
  products_used: string[];
  summary: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  on_site: boolean;
  featured: boolean;
  completed_on: string | null;
}

export interface PublicShowcase {
  status: "ok" | "not_found" | "revoked";
  showcase: {
    title: string;
    tagline: string | null;
    layout: string;
    intro_html: string | null;
    outro_html: string | null;
    accent_color: string | null;
    show_contact: boolean;
    show_reviews: boolean;
    cover_image_url: string | null;
    sections: ShowcaseSectionDetail[];
  } | null;
  company: ShowcaseCompany | null;
  reviewLinks: Array<{ url: string; label: string | null; platform: string }>;
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
    introHtml?: string | null;
    outroHtml?: string | null;
    accentColor?: string | null;
    showContact?: boolean;
    showReviews?: boolean;
  },
  { ok: true }
>("updateShowcase");

export const setShowcaseSections = rpcOp<
  {
    showcaseId: string;
    sections: Array<{
      projectId?: string | null;
      title?: string | null;
      bodyHtml?: string | null;
      items: Array<{ photoId: string; caption?: string | null }>;
    }>;
  },
  { ok: true }
>("setShowcaseSections");

/** One-click: builds a finished showcase from a project's phase-tagged photos. */
export const createShowcaseFromProject = rpcOp<
  { projectId: string; maxPhotos?: number },
  { id: string; photoCount: number }
>("createShowcaseFromProject");

export const deleteShowcase = rpcOp<{ id: string }, { ok: true }>("deleteShowcase");

export const setShowcaseItems = rpcOp<
  { showcaseId: string; items: Array<{ photoId: string; caption?: string | null }> },
  { ok: true }
>("setShowcaseItems");

export const setShowcaseShare = rpcOp<{ id: string; enable: boolean }, { ok: true }>(
  "setShowcaseShare",
);

export const getPublicShowcase = rpcOp<{ token: string }, PublicShowcase>("getPublicShowcase");
