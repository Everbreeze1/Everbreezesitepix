import { useCallback, useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

/**
 * The job site's location, found for the user rather than typed by them.
 *
 * Someone starting a project is standing on the site. Asking them to type a
 * street, a city, a state and a zip they can see out of the windscreen is the
 * slowest possible way to record where they already are, so this hook starts
 * asking the device the moment it mounts and turns the fix into a street
 * address. The screen using it only has to render what came back and let the
 * user correct it.
 *
 * Two loading stages, deliberately kept apart: the geocoding library is what
 * produces the address and is awaited first, so the address can appear before
 * the map tiles have drawn. Bundling them behind one `ready` flag is what made
 * the address wait on rendering a map nobody is looking at yet.
 */

/** The four parts a project stores, plus the single line Google formats them into. */
export interface SiteAddress {
  street: string;
  city: string;
  state: string;
  zip: string;
  formatted: string;
}

export interface SiteCoords {
  lat: number;
  lng: number;
}

/**
 * Where the address on screen came from.
 *
 * Shown to the user, because "we think this is where you are" and "you picked
 * this" deserve different amounts of trust. A detected address is the one worth
 * inviting a second look at.
 */
export type SiteAddressSource = "device" | "search" | "pin";

export type SiteLocationPhase =
  /** Asking the device where it is. */
  | "locating"
  /** Have coordinates, turning them into an address. */
  | "resolving"
  /** Address in hand. */
  | "found"
  /** Coordinates pinned, but no address came back for them. */
  | "pinned"
  /** The browser refused, usually because the permission was declined. */
  | "denied"
  /** No geolocation in this browser, or the device could never get a fix. */
  | "unavailable";

function pick(components: unknown[], type: string, short = false): string {
  const match = components.find((c) => {
    const types = (c as { types?: string[] } | null)?.types;
    return Array.isArray(types) && types.includes(type);
  }) as Record<string, string | undefined> | undefined;
  if (!match) return "";
  // The classic Geocoder returns snake_case, the newer Places classes camelCase,
  // and this parses results from both.
  return (
    (short ? (match.short_name ?? match.shortText) : (match.long_name ?? match.longText)) ?? ""
  );
}

/** Google's address components, flattened into the four fields a project stores. */
export function parseAddressComponents(components: unknown[], formatted = ""): SiteAddress {
  const street = `${pick(components, "street_number")} ${pick(components, "route")}`.trim();
  const city =
    pick(components, "locality") ||
    pick(components, "postal_town") ||
    pick(components, "sublocality") ||
    pick(components, "sublocality_level_1");
  return {
    street,
    city,
    state: pick(components, "administrative_area_level_1", true),
    zip: pick(components, "postal_code"),
    formatted,
  };
}

export interface SiteLocation {
  phase: SiteLocationPhase;
  coords: SiteCoords | null;
  address: SiteAddress | null;
  source: SiteAddressSource | null;
  /** Maps and marker libraries are loaded, so a map can be drawn. */
  mapsReady: boolean;
  /** Google Maps could not be loaded at all. Everything falls back to typing. */
  mapsFailed: boolean;
  /** Ask the device again. Called on mount already unless `auto` is false. */
  detect: () => void;
  /** Record a position the user chose, and look up its address. */
  pin: (coords: SiteCoords, source: SiteAddressSource) => void;
  /** Record an address the user picked from search, with its coordinates. */
  accept: (address: SiteAddress, coords: SiteCoords | null) => void;
}

export function useSiteLocation(options: { auto?: boolean } = {}): SiteLocation {
  const auto = options.auto ?? true;

  const [mapsReady, setMapsReady] = useState(false);
  const [mapsFailed, setMapsFailed] = useState(false);
  const [geocoderReady, setGeocoderReady] = useState(false);
  const geocoderRef = useRef<{
    geocode: (req: unknown) => Promise<{ results?: unknown[] }>;
  } | null>(null);

  const [phase, setPhase] = useState<SiteLocationPhase>(auto ? "locating" : "unavailable");
  const [coords, setCoords] = useState<SiteCoords | null>(null);
  const [address, setAddress] = useState<SiteAddress | null>(null);
  const [source, setSource] = useState<SiteAddressSource | null>(null);

  /*
   * A fix that arrived before the geocoder did. The device answers in a few
   * hundred milliseconds and the Maps script takes longer over a site
   * connection, so this is the normal ordering, not the edge case. Dropping the
   * fix here is what left the address blank on a slow network while the map
   * underneath it showed the right pin.
   */
  const pendingRef = useRef<SiteCoords | null>(null);
  /** Guards against an older lookup landing after a newer pin and overwriting it. */
  const lookupRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const google = () => (window as unknown as { google: any }).google;
    loadGoogleMaps()
      .then(async () => {
        await google().maps.importLibrary("geocoding");
        if (cancelled) return;
        geocoderRef.current = new (google().maps.Geocoder)();
        setGeocoderReady(true);
        await google().maps.importLibrary("maps");
        await google().maps.importLibrary("marker");
        if (cancelled) return;
        setMapsReady(true);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error("Google Maps could not be loaded", e);
        setMapsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const lookup = useCallback((next: SiteCoords) => {
    const geocoder = geocoderRef.current;
    if (!geocoder) {
      pendingRef.current = next;
      return;
    }
    const id = ++lookupRef.current;
    setPhase("resolving");
    void (async () => {
      try {
        const { results } = await geocoder.geocode({ location: { lat: next.lat, lng: next.lng } });
        if (id !== lookupRef.current) return;
        const first = results?.[0] as
          | { address_components?: unknown[]; formatted_address?: string }
          | undefined;
        if (!first) {
          setPhase("pinned");
          return;
        }
        setAddress(
          parseAddressComponents(first.address_components ?? [], first.formatted_address ?? ""),
        );
        setPhase("found");
      } catch (e) {
        if (id !== lookupRef.current) return;
        // Not fatal: the pin is still correct, the user just has to write the
        // address on it. Saying nothing here is what made a quota error look
        // like a place with no address.
        console.warn("Reverse geocode failed", e);
        setPhase("pinned");
      }
    })();
  }, []);

  // Flush a fix that beat the geocoder to it.
  useEffect(() => {
    if (!geocoderReady) return;
    const waiting = pendingRef.current;
    if (!waiting) return;
    pendingRef.current = null;
    lookup(waiting);
  }, [geocoderReady, lookup]);

  // Nothing is coming. Leave the pin, stop implying an address is on its way.
  useEffect(() => {
    if (!mapsFailed) return;
    pendingRef.current = null;
    setPhase((p) => (p === "resolving" ? "pinned" : p));
  }, [mapsFailed]);

  const pin = useCallback(
    (next: SiteCoords, from: SiteAddressSource) => {
      setCoords(next);
      setSource(from);
      setPhase("resolving");
      lookup(next);
    },
    [lookup],
  );

  const accept = useCallback((next: SiteAddress, at: SiteCoords | null) => {
    // A place the user picked by name is already the answer. Reverse geocoding
    // its coordinates would only round-trip to a worse version of it.
    lookupRef.current += 1;
    pendingRef.current = null;
    setAddress(next);
    setSource("search");
    setPhase("found");
    if (at) setCoords(at);
  }, []);

  const detect = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPhase("unavailable");
      return;
    }
    setPhase("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSource("device");
        setPhase("resolving");
        lookup({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        /*
         * A refusal is a normal answer here, not an error to shout about: the
         * screen switches to the address search and the user carries on. Only
         * the phase changes, so nothing pops a toast over a form they are
         * already typing in.
         */
        setPhase(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable");
      },
      // `maximumAge` matters more than accuracy on arrival: a fix taken a minute
      // ago while walking up the drive is the same site, and it returns
      // instantly instead of spinning for several seconds.
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, [lookup]);

  // Started on mount, before the user has done anything, because the whole
  // point is that the address is waiting for them rather than the other way
  // round. Once only: a re-render must not re-prompt.
  const started = useRef(false);
  useEffect(() => {
    if (!auto || started.current) return;
    started.current = true;
    detect();
  }, [auto, detect]);

  return {
    phase,
    coords,
    address,
    source,
    mapsReady,
    mapsFailed,
    detect,
    pin,
    accept,
  };
}
