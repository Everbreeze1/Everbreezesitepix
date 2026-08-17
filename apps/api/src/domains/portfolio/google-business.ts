import { z } from "zod";
import type { AuthedContext } from "../../lib/user-context";
import { requireTeamPlan } from "../../lib/team-plan";
import { myTeamId } from "../showcases/service";

/**
 * "Connect your Google Business Profile" - the shortcut past the guided build.
 *
 * A trade signing up already has every answer this app asks for sitting in one
 * Google listing: the name, the address, the phone, the website, the category,
 * and the star rating they are proud of. Retyping all of it into a seven step
 * wizard is the friction the client called out. So one pasted link resolves to
 * a place_id, and the place_id gives us everything else.
 *
 * Two deliberate design choices:
 *
 *   1. The client never sends us business data to store. It sends a place_id
 *      and a list of field names; the server re-fetches from Google and writes
 *      only the fields that were asked for. A tampered payload can therefore
 *      only choose *which* of Google's own values land on the row, never what
 *      they say.
 *
 *   2. Nothing is written by the lookup itself. Resolving a link and applying
 *      it are separate calls, because the first listing Google returns for
 *      "Everbreeze Heating" may well be a different company in a different
 *      state, and overwriting a live marketing site on a fuzzy text match is
 *      not a mistake worth being efficient about.
 *
 * Uses the Places API (New). The legacy `maps/api/place/*` endpoints are closed
 * to keys created after March 2025, so a new deployment would silently fail on
 * them while geocoding kept working off the same key.
 */

const PLACES_HOST = "https://places.googleapis.com/v1";

/** Places calls sit in front of a user pressing a button, so they must not hang. */
const TIMEOUT_MS = 10_000;

/**
 * The fields a mini-site can actually use. Everything here is a documented
 * Places API (New) field - an unknown name in the mask fails the whole request
 * with a 400, so this list is not a place to guess.
 */
const BASE_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "addressComponents",
  "nationalPhoneNumber",
  "internationalPhoneNumber",
  "websiteUri",
  "rating",
  "userRatingCount",
  "googleMapsUri",
  "editorialSummary",
  "primaryTypeDisplayName",
];

/**
 * Google's own review URLs, asked for separately because they are the one field
 * here that might not be granted.
 *
 * `googleMapsLinks` sits in a higher SKU on some accounts, and an ungranted
 * name in the mask fails the WHOLE request - which would lose the name, phone
 * and rating to gain a link. So it is requested as an extra and dropped on the
 * first 400, rather than being either trusted blindly or written off.
 *
 * Worth the retry because these URIs are authoritative. The
 * `search.google.com/local/*` forms below are a long-standing pattern rather
 * than a documented endpoint, and the whole point of the feature is a review
 * link that still resolves in a year.
 */
const LINK_FIELD = "googleMapsLinks";

const DETAIL_FIELD_MASK = [...BASE_FIELDS, LINK_FIELD].join(",");
const DETAIL_FIELD_MASK_FALLBACK = BASE_FIELDS.join(",");

export interface GoogleBusinessProfile {
  placeId: string;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  /** Google's own category, e.g. "HVAC contractor". Seeds the trades list. */
  category: string | null;
  /** Google's one-line description of the place, where it has one. */
  summary: string | null;
  rating: number | null;
  reviewCount: number | null;
  mapsUrl: string | null;
  /** Public "read the reviews" page for the listing. */
  reviewsUrl: string;
  /** Deep link straight into the leave-a-review box. */
  writeReviewUrl: string;
}

function badRequest(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    badRequest(
      "Google lookup isn't configured on this server yet. Fill the site in by hand for now.",
    );
  }
  return key;
}

/* ------------------------------------------------------------------ */
/* Review URLs                                                         */
/* ------------------------------------------------------------------ */

/**
 * The fallback review URLs, used when `googleMapsLinks` was not granted.
 *
 * Preferred order is the other way round - see LINK_FIELD. These two
 * `search.google.com/local/*` forms are a long-standing pattern rather than a
 * documented endpoint, so they are the safety net, not the first choice. They
 * are still worth keeping: they need nothing but the place_id, so a deployment
 * on a cheaper Places SKU gets working review links rather than none.
 */
export function googleReviewsUrl(placeId: string): string {
  return `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`;
}

export function googleWriteReviewUrl(placeId: string): string {
  return `https://search.google.com/local/writereview?placeid=${encodeURIComponent(placeId)}`;
}

/* ------------------------------------------------------------------ */
/* Resolving whatever the owner pasted into a place_id                 */
/* ------------------------------------------------------------------ */

/** Hosts that hand out short links which have to be followed to be read. */
const SHORT_LINK_HOSTS = new Set([
  "maps.app.goo.gl",
  "goo.gl",
  "g.page",
  "g.co",
  "maps.google.com",
  "www.google.com",
  "google.com",
]);

function asUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    return new URL(trimmed);
  } catch {
    return null;
  }
}

/** `place_id=`, `placeid=` or a `ChIJ…`-shaped token anywhere in the URL. */
function placeIdFromUrl(url: URL): string | null {
  const direct =
    url.searchParams.get("place_id") ??
    url.searchParams.get("placeid") ??
    url.searchParams.get("placeId");
  if (direct?.trim()) return direct.trim();

  // Share links regularly carry the id inside the packed `!1s…` data segment
  // rather than a query parameter. No word boundary in front: there it is glued
  // straight onto a `1s` marker. The ChIJ prefix plus a 15-character minimum is
  // what keeps this from matching a business whose *name* starts with "Chi".
  const match = url.href.match(/(ChIJ[A-Za-z0-9_-]{15,})/);
  return match ? match[1] : null;
}

/**
 * The human-readable half of a maps URL: `/maps/place/Acme+Roofing/@38.5,…`.
 *
 * Worth having because a plain maps link carries no place_id at all - the name
 * is the only thing in it we can search on.
 */
function queryFromUrl(url: URL): string | null {
  const path = decodeURIComponent(url.pathname);
  const place = path.match(/\/maps\/place\/([^/@]+)/);
  if (place?.[1]) {
    const name = place[1].replace(/\+/g, " ").trim();
    if (name && !/^data=/.test(name)) return name;
  }
  const q = url.searchParams.get("q") ?? url.searchParams.get("query");
  return q?.trim() || null;
}

/**
 * Everything that can be learned from a pasted link without a network call.
 *
 * Split out and exported because this is where the format zoo lives - a Maps
 * share link, a `g.page/r/…/review` shortcut, a browser address bar, a Business
 * Profile dashboard link - and every one of them has to keep resolving after
 * anyone edits this. `needsExpanding` says whether the caller should follow a
 * redirect before believing a null.
 */
export function parseGoogleBusinessLink(input: string): {
  placeId: string | null;
  query: string | null;
  needsExpanding: boolean;
} {
  const url = asUrl(input);
  if (!url) {
    // Not a URL at all: they typed "Acme Roofing, Sacramento".
    return { placeId: null, query: input.trim() || null, needsExpanding: false };
  }
  return {
    placeId: placeIdFromUrl(url),
    query: queryFromUrl(url),
    needsExpanding: SHORT_LINK_HOSTS.has(url.hostname.toLowerCase()),
  };
}

/**
 * Follows a shortened link far enough to read the real one.
 *
 * `g.page/r/<id>/review` in particular redirects straight onto a writereview
 * URL carrying the place_id, so following is often the whole resolution.
 */
async function expandShortLink(url: URL): Promise<URL> {
  try {
    const res = await fetch(url.href, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Google serves a consent interstitial to unrecognised agents, which
      // strips the place out of the URL we are trying to read.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; SitePix/1.0)" },
    });
    return new URL(res.url || url.href);
  } catch {
    return url;
  }
}

/**
 * Text search, used when the link had no place_id in it - which is the common
 * case for a plain "share" link off the Maps app.
 */
async function searchPlaceId(query: string): Promise<string | null> {
  const res = await fetch(`${PLACES_HOST}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 403 here is nearly always "Places API (New) is not enabled on this key",
    // which is an ops problem the contractor can do nothing about - so say so
    // rather than telling them their own business could not be found.
    if (res.status === 403) {
      badRequest("Google lookup isn't enabled for this server yet. Ask support to turn it on.");
    }
    badRequest(`Google couldn't look that up (${res.status}). ${body.slice(0, 140)}`);
  }
  const json = (await res.json()) as { places?: Array<{ id?: string }> };
  return json.places?.[0]?.id?.trim() || null;
}

/**
 * Turns a pasted link, or a typed "name + city", into a place_id.
 *
 * Order matters: an id already present in the URL is exact, and searching for
 * the name written beside it would only introduce a chance of resolving to the
 * wrong branch of the same franchise.
 */
async function resolvePlaceId(input: string): Promise<string | null> {
  const parsed = parseGoogleBusinessLink(input);
  if (parsed.placeId) return parsed.placeId;

  const url = asUrl(input);
  if (!url) return parsed.query ? searchPlaceId(parsed.query) : null;

  if (parsed.needsExpanding) {
    const expanded = await expandShortLink(url);
    const afterRedirect = placeIdFromUrl(expanded);
    if (afterRedirect) return afterRedirect;
    const expandedQuery = queryFromUrl(expanded) ?? parsed.query;
    return expandedQuery ? searchPlaceId(expandedQuery) : null;
  }

  return parsed.query ? searchPlaceId(parsed.query) : null;
}

/* ------------------------------------------------------------------ */
/* Place details                                                       */
/* ------------------------------------------------------------------ */

interface AddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
}

function componentOf(components: AddressComponent[], type: string, short = false): string | null {
  const hit = components.find((c) => c.types?.includes(type));
  if (!hit) return null;
  return (short ? hit.shortText : hit.longText)?.trim() || null;
}

/** One details GET at a given mask. Separated so the caller can retry narrower. */
function getPlace(placeId: string, mask: string): Promise<Response> {
  return fetch(`${PLACES_HOST}/places/${encodeURIComponent(placeId)}`, {
    headers: { "X-Goog-Api-Key": apiKey(), "X-Goog-FieldMask": mask },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function fetchProfile(placeId: string): Promise<GoogleBusinessProfile | null> {
  let res = await getPlace(placeId, DETAIL_FIELD_MASK);

  // A 400 means the mask was rejected, and googleMapsLinks is the only name in
  // it that an account can lack entitlement for. Retrying without it keeps a
  // billing difference between deployments from turning the whole feature into
  // an error message; the constructed review URLs cover the loss.
  if (res.status === 400) {
    res = await getPlace(placeId, DETAIL_FIELD_MASK_FALLBACK);
  }

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 403) {
      badRequest("Google lookup isn't enabled for this server yet. Ask support to turn it on.");
    }
    badRequest(`Google couldn't load that listing (${res.status}). ${body.slice(0, 140)}`);
  }

  const json = (await res.json()) as {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    addressComponents?: AddressComponent[];
    nationalPhoneNumber?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    rating?: number;
    userRatingCount?: number;
    googleMapsUri?: string;
    editorialSummary?: { text?: string };
    primaryTypeDisplayName?: { text?: string };
    googleMapsLinks?: { reviewsUri?: string; writeAReviewUri?: string; placeUri?: string };
  };

  const id = json.id?.trim() || placeId;
  const components = json.addressComponents ?? [];

  return {
    placeId: id,
    name: json.displayName?.text?.trim() || null,
    address: json.formattedAddress?.trim() || null,
    city: componentOf(components, "locality") ?? componentOf(components, "postal_town"),
    state: componentOf(components, "administrative_area_level_1", true),
    phone: json.nationalPhoneNumber?.trim() || json.internationalPhoneNumber?.trim() || null,
    website: json.websiteUri?.trim() || null,
    category: json.primaryTypeDisplayName?.text?.trim() || null,
    summary: json.editorialSummary?.text?.trim() || null,
    rating: typeof json.rating === "number" ? Math.round(json.rating * 10) / 10 : null,
    reviewCount: typeof json.userRatingCount === "number" ? json.userRatingCount : null,
    mapsUrl: json.googleMapsUri?.trim() || json.googleMapsLinks?.placeUri?.trim() || null,
    // Google's own URIs when the field was granted, the constructed forms when
    // it wasn't. Both are persisted by the caller, so a page view never depends
    // on which branch ran.
    reviewsUrl: json.googleMapsLinks?.reviewsUri?.trim() || googleReviewsUrl(id),
    writeReviewUrl: json.googleMapsLinks?.writeAReviewUri?.trim() || googleWriteReviewUrl(id),
  };
}

/* ------------------------------------------------------------------ */
/* RPCs                                                                */
/* ------------------------------------------------------------------ */

export const lookupGoogleBusinessInputSchema = z.object({
  /** A pasted Google link, or a typed "business name, city". */
  query: z.string().trim().min(3).max(500),
});

/**
 * Read-only. Finds the listing and hands it back for confirmation; writes
 * nothing, so a wrong match costs a second attempt rather than a restore.
 */
export async function lookupGoogleBusinessService(
  ctx: AuthedContext,
  data: z.infer<typeof lookupGoogleBusinessInputSchema>,
): Promise<{ found: boolean; profile: GoogleBusinessProfile | null }> {
  await requireTeamPlan(ctx, "The Portfolio site");
  const placeId = await resolvePlaceId(data.query);
  if (!placeId) return { found: false, profile: null };
  const profile = await fetchProfile(placeId);
  return { found: !!profile, profile };
}

/**
 * The fields the owner may choose to copy onto their site.
 *
 * Reviews are not in the list because they are not optional in the same sense:
 * connecting a listing at all is what wires the review links up, and a
 * connection whose whole point was the review link would be silently useless
 * if it could be unticked.
 */
const APPLIABLE_FIELDS = [
  "businessName",
  "phone",
  "address",
  "websiteUrl",
  "services",
  "serviceAreas",
  "heroSubhead",
] as const;

export const connectGoogleBusinessInputSchema = z.object({
  placeId: z.string().trim().min(5).max(300),
  /** Which of Google's values to copy onto the site. Empty = link only. */
  apply: z.array(z.enum(APPLIABLE_FIELDS)).max(APPLIABLE_FIELDS.length).default([]),
});

export interface ConnectGoogleBusinessResult {
  ok: true;
  profile: GoogleBusinessProfile;
  /** The site fields that actually changed, for the confirmation toast. */
  applied: string[];
  /**
   * The values written, keyed the way the builder's draft keys them.
   *
   * The builder holds an in-memory draft that it saves wholesale, so a write
   * that lands straight on the row is invisible to it - and the next Continue
   * would overwrite Google's answers with the empty inputs still on screen.
   * Handing the values back lets the draft absorb the same change.
   */
  values: Record<string, string | string[]>;
}

/**
 * Links the listing to the portfolio and copies across the chosen fields.
 *
 * Also writes the review link into `team_review_links`, which is what puts
 * "Leave us a review" on every job report the team shares from here on. That
 * table is the one both the report page and the portfolio read, so connecting
 * once lights up both surfaces - the report ask is the half the client cares
 * about, since the report is the only thing a customer ever receives.
 */
export async function connectGoogleBusinessService(
  ctx: AuthedContext,
  data: z.infer<typeof connectGoogleBusinessInputSchema>,
): Promise<ConnectGoogleBusinessResult> {
  await requireTeamPlan(ctx, "The Portfolio site");
  const teamId = await myTeamId(ctx);
  if (!teamId) badRequest("You need a team before you can connect a Google listing.");

  const profile = await fetchProfile(data.placeId);
  if (!profile) badRequest("That Google listing no longer exists. Try searching for it again.");

  const db = ctx.supabase as any;
  const { data: current } = await db
    .from("portfolios")
    .select("services, service_areas")
    .eq("team_id", teamId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    google_place_id: profile.placeId,
    google_maps_url: profile.mapsUrl,
    google_name: profile.name,
    google_rating: profile.rating,
    google_review_count: profile.reviewCount,
    google_reviews_url: profile.reviewsUrl,
    google_review_ask_url: profile.writeReviewUrl,
    google_synced_at: new Date().toISOString(),
  };

  const wants = new Set(data.apply);
  const applied: string[] = [];
  const values: Record<string, string | string[]> = {};
  const take = (field: string, column: string, value: unknown) => {
    if (!wants.has(field as (typeof APPLIABLE_FIELDS)[number])) return;
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) return;
    patch[column] = value;
    values[field] = value as string | string[];
    applied.push(field);
  };

  take("businessName", "business_name", profile.name);
  take("phone", "phone", profile.phone);
  take("address", "address", profile.address);
  take("websiteUrl", "website_url", profile.website);
  take("heroSubhead", "hero_subhead", profile.summary);

  // Merged rather than replaced: the category Google files a business under is
  // one trade, and a roofer who already typed three of them should not lose two
  // by connecting a listing.
  if (profile.category) {
    const existing: string[] = (current as any)?.services ?? [];
    const merged = Array.from(new Set([...existing, profile.category].map((s) => s.trim())))
      .filter(Boolean)
      .slice(0, 24);
    take("services", "services", merged.length > existing.length ? merged : null);
  }
  if (profile.city) {
    const existing: string[] = (current as any)?.service_areas ?? [];
    const label = profile.state ? `${profile.city}, ${profile.state}` : profile.city;
    const merged = Array.from(new Set([...existing, label].map((s) => s.trim())))
      .filter(Boolean)
      .slice(0, 40);
    take("serviceAreas", "service_areas", merged.length > existing.length ? merged : null);
  }

  const { data: updated, error } = await db
    .from("portfolios")
    .update(patch)
    .eq("team_id", teamId)
    .select("id")
    .maybeSingle();
  if (error) badRequest(error.message);
  if (!updated) {
    badRequest("Only the team owner or an admin can connect the Google listing.");
  }

  await upsertGoogleReviewLink(db, teamId, profile);

  return { ok: true, profile, applied, values };
}

/**
 * Keeps exactly one `google` row in team_review_links pointing at this listing.
 *
 * Replace-in-place rather than append: reconnecting after fixing a wrong match
 * must not leave the old listing's link sitting on every report.
 */
async function upsertGoogleReviewLink(
  db: any,
  teamId: string,
  profile: GoogleBusinessProfile,
): Promise<void> {
  const { data: rows } = await db
    .from("team_review_links")
    .select("id, platform")
    .eq("team_id", teamId);
  const existing = ((rows as Array<{ id: string; platform: string }>) ?? []).filter(
    (r) => r.platform === "google",
  );

  if (existing.length > 0) {
    await db
      .from("team_review_links")
      .update({ url: profile.writeReviewUrl, label: "Google" })
      .eq("id", existing[0].id);
    // Any duplicates left by an older connect are dropped, so the report shows
    // one button rather than three identical ones.
    const extras = existing.slice(1).map((r) => r.id);
    if (extras.length) await db.from("team_review_links").delete().in("id", extras);
    return;
  }

  // Position 0: the Google ask outperforms every other platform, and the report
  // page renders these in order.
  await db.from("team_review_links").insert({
    team_id: teamId,
    platform: "google",
    url: profile.writeReviewUrl,
    label: "Google",
    position: 0,
  });
}

/**
 * Re-reads the listing so the star rating on the site is not a fossil.
 *
 * Only the cached numbers move: a refresh must never quietly rewrite the
 * business name or phone number the owner has since corrected by hand.
 */
export async function refreshGoogleBusinessService(
  ctx: AuthedContext,
): Promise<{ ok: true; profile: GoogleBusinessProfile | null }> {
  await requireTeamPlan(ctx, "The Portfolio site");
  const teamId = await myTeamId(ctx);
  if (!teamId) badRequest("You need a team before you can refresh a Google listing.");

  const db = ctx.supabase as any;
  const { data: row } = await db
    .from("portfolios")
    .select("google_place_id")
    .eq("team_id", teamId)
    .maybeSingle();
  const placeId = (row as any)?.google_place_id as string | null;
  if (!placeId) badRequest("No Google listing is connected yet.");

  const profile = await fetchProfile(placeId);
  if (!profile) badRequest("That Google listing no longer exists. Connect it again.");

  await db
    .from("portfolios")
    .update({
      google_name: profile.name,
      google_maps_url: profile.mapsUrl,
      google_rating: profile.rating,
      google_review_count: profile.reviewCount,
      google_reviews_url: profile.reviewsUrl,
      google_review_ask_url: profile.writeReviewUrl,
      google_synced_at: new Date().toISOString(),
    })
    .eq("team_id", teamId);

  return { ok: true, profile };
}

/**
 * Unlinks the listing. Leaves team_review_links alone on purpose - the team may
 * have edited that row, and silently deleting the review ask from every future
 * job report is not something an "unlink" button should be able to do.
 */
export async function disconnectGoogleBusinessService(ctx: AuthedContext): Promise<{ ok: true }> {
  await requireTeamPlan(ctx, "The Portfolio site");
  const teamId = await myTeamId(ctx);
  if (!teamId) badRequest("You need a team before you can disconnect a Google listing.");

  const { error } = await (ctx.supabase as any)
    .from("portfolios")
    .update({
      google_place_id: null,
      google_maps_url: null,
      google_name: null,
      google_rating: null,
      google_review_count: null,
      google_reviews_url: null,
      google_review_ask_url: null,
      google_synced_at: null,
    })
    .eq("team_id", teamId);
  if (error) badRequest(error.message);
  return { ok: true };
}
