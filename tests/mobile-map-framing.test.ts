import { describe, expect, it } from "vitest";
import {
  DEFAULT_REGION,
  initialMapRegion,
  mainCluster,
  MAP_STATUS_COLORS,
  mapStatusOf,
  mapStyleFor,
  matchesMapFilter,
  nearbyLine,
  pinColorFor,
} from "../apps/mobile/src/api/map-view";

/*
 * Where the map opens, and what colour a pin is.
 *
 * Reported from a device: "when i click on Maps it shows the whole world." The
 * frame was fitted to every pin, and one test job in Quezon City beside fifty
 * in Sacramento has a bounding box that spans the Pacific.
 */

const sac = (id: string, dLat = 0, dLng = 0) => ({
  id,
  latitude: 38.58 + dLat,
  longitude: -121.49 + dLng,
});
const manila = { id: "far", latitude: 14.65, longitude: 121.03 };

describe("mainCluster", () => {
  it("drops a pin on the other side of the world from the frame", () => {
    const pins = [sac("a"), sac("b", 0.1, 0.1), sac("c", -0.2, 0.3), manila];
    expect(mainCluster(pins).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("prefers the pins around the phone when it is near any", () => {
    const pins = [sac("a"), sac("b", 0.1, 0.1), manila];
    const inManila = { latitude: 14.6, longitude: 121.0 };
    expect(mainCluster(pins, inManila).map((p) => p.id)).toEqual(["far"]);
  });

  it("falls back to the busiest cluster when the phone is far from every pin", () => {
    const pins = [sac("a"), sac("b", 0.1, 0.1), manila];
    const inLondon = { latitude: 51.5, longitude: -0.12 };
    expect(mainCluster(pins, inLondon).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("leaves one pin, or none, alone", () => {
    expect(mainCluster([])).toEqual([]);
    expect(mainCluster([manila])).toEqual([manila]);
  });
});

describe("initialMapRegion", () => {
  it("frames the team's work at city scale, not the planet", () => {
    const region = initialMapRegion([sac("a"), sac("b", 0.2, 0.2), manila], null);
    expect(region.latitudeDelta).toBeLessThan(2);
    expect(region.longitudeDelta).toBeLessThan(2);
    expect(region.latitude).toBeGreaterThan(38);
  });

  it("uses the phone's location when there are no pins", () => {
    const region = initialMapRegion([], { latitude: 51.5, longitude: -0.12 });
    expect(region.latitude).toBe(51.5);
    expect(region.latitudeDelta).toBeLessThan(1);
  });

  it("falls back to a country, never the whole world", () => {
    expect(initialMapRegion([], null)).toEqual(DEFAULT_REGION);
    expect(DEFAULT_REGION.longitudeDelta).toBeLessThan(90);
  });
});

describe("status colours and filters", () => {
  it("uses the web map's four colours, archived winning over status", () => {
    expect(pinColorFor({ status: "active" })).toBe(MAP_STATUS_COLORS.active);
    expect(pinColorFor({ status: "active", archived: true })).toBe(MAP_STATUS_COLORS.archived);
    expect(mapStatusOf({ status: "lead" })).toBeNull();
    expect(pinColorFor({ status: "lead" })).not.toBe(MAP_STATUS_COLORS.active);
  });

  it("filters as the chips promise", () => {
    const archived = { status: "active", archived: true };
    expect(matchesMapFilter(archived, "archived")).toBe(true);
    expect(matchesMapFilter(archived, "active")).toBe(false);
    expect(matchesMapFilter(archived, "all")).toBe(false);
    expect(matchesMapFilter({ status: "on_hold" }, "all")).toBe(true);
    expect(matchesMapFilter({ status: "on_hold" }, "completed")).toBe(false);
  });
});

describe("nearbyLine", () => {
  it("says town and state, else the address, else that there is none", () => {
    expect(nearbyLine({ city: "Davis", state: "CA" })).toBe("Davis, CA");
    expect(nearbyLine({ location: "8103 Polo Crosse Avenue" })).toBe("8103 Polo Crosse Avenue");
    expect(nearbyLine({})).toBe("No address on file");
  });
});

describe("mapStyleFor", () => {
  it("mutes points of interest in both schemes, and the two differ", () => {
    for (const scheme of ["light", "dark"] as const) {
      expect(mapStyleFor(scheme).some((rule) => rule.featureType === "poi")).toBe(true);
    }
    expect(mapStyleFor("light")).not.toEqual(mapStyleFor("dark"));
  });
});
