/** Canonical origin for absolute URLs in meta tags, JSON-LD and sitemap.xml. */
export const SITE_ORIGIN = "https://www.everbreezesitepix.com";

export const absoluteUrl = (path: string) =>
  `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
