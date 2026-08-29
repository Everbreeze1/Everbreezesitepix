import { describe, expect, it } from "vitest";
import {
  byDistance,
  distanceLabel,
  distanceMetres,
  isRealCoord,
  locatable,
  mapUnavailable,
  regionFor,
} from "../apps/mobile/src/api/map-view";

/*
 * Map arithmetic.
 *
 * Two things here go wrong quietly and are worth pinning. A region computed
 * from a single pin has a zero span, which `react-native-maps` reads as "no
 * constraint" and answers with a view of the whole planet. And latitude 0 is a
 * real place, so a truthiness check silently drops every project on the
 * equator while looking completely correct in London.
 */

describe("isRealCoord", () => {
  it("accepts a real pair", () => {
    expect(isRealCoord(53.4808, -2.2426)).toEqual({ latitude: 53.4808, longitude: -2.2426 });
  });

  it("accepts a zero on one axis", () => {
    /*
     * Longitude 0 is most of London and latitude 0 is a boat off Ghana. A
     * truthiness check drops both, and the bug is invisible to anyone testing
     * from a city that is not on a zero line.
     */
    expect(isRealCoord(51.5, 0)).toEqual({ latitude: 51.5, longitude: 0 });
    expect(isRealCoord(0, -1.2)).toEqual({ latitude: 0, longitude: -1.2 });
  });

  it("rejects Null Island", () => {
    // What an unset pair defaults to in half the systems that produce one. A
    // project genuinely there would be in the Gulf of Guinea.
    expect(isRealCoord(0, 0)).toBeNull();
  });

  it("parses numeric strings, which is what some rows hold", () => {
    expect(isRealCoord("53.4808", "-2.2426")).toEqual({
      latitude: 53.4808,
      longitude: -2.2426,
    });
  });

  it("rejects anything out of range or not a number", () => {
    expect(isRealCoord(91, 0)).toBeNull();
    expect(isRealCoord(0, 181)).toBeNull();
    expect(isRealCoord(null, null)).toBeNull();
    expect(isRealCoord(undefined, 1)).toBeNull();
    expect(isRealCoord("north", "west")).toBeNull();
    expect(isRealCoord(NaN, 1)).toBeNull();
    expect(isRealCoord(Infinity, 1)).toBeNull();
  });
});

describe("locatable", () => {
  it("keeps only the rows that can be drawn, and narrows their type", () => {
    const out = locatable([
      { id: "a", latitude: 53.48, longitude: -2.24 },
      { id: "b", latitude: null, longitude: null },
      { id: "c", latitude: 0, longitude: 0 },
      { id: "d", latitude: "51.5", longitude: "-0.12" },
    ]);
    expect(out.map((r) => r.id)).toEqual(["a", "d"]);
    // Strings come back as numbers, so the caller can hand them straight to a
    // marker without parsing again.
    expect(out[1].latitude).toBe(51.5);
  });
});

describe("regionFor", () => {
  it("returns null for nothing, rather than a default over the Atlantic", () => {
    // So the caller can say "nothing to show" instead of drawing empty ocean.
    expect(regionFor([])).toBeNull();
  });

  it("never produces a zero span", () => {
    /*
     * The single-pin case, and the reason this function exists. A zero
     * `latitudeDelta` is read as "no constraint" and shows the whole planet
     * with one pin somewhere on it.
     */
    const region = regionFor([{ latitude: 53.48, longitude: -2.24 }])!;
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitudeDelta).toBeGreaterThan(0);
    expect(region.latitude).toBe(53.48);
  });

  it("centres on the bounding box and pads it", () => {
    const region = regionFor([
      { latitude: 50, longitude: -2 },
      { latitude: 54, longitude: 2 },
    ])!;
    expect(region.latitude).toBe(52);
    expect(region.longitude).toBe(0);
    // Padded, so the outermost pins are not half under the header and the tab
    // bar. Fitted exactly they would be.
    expect(region.latitudeDelta).toBeGreaterThan(4);
    expect(region.longitudeDelta).toBeGreaterThan(4);
  });

  it("copes with pins that share a coordinate", () => {
    // Two photos from the same spot. The span is zero before the floor applies.
    const region = regionFor([
      { latitude: 53.48, longitude: -2.24 },
      { latitude: 53.48, longitude: -2.24 },
    ])!;
    expect(region.latitudeDelta).toBeGreaterThan(0);
  });
});

describe("distanceMetres", () => {
  it("is zero for the same point", () => {
    const point = { latitude: 53.48, longitude: -2.24 };
    expect(distanceMetres(point, point)).toBe(0);
  });

  it("matches a known distance", () => {
    // Manchester to Liverpool, about 50km great-circle. Within 2%.
    const manchester = { latitude: 53.4808, longitude: -2.2426 };
    const liverpool = { latitude: 53.4084, longitude: -2.9916 };
    const metres = distanceMetres(manchester, liverpool);
    expect(metres).toBeGreaterThan(48_000);
    expect(metres).toBeLessThan(52_000);
  });

  it("is symmetric", () => {
    const a = { latitude: 53.48, longitude: -2.24 };
    const b = { latitude: 51.5, longitude: -0.12 };
    expect(distanceMetres(a, b)).toBeCloseTo(distanceMetres(b, a), 6);
  });

  it("does not blow up on antipodes", () => {
    // The `Math.min(1, ...)` clamp. Floating point can push the argument to
    // `asin` just past 1 here, which returns NaN and renders as an empty badge.
    const metres = distanceMetres(
      { latitude: 0, longitude: 0.0001 },
      { latitude: 0, longitude: 180 },
    );
    expect(Number.isFinite(metres)).toBe(true);
  });
});

describe("distanceLabel", () => {
  it("uses metres up close and kilometres beyond", () => {
    // Metres are the difference between this building and the next one. Nobody
    // walks 3,412 metres.
    expect(distanceLabel(0)).toBe("0 m");
    expect(distanceLabel(124)).toBe("120 m");
    expect(distanceLabel(999)).toBe("1000 m");
    expect(distanceLabel(1500)).toBe("1.5 km");
    expect(distanceLabel(3412)).toBe("3.4 km");
    expect(distanceLabel(52_000)).toBe("52 km");
  });
});

describe("byDistance", () => {
  const rows = [
    { id: "far", latitude: 51.5, longitude: -0.12 },
    { id: "near", latitude: 53.48, longitude: -2.25 },
  ];

  it("sorts nearest first and attaches the distance", () => {
    const out = byDistance(rows, { latitude: 53.4808, longitude: -2.2426 });
    expect(out.map((r) => r.id)).toEqual(["near", "far"]);
    expect(out[0].metres).toBeLessThan(out[1].metres!);
  });

  it("leaves the order alone with no fix, rather than guessing", () => {
    /*
     * A list that claims to be sorted by distance and is sorted by something
     * else is worse than an unsorted one: the reader trusts the first row.
     */
    const out = byDistance(rows, null);
    expect(out.map((r) => r.id)).toEqual(["far", "near"]);
    expect(out.every((r) => r.metres === null)).toBe(true);
  });
});

describe("mapUnavailable", () => {
  it("wants a key on Android and not on iOS", () => {
    // iOS draws through Apple Maps and needs nothing. Applying the check
    // everywhere would hide a working iOS map behind a warning.
    expect(mapUnavailable({ googleMapsConfigured: false, platform: "android", pinCount: 3 })).toBe(
      "no_key",
    );
    expect(
      mapUnavailable({ googleMapsConfigured: false, platform: "ios", pinCount: 3 }),
    ).toBeNull();
  });

  it("separates having no key from having no pins", () => {
    /*
     * Both look like "no map" and want different words. Collapsing them is how
     * somebody spends an afternoon looking for a bug in the wrong place.
     */
    expect(mapUnavailable({ googleMapsConfigured: true, platform: "android", pinCount: 0 })).toBe(
      "no_pins",
    );
    expect(
      mapUnavailable({ googleMapsConfigured: true, platform: "android", pinCount: 1 }),
    ).toBeNull();
  });

  it("reports the missing key even when there are also no pins", () => {
    // The key is the fixable one, and fixing it is what reveals whether there
    // are pins.
    expect(mapUnavailable({ googleMapsConfigured: false, platform: "android", pinCount: 0 })).toBe(
      "no_key",
    );
  });
});
