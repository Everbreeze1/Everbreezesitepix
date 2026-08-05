import { rpcOp } from "./sitepix-api";

/**
 * The portfolio mini-site: the layer above showcases.
 *
 * A showcase is one project's story; a portfolio is the site that lists them,
 * lets a visitor filter and map them, and gives the whole thing a front door.
 */

export interface PortfolioShowcaseCard {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  service_type: string | null;
  products_used: string[];
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_image_url: string | null;
  photo_count: number;
  featured: boolean;
  completed_on: string | null;
}

export interface PortfolioDetail {
  id: string;
  slug: string;
  business_name: string | null;
  logo_url: string | null;
  accent_color: string | null;
  hero_headline: string | null;
  hero_subhead: string | null;
  hero_photo_id: string | null;
  hero_image_url: string | null;
  about_html: string | null;
  services: string[];
  service_areas: string[];
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  show_map: boolean;
  show_reviews: boolean;
  published: boolean;
  embed_key: string;
  seo_title: string | null;
  seo_description: string | null;
}

export interface MyPortfolio {
  /** Null when the team has no portfolio yet and this user may not create one. */
  portfolio: PortfolioDetail | null;
  /** Whether this user may edit the site. Mirrors the RLS write policy. */
  canEdit: boolean;
  showcases: Array<PortfolioShowcaseCard & { on_site: boolean; is_draft: boolean }>;
  serviceTypes: string[];
}

/** The subset of PortfolioDetail an anonymous visitor is allowed to see. */
export interface PublicPortfolioSite {
  slug: string;
  business_name: string | null;
  logo_url: string | null;
  accent_color: string | null;
  hero_headline: string | null;
  hero_subhead: string | null;
  hero_image_url: string | null;
  about_html: string | null;
  services: string[];
  service_areas: string[];
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  cta_label: string | null;
  cta_url: string | null;
  show_map: boolean;
  show_reviews: boolean;
  seo_title: string | null;
  seo_description: string | null;
}

export interface PortfolioReviewLink {
  url: string;
  label: string | null;
  platform: string;
}

export interface PublicPortfolio {
  status: "ok" | "not_found" | "unpublished";
  site: PublicPortfolioSite | null;
  showcases: PortfolioShowcaseCard[];
  serviceTypes: string[];
  locations: string[];
  stats: { projects: number; photos: number; areas: number };
  reviewLinks: PortfolioReviewLink[];
}

export interface PublicPortfolioShowcase {
  status: "ok" | "not_found" | "unpublished";
  site: PublicPortfolioSite | null;
  showcase: {
    slug: string;
    title: string;
    tagline: string | null;
    summary: string | null;
    service_type: string | null;
    products_used: string[];
    city: string | null;
    state: string | null;
    completed_on: string | null;
    layout: string;
    intro_html: string | null;
    outro_html: string | null;
    accent_color: string | null;
    show_contact: boolean;
    show_reviews: boolean;
    cover_image_url: string | null;
    sections: Array<{
      id: string;
      project_id: string | null;
      project_name: string | null;
      title: string | null;
      body_html: string | null;
      position: number;
      items: Array<{
        id: string;
        photo_id: string;
        caption: string | null;
        position: number;
        image_url: string;
      }>;
    }>;
  } | null;
  prev: { slug: string; title: string; cover_image_url: string | null } | null;
  next: { slug: string; title: string; cover_image_url: string | null } | null;
  related: PortfolioShowcaseCard[];
  reviewLinks: PortfolioReviewLink[];
}

export interface PortfolioEmbedData {
  status: "ok" | "not_found" | "unpublished";
  site_url: string | null;
  slug: string | null;
  business_name: string | null;
  accent_color: string | null;
  showcases: PortfolioShowcaseCard[];
  serviceTypes: string[];
}

/** Creates the team's portfolio on first call — safe to call on page load. */
export const getMyPortfolio = rpcOp<undefined, MyPortfolio>("getMyPortfolio");

export const updatePortfolio = rpcOp<
  {
    slug?: string;
    businessName?: string | null;
    logoUrl?: string | null;
    accentColor?: string | null;
    heroHeadline?: string | null;
    heroSubhead?: string | null;
    heroPhotoId?: string | null;
    aboutHtml?: string | null;
    services?: string[];
    serviceAreas?: string[];
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    websiteUrl?: string | null;
    ctaLabel?: string | null;
    ctaUrl?: string | null;
    showMap?: boolean;
    showReviews?: boolean;
    published?: boolean;
    seoTitle?: string | null;
    seoDescription?: string | null;
  },
  { ok: true; slug: string }
>("updatePortfolio");

export const checkPortfolioSlug = rpcOp<
  { slug: string },
  { available: boolean; reason: string | null }
>("checkPortfolioSlug");

export const rotatePortfolioEmbedKey = rpcOp<undefined, { embedKey: string }>(
  "rotatePortfolioEmbedKey",
);

/** Site-only fields on a showcase — its URL, facets, map pin and listing state. */
export const updateShowcaseSite = rpcOp<
  {
    id: string;
    slug?: string | null;
    serviceType?: string | null;
    productsUsed?: string[];
    summary?: string | null;
    city?: string | null;
    state?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    onSite?: boolean;
    featured?: boolean;
    completedOn?: string | null;
  },
  { ok: true; slug: string | null }
>("updateShowcaseSite");

export const reorderPortfolioShowcases = rpcOp<{ ids: string[] }, { ok: true }>(
  "reorderPortfolioShowcases",
);

export const getPublicPortfolio = rpcOp<{ slug: string }, PublicPortfolio>("getPublicPortfolio");

export const getPublicPortfolioShowcase = rpcOp<
  { slug: string; showcaseSlug: string },
  PublicPortfolioShowcase
>("getPublicPortfolioShowcase");

export const getPortfolioEmbed = rpcOp<{ key: string }, PortfolioEmbedData>("getPortfolioEmbed");
