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
 * How close counts as "you are on this job".
 *
 * A few hundred metres: a Balanced fix is good to about a hundred, and a big
 * site plus its car park is easily another hundred or two. Past this the job
 * is still first in the list, just not called out as the one you are at.
 */
export const ON_SITE_METRES = 300;

/**
 * The capture picker's order: nearest job first, then the rest as they were.
 *
 * Unlike `byDistance`, rows with no usable coordinates are kept, not dropped,
 * because the picker has to offer every job, not only the geocoded ones. They
 * go after the located rows in their incoming order (the caller's
 * last-worked-on order). With no fix, nothing moves.
 */
export function nearestJobsFirst<T extends Locatable>(
  rows: T[],
  from: Coord | null,
): (T & { metres: number | null })[] {
  if (!from) return rows.map((row) => ({ ...row, metres: null }));
  const located: (T & { metres: number })[] = [];
  const rest: (T & { metres: null })[] = [];
  for (const row of rows) {
    const coord = isRealCoord(row.latitude, row.longitude);
    if (coord) located.push({ ...row, metres: distanceMetres(from, coord) });
    else rest.push({ ...row, metres: null });
  }
  // Array.prototype.sort is stable, so equal distances keep last-worked-on order.
  located.sort((a, b) => a.metres - b.metres);
  return [...located, ...rest];
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

/**
 * The map's four status filters, in the web's order. Archived is the
 * `archived` flag rather than a status, and "all" is every job not archived.
 */
export type MapStatus = "active" | "on_hold" | "completed" | "archived";
export type MapFilter = MapStatus | "all";

export const MAP_STATUSES: readonly MapStatus[] = ["active", "on_hold", "completed", "archived"];

export const MAP_STATUS_LABELS: Record<MapStatus, string> = {
  active: "Active",
  on_hold: "On hold",
  completed: "Completed",
  archived: "Archived",
};

/**
 * Pin colours, the web map's own four (`statusColor` in `MapPage.tsx`): active
 * green, on-hold warm amber, completed blue, archived warm grey. The same hexes
 * so a job is the same colour on the phone as on the office screen.
 */
export const MAP_STATUS_COLORS: Record<MapStatus, string> = {
  active: "#348f4f",
  on_hold: "#c56c21",
  completed: "#3c7ebe",
  archived: "#77746f",
};

/** An unknown status borrows a slate rather than inventing a fifth colour. */
const FALLBACK_PIN_COLOR = "#94a3b8";

type Statused = { status?: string | null; archived?: boolean | null };

/** Which of the four buckets a job is drawn in. Archived wins over its status. */
export function mapStatusOf(project: Statused): MapStatus | null {
  if (project.archived) return "archived";
  const status = project.status ?? "";
  return (MAP_STATUSES as readonly string[]).includes(status) ? (status as MapStatus) : null;
}

export function pinColorFor(project: Statused): string {
  const status = mapStatusOf(project);
  return status ? MAP_STATUS_COLORS[status] : FALLBACK_PIN_COLOR;
}

/** Whether a job shows under a filter. "all" is every job that is not archived. */
export function matchesMapFilter(project: Statused, filter: MapFilter): boolean {
  if (filter === "archived") return Boolean(project.archived);
  if (project.archived) return false;
  return filter === "all" || project.status === filter;
}

/**
 * How far out from the busiest pin a job still counts as "here", in metres.
 *
 * A service area rather than a continent: every job a crew drives to from one
 * yard fits comfortably inside it, and a job in another country does not.
 */
const CLUSTER_METRES = 250_000;

/**
 * The pins the map should open on.
 *
 * Fitting the frame to every pin is what made the map open on the whole
 * world: one test job in Quezon City and fifty in Sacramento have a bounding
 * box that spans the Pacific. So the frame is fitted to where the work is: the
 * pins around the phone when it is near any, otherwise the pins around the
 * busiest one. The outliers are still on the map, one pinch away; they just do
 * not get to choose the zoom.
 */
export function mainCluster<T extends Coord>(coords: T[], here: Coord | null = null): T[] {
  if (coords.length <= 1) return coords;

  const near = (a: Coord, b: Coord) => distanceMetres(a, b) <= CLUSTER_METRES;
  if (here) {
    const local = coords.filter((c) => near(here, c));
    if (local.length > 0) return local;
  }

  // Quadratic, so the anchor is chosen from a sample on a very large board.
  const candidates = coords.length > 400 ? coords.slice(0, 400) : coords;
  let anchor = candidates[0];
  let best = -1;
  for (const candidate of candidates) {
    let count = 0;
    for (const other of coords) if (near(candidate, other)) count += 1;
    if (count > best) {
      best = count;
      anchor = candidate;
    }
  }
  return coords.filter((c) => near(anchor, c));
}

/**
 * Where the map opens when nothing is pinned and the phone has no fix: the
 * continental United States, where most of this app's crews work. A country,
 * which is a sensible thing to be looking at, rather than the planet.
 */
export const DEFAULT_REGION: Region = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 28,
  longitudeDelta: 34,
};

/** Around the phone, when there is nothing else to frame: a city, not a street. */
const AROUND_ME_DELTA = 0.25;

/**
 * The region the map opens on: the team's pins (the main cluster of them),
 * else the phone's own location, else `DEFAULT_REGION`. Never null, so the map
 * never falls back to its own whole-world default.
 */
export function initialMapRegion(coords: Coord[], here: Coord | null): Region {
  const fitted = regionFor(mainCluster(coords, here));
  if (fitted) return fitted;
  if (here) {
    return { ...here, latitudeDelta: AROUND_ME_DELTA, longitudeDelta: AROUND_ME_DELTA };
  }
  return DEFAULT_REGION;
}

/** The second line of a Nearby row: town and state, else whatever address there is. */
export function nearbyLine(project: {
  city?: string | null;
  state?: string | null;
  location?: string | null;
  street?: string | null;
}): string {
  const town = [project.city, project.state]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
  if (town) return town;
  return project.location?.trim() || project.street?.trim() || "No address on file";
}

type MapStyleRule = {
  featureType?: string;
  elementType?: string;
  stylers: Record<string, string | number>[];
};

/**
 * The Google map's style, in the app's warm palette.
 *
 * The web map mutes the base map to a pale wash so the coloured pins carry the
 * page; this does the same in the app's cream and umber rather than the web's
 * blue-grey, with points of interest and transit switched off for the same
 * reason. Android only: Apple Maps takes no style, just light or dark.
 */
export function mapStyleFor(scheme: "light" | "dark"): MapStyleRule[] {
  const c =
    scheme === "dark"
      ? {
          land: "#211c15",
          label: "#a69d91",
          halo: "#18130d",
          border: "#3a3127",
          road: "#2f281e",
          highway: "#3d3428",
          water: "#141a1f",
        }
      : {
          land: "#f6f0e8",
          label: "#8a7f72",
          halo: "#f9f4ee",
          border: "#e0d6c9",
          road: "#ffffff",
          highway: "#f1e2cf",
          water: "#dfe9ee",
        };
  return [
    { elementType: "geometry", stylers: [{ color: c.land }] },
    { elementType: "labels.text.fill", stylers: [{ color: c.label }] },
    { elementType: "labels.text.stroke", stylers: [{ color: c.halo }] },
    {
      featureType: "administrative",
      elementType: "geometry.stroke",
      stylers: [{ color: c.border }],
    },
    { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
    { featureType: "poi", stylers: [{ visibility: "off" }] },
    { featureType: "road", elementType: "geometry", stylers: [{ color: c.road }] },
    { featureType: "road", elementType: "labels.icon", stylers: [{ visibility: "off" }] },
    { featureType: "road.highway", elementType: "geometry", stylers: [{ color: c.highway }] },
    { featureType: "transit", stylers: [{ visibility: "off" }] },
    { featureType: "water", elementType: "geometry", stylers: [{ color: c.water }] },
    { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: c.label }] },
  ];
}
