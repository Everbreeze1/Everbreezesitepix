import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseAddressComponents } from "@/hooks/use-site-location";

/*
 * Creating a project must not begin with typing an address.
 *
 * The person doing it is standing on the site. The device already knows where
 * that is, so the screen asks it on mount, reverse geocodes the answer and
 * fills the four address fields in - leaving the customer's name as the one
 * thing anybody has to type.
 *
 * Three things used to break that, and these tests exist so they cannot come
 * back:
 *
 *  1. Detection was started from the map's init effect, so it did not run until
 *     the Maps script had loaded AND the map div had mounted, which on the web
 *     meant not until step two of the flow.
 *  2. Both Google libraries were awaited behind one `ready` flag, so the
 *     address waited on map tiles that nobody needs in order to read a street
 *     name.
 *  3. A fix that arrived before the geocoder was dropped, which is the NORMAL
 *     ordering on a site connection: the device answers in milliseconds and the
 *     Maps script does not.
 *
 * Source text for the screens, as in tests/invariants.test.ts, because the repo
 * has no React + Google Maps harness to render against.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const HOOK = "apps/web/src/hooks/use-site-location.ts";
const WEB_PAGE = "apps/web/src/features/projects/pages/NewProjectPage.tsx";
const MOBILE_SCREEN = "apps/mobile/app/(app)/project-new.tsx";

describe("address components, whichever Google API they came from", () => {
  /** What `new google.maps.Geocoder().geocode()` returns. */
  const classic = [
    { types: ["street_number"], long_name: "1600", short_name: "1600" },
    { types: ["route"], long_name: "Amphitheatre Parkway", short_name: "Amphitheatre Pkwy" },
    { types: ["locality", "political"], long_name: "Mountain View", short_name: "Mountain View" },
    {
      types: ["administrative_area_level_1", "political"],
      long_name: "California",
      short_name: "CA",
    },
    { types: ["postal_code"], long_name: "94043", short_name: "94043" },
  ];

  /** What `place.fetchFields({ fields: ["addressComponents"] })` returns. */
  const places = classic.map((c) => ({
    types: c.types,
    longText: c.long_name,
    shortText: c.short_name,
  }));

  it("reads the classic Geocoder shape", () => {
    expect(parseAddressComponents(classic, "1600 Amphitheatre Pkwy, Mountain View, CA")).toEqual({
      street: "1600 Amphitheatre Parkway",
      city: "Mountain View",
      state: "CA",
      zip: "94043",
      formatted: "1600 Amphitheatre Pkwy, Mountain View, CA",
    });
  });

  it("reads the newer Places shape from the same parser", () => {
    // One parser, or the address you get from the search box and the address
    // you get from the pin disagree about the same building.
    expect(parseAddressComponents(places)).toEqual({
      ...parseAddressComponents(classic),
      formatted: "",
    });
  });

  it("abbreviates the state and spells out the city", () => {
    const parsed = parseAddressComponents(classic);
    // `state` is a 3-character input on the form, so the long name would be
    // truncated to "Cal" the first time anyone edited the field.
    expect(parsed.state).toBe("CA");
    expect(parsed.city).toBe("Mountain View");
  });

  it("falls through the city aliases the rest of the world uses", () => {
    // A UK address has no `locality`. Reading only that one is how a London
    // job came back with a street, a postcode and no town.
    const london = [
      { types: ["postal_town"], long_name: "London", short_name: "London" },
      { types: ["postal_code"], long_name: "SW1A 1AA", short_name: "SW1A 1AA" },
    ];
    expect(parseAddressComponents(london).city).toBe("London");

    const sub = [{ types: ["sublocality_level_1"], long_name: "Brooklyn", short_name: "Brooklyn" }];
    expect(parseAddressComponents(sub).city).toBe("Brooklyn");
  });

  it("returns empty strings rather than undefined for what is missing", () => {
    // The parsed address is spread straight into form state. `undefined` in
    // there turns a controlled input into an uncontrolled one.
    expect(parseAddressComponents([])).toEqual({
      street: "",
      city: "",
      state: "",
      zip: "",
      formatted: "",
    });
  });
});

describe("the address does not wait on the map", () => {
  const src = read(HOOK);

  it("loads the geocoding library before the map libraries", () => {
    const geocoding = src.indexOf('importLibrary("geocoding")');
    const maps = src.indexOf('importLibrary("maps")');
    expect(geocoding).toBeGreaterThan(-1);
    expect(maps).toBeGreaterThan(-1);
    // Geocoding is what produces the address, and the address is what the user
    // is waiting on. Awaiting the tiles first is a delay bought for nothing.
    expect(geocoding).toBeLessThan(maps);
  });

  it("keeps a fix that arrives before the geocoder does", () => {
    // The device answers in milliseconds, the Maps script does not. Dropping
    // the fix here left the pin right and the address blank.
    expect(src).toMatch(/pendingRef\.current = next;/);
    expect(src).toMatch(/pendingRef\.current = null;\s*lookup\(waiting\);/);
  });

  it("asks the device on mount, once", () => {
    expect(src).toMatch(/started\.current = true;\s*detect\(\);/);
  });

  it("stops queueing once the script has failed, rather than spinning for ever", () => {
    /*
     * The order that made this necessary: the script rejects almost at once
     * when the browser key is missing, while the device takes a second or two.
     * So the failure lands while the phase is still "locating", the effect
     * watching `mapsFailed` correctly leaves it alone, and the position then
     * arrives, sets "resolving" and queues itself for a geocoder that is never
     * coming. Nothing is left to notice, and the card spins for ever instead of
     * offering the address search.
     *
     * A ref rather than the state, because `lookup` has to stay stable - a
     * `lookup` that changed identity would rebuild the map on every fix.
     */
    expect(src).toMatch(/mapsDeadRef\.current = true;/);
    expect(src).toMatch(/if \(mapsDeadRef\.current\) setPhase\("pinned"\);/);
    const dead = src.indexOf("if (mapsDeadRef.current) setPhase");
    const queue = src.indexOf("pendingRef.current = next;");
    // The dead check has to come first, or the queue swallows the fix anyway.
    expect(dead).toBeGreaterThan(-1);
    expect(dead).toBeLessThan(queue);
  });

  it("says something when a lookup fails instead of showing an empty address", () => {
    // A quota error and a place with no address are different answers, and
    // swallowing the first makes it look like the second.
    expect(src).toMatch(/console\.(warn|error)\(/);
  });

  it("ignores a lookup that lands after a newer one", () => {
    // Two pins dropped in quick succession resolve out of order often enough
    // that without this the card settles on the address of the older one.
    expect(src).toMatch(/if \(id !== lookupRef\.current\) return;/);
  });
});

describe("the web project form asks for the customer, not the address", () => {
  const src = read(WEB_PAGE);

  it("starts locating before the flow branches on which step it is showing", () => {
    const hook = src.indexOf("useSiteLocation(");
    const branch = src.indexOf('if (step === "blueprint")');
    expect(hook).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(-1);
    // Detection used to live in the map's init effect, which does not run on
    // step one at all - so choosing a blueprint happened before anything had
    // asked the device anything.
    expect(hook).toBeLessThan(branch);
  });

  it("keeps geolocation in the hook rather than growing a second copy", () => {
    expect(src).not.toContain("navigator.geolocation");
  });

  it("keeps the four address inputs collapsed until something needs correcting", () => {
    // They sit above the customer field in source because they belong to the
    // location card, and below it on screen because the card starts closed. If
    // that default flips, the most prominent inputs on the page become the ones
    // the device already filled in.
    expect(src).toMatch(/const \[addressOpen, setAddressOpen\] = useState\(false\)/);
    // Unless there is nothing to confirm, in which case a refused permission
    // would otherwise land the user on a card with no way into it.
    expect(src).toMatch(/setAddressOpen\(true\)/);
  });

  it("asks for the customer outside any disclosure", () => {
    const at = src.indexOf('id="np-client"');
    expect(at).toBeGreaterThan(-1);
    const before = src.slice(0, at);
    // The one field this screen actually asks for cannot be behind a "show more".
    expect(before.lastIndexOf("</CollapsibleContent>")).toBeGreaterThan(
      before.lastIndexOf("<CollapsibleContent>"),
    );
  });

  it("puts the customer ahead of every optional field", () => {
    const customer = src.indexOf('id="np-client"');
    for (const optional of ['id="name"', 'id="np-client-contact"', 'id="np-number"']) {
      const at = src.indexOf(optional);
      expect(at).toBeGreaterThan(-1);
      expect(customer).toBeLessThan(at);
    }
  });

  it("builds the map from a callback ref so step two always gets one", () => {
    // The old effect keyed on `ready` alone and ran while the map div was still
    // unmounted on step one, then never again: a Team account with blueprints
    // reached step two and found a grey box where the map should be.
    expect(src).toContain("ref={attachMap}");
    expect(src).toMatch(/mapRef\.current = null;/);
  });

  it("does not overwrite an address field the user corrected", () => {
    expect(src).toMatch(/editedRef\.current\.has\("street"\)/);
    // Until they ask for a different location outright, at which point their
    // corrections are to an address they have just replaced.
    expect(src).toMatch(/editedRef\.current = new Set\(\)/);
  });
});

describe("the mobile project screen asks the phone first", () => {
  const src = read(MOBILE_SCREEN);

  it("locates on mount instead of waiting to be asked", () => {
    expect(src).toMatch(/useEffect\(\(\) => \{\s*void pinToMyLocation\(\);/);
  });

  it("puts the customer above the address fields", () => {
    const customer = src.indexOf('label="Customer"');
    const street = src.indexOf('label="Street"');
    expect(customer).toBeGreaterThan(-1);
    expect(street).toBeGreaterThan(-1);
    expect(customer).toBeLessThan(street);
  });

  it("does not gate Create on the locate it now starts by itself", () => {
    // `disabled={Boolean(busy)}` was fine while locating only ever happened on
    // a tap. Now that it runs on mount, the same expression leaves the button
    // dead for the first seconds of every visit, and indefinitely on a phone
    // that never gets a fix.
    const at = src.indexOf('label="Create project"');
    expect(at).toBeGreaterThan(-1);
    const button = src.slice(at, at + 800);
    expect(button).toContain('disabled={busy === "creating"}');
    expect(button).not.toContain("disabled={Boolean(busy)}");
  });

  it("still only fills address fields that are empty", () => {
    // Reverse geocoding runs behind whatever the crew is typing. Someone who
    // has already written the unit number knows it better than the geocoder.
    expect(src).toMatch(/setCity\(\(current\) => current \|\|/);
    expect(src).toMatch(/setZip\(\(current\) => current \|\|/);
  });
});
