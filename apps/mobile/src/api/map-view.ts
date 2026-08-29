/**
 * Putting projects and photos on a map, as arithmetic.
 *
 * Import-free so it can be tested, and worth testing because map maths is easy
 * to get subtly wrong in ways that only show at the edges: a region computed
 * from one pin is zero-sized and renders as a view of the whole planet, and a
 * latitude of 0 is a real place off the coast of Ghana that a truthiness check
 * silently discards.
 */

export type Coord = { latitude: number; longitude: number };

export type MapPin = Coord & {
  id: string;
  title: string;
  subtitle?: string | null;
  kind: "project" | "photo";
};

/** Anything with a lat/lng pair on it, whatever the row calls them. */
export type Locatable = {
  id: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

/**
 * Whether a coordinate is real.
 *
 * `0` is a valid latitude and a valid longitude, so every check here is against
 * the type and the range rather than truthiness. A row at 0,0 in Null Island is
 * almost certainly bad data, but a row at latitude 0 and longitude -1.2 is a
 * boat off Ghana and a row at longitude 0 is most of London, so only the exact
 * pair is rejected.
 */
export function isRealCoord(
  latitude: unknown,
  longitude: unknown,
): { latitude: number; longitude: number } | null {
  const lat = typeof latitude === "string" ? Number(latitude) : latitude;
  const lng = typeof longitude === "string" ? Number(longitude) : longitude;

  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // Null Island: what an unset pair defaults to in half the systems that
  // produce one. A project genuinely there would be in the Gulf of Guinea.
  if (lat === 0 && lng === 0) return null;

  return { latitude: lat, longitude: lng };
}

/** The rows that can actually be drawn. */
export function locatable<T extends Locatable>(rows: T[]): (T & Coord)[] {
  const out: (T & Coord)[] = [];
  for (const row of rows) {
    const coord = isRealCoord(row.latitude, row.longitude);
    if (coord) out.push({ ...row, ...coord });
  }
  return out;
}

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Never smaller than this, in degrees.
 *
 * A region computed from a single pin has a span of zero, and `react-native-maps`
 * reads that as "no constraint" and shows the whole planet. Roughly 1km, which
 * is a street rather than a continent.
 */
const MIN_DELTA = 0.01;

/**
 * Enough padding that pins are not on the edge of the screen.
 *
 * A bounding box fitted exactly puts the outermost pins half under the header
 * and half under the tab bar. 40% is what makes every pin visibly inside the
 * frame rather than technically inside it.
 */
const PADDING = 1.4;

/**
 * The region that shows all of them.
 *
 * Returns null for an empty list rather than a default region over the Atlantic,
 * so the caller can say "nothing to show" rather than drawing an empty ocean.
 */
export function regionFor(coords: Coord[]): Region | null {
  if (coords.length === 0) return null;

  let minLat = coords[0].latitude;
  let maxLat = coords[0].latitude;
  let minLng = coords[0].longitude;
  let maxLng = coords[0].longitude;

  for (const c of coords) {
    if (c.latitude < minLat) minLat = c.latitude;
    if (c.latitude > maxLat) maxLat = c.latitude;
    if (c.longitude < minLng) minLng = c.longitude;
    if (c.longitude > maxLng) maxLng = c.longitude;
  }

  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(MIN_DELTA, (maxLat - minLat) * PADDING),
    longitudeDelta: Math.max(MIN_DELTA, (maxLng - minLng) * PADDING),
  };
}

/**
 * Great-circle distance in metres.
 *
 * Used to answer "which job am I standing on", which is the one question a map
 * on a phone gets asked more than "where is everything". Haversine rather than
 * a flat approximation because the flat one is wrong by enough to matter at the
 * latitudes this app is used at, and it costs nothing.
 */
export function distanceMetres(a: Coord, b: Coord): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far away, in words somebody can act on.
 *
 * Metres up close because that is the difference between this building and the
 * next one, kilometres past that because nobody walks 3,412 metres.
 */
export function distanceLabel(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  if (metres < 10_000) return `${(metres / 1000).toFixed(1)} km`;
  return `${Math.round(metres / 1000)} km`;
}

/**
 * Nearest first, with distances attached.
 *
 * The whole reason to open a map on a phone: the crew is somewhere and wants
 * the job they are at. Without a fix, order is left alone rather than guessed
 * at, because a list claiming to be sorted by distance and sorted by something
 * else is worse than an unsorted one.
 */
export function byDistance<T extends Coord>(
  rows: T[],
  from: Coord | null,
): (T & { metres: number | null })[] {
  if (!from) return rows.map((row) => ({ ...row, metres: null }));
  return rows
    .map((row) => ({ ...row, metres: distanceMetres(from, row) }))
    .sort((a, b) => a.metres - b.metres);
}

/**
 * What the screen says when it cannot draw a map.
 *
 * Three distinct situations that all look like "no map" and want different
 * words: nothing has coordinates, the build has no Maps key, or the platform
 * cannot render one. Collapsing them into one message is how somebody spends an
 * afternoon looking for a bug in the wrong place.
 */
export type MapUnavailable = "no_key" | "no_pins" | null;

export function mapUnavailable(opts: {
  googleMapsConfigured: boolean;
  platform: string;
  pinCount: number;
}): MapUnavailable {
  // iOS draws through Apple Maps and needs no key at all, so the key check is
  // Android-only. Applying it everywhere would hide a working iOS map.
  if (opts.platform === "android" && !opts.googleMapsConfigured) return "no_key";
  if (opts.pinCount === 0) return "no_pins";
  return null;
}
