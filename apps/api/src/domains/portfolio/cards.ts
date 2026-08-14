import { CARD_THUMB_WIDTH, resolvePhotoUrls } from "../showcases/service";

/**
 * The card shape shared by the portfolio grid, the gallery embed and the map.
 *
 * A card is deliberately NOT a trimmed-down showcase detail: the grid must be
 * cheap enough to render dozens of projects on an anonymous page load, so it
 * never touches sections, rich text or full-size photos.
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

/** Every column loadShowcaseCards needs; keeps the SELECTs in sync. */
export const SHOWCASE_CARD_COLUMNS =
  "id, slug, title, summary, service_type, products_used, city, state, latitude, longitude, cover_photo_id, featured, position, completed_on, on_site, revoked_at, created_at";

export interface ShowcaseCardRow {
  id: string;
  slug: string | null;
  title: string;
  summary: string | null;
  service_type: string | null;
  products_used: string[] | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  cover_photo_id: string | null;
  featured: boolean | null;
  position: number | null;
  completed_on: string | null;
  on_site: boolean | null;
  revoked_at: string | null;
  created_at: string;
}

/**
 * Manual position, then newest first as the tie-break for rows that have never
 * been dragged (they all sit at position 0).
 *
 * `featured` deliberately does NOT sort here. It used to, and that quietly
 * fought the drag-to-reorder UI: dropping an ordinary project above a featured
 * one wrote the position the user asked for, then the next read hoisted the
 * featured row back to the top and the card appeared to snap back. One
 * ordering rule the user controls directly beats two that disagree - so
 * `featured` is now purely a badge on the card.
 */
export function compareCardRows(a: ShowcaseCardRow, b: ShowcaseCardRow): number {
  const pa = a.position ?? 0;
  const pb = b.position ?? 0;
  if (pa !== pb) return pa - pb;
  return b.created_at.localeCompare(a.created_at);
}

/**
 * Turns showcase rows into cards, resolving one thumbnail each.
 *
 * Cover photo falls back to the showcase's first item, because nothing in the
 * builder is required to set `cover_photo_id` and a grid of grey placeholders
 * is the fastest way to make a portfolio look broken.
 *
 * `db` is whichever client the caller is authorised with - the user's for the
 * builder, the service-role one for the public site.
 */
export async function loadShowcaseCards(
  db: any,
  rows: ShowcaseCardRow[],
): Promise<PortfolioShowcaseCard[]> {
  if (!rows.length) return [];

  const { data: itemRows } = await db
    .from("showcase_items")
    .select("showcase_id, photo_id, position")
    .in(
      "showcase_id",
      rows.map((r) => r.id),
    )
    .order("position", { ascending: true });

  const photoCount = new Map<string, number>();
  const firstPhoto = new Map<string, string>();
  ((itemRows as any[]) ?? []).forEach((r) => {
    photoCount.set(r.showcase_id, (photoCount.get(r.showcase_id) ?? 0) + 1);
    if (!firstPhoto.has(r.showcase_id) && r.photo_id) firstPhoto.set(r.showcase_id, r.photo_id);
  });

  const thumbId = new Map<string, string>();
  rows.forEach((r) => {
    const id = r.cover_photo_id ?? firstPhoto.get(r.id);
    if (id) thumbId.set(r.id, id);
  });

  const urlMap = await resolvePhotoUrls(
    Array.from(new Set(thumbId.values())),
    CARD_THUMB_WIDTH,
  );

  return rows.map((r) => {
    const id = thumbId.get(r.id);
    return {
      id: r.id,
      // Rows without a slug are filtered out before this point on the public
      // path; the fallback only keeps the builder's list rendering.
      slug: r.slug ?? r.id,
      title: r.title,
      summary: r.summary,
      service_type: r.service_type,
      products_used: r.products_used ?? [],
      city: r.city,
      state: r.state,
      latitude: r.latitude,
      longitude: r.longitude,
      cover_image_url: id ? (urlMap.get(id)?.image_url || null) : null,
      photo_count: photoCount.get(r.id) ?? 0,
      featured: !!r.featured,
      completed_on: r.completed_on,
    };
  });
}
