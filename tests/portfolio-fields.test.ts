import { describe, expect, it } from "vitest";
import {
  humanizeServiceType,
  normalizeExternalUrl,
  serviceAreaKey,
  mergeServiceArea,
  looksLikeStreetAddress,
  withoutStreetAddress,
} from "../packages/shared/src/portfolio-fields";

/**
 * The portfolio's freeform fields, pinned.
 *
 * Every case here is a thing that shipped to a live public page: a CTA button
 * with no scheme that resolved against the current URL, a service badge
 * printing the raw project tag, the same town listed twice, and a customer's
 * street address in the summary under a project card. The rules are cheap; the
 * reason they are tested is that the failure is always silent - the builder
 * looks right and the public site is wrong.
 */

describe("humanizeServiceType", () => {
  it("un-slugs the value auto-filled from a project tag", () => {
    expect(humanizeServiceType("led-lighting")).toBe("LED Lighting");
    expect(humanizeServiceType("roof_replacement")).toBe("Roof Replacement");
    expect(humanizeServiceType("kitchen-remodel")).toBe("Kitchen Remodel");
  });

  it("capitalises a hurried lowercase entry", () => {
    expect(humanizeServiceType("roof replacement")).toBe("Roof Replacement");
  });

  it("leaves anything already carrying a capital exactly as typed", () => {
    // The opt-out. Re-casing these is how "Tear-off & re-roof" becomes worse
    // than what the user wrote.
    expect(humanizeServiceType("LED Lighting")).toBe("LED Lighting");
    expect(humanizeServiceType("Tear-off & re-roof")).toBe("Tear-off & re-roof");
    expect(humanizeServiceType("McGraw Method")).toBe("McGraw Method");
  });

  it("knows the trade shorthand that should not be title-cased", () => {
    expect(humanizeServiceType("hvac")).toBe("HVAC");
    expect(humanizeServiceType("pvc-decking")).toBe("PVC Decking");
  });

  it("collapses whitespace and survives empties", () => {
    expect(humanizeServiceType("  roofing   work ")).toBe("Roofing Work");
    expect(humanizeServiceType("")).toBe("");
    expect(humanizeServiceType(null)).toBe("");
    expect(humanizeServiceType(undefined)).toBe("");
  });
});

describe("normalizeExternalUrl", () => {
  it("adds the scheme a contractor leaves off", () => {
    expect(normalizeExternalUrl("acmeroofing.com")).toBe("https://acmeroofing.com");
    expect(normalizeExternalUrl("www.acmeroofing.com/quote")).toBe(
      "https://www.acmeroofing.com/quote",
    );
  });

  it("leaves a complete link alone, trailing slash and all", () => {
    expect(normalizeExternalUrl("https://acmeroofing.com/quote")).toBe(
      "https://acmeroofing.com/quote",
    );
    expect(normalizeExternalUrl("http://acmeroofing.com")).toBe("http://acmeroofing.com");
  });

  it("keeps mailto and tel links, which are valid CTA targets", () => {
    expect(normalizeExternalUrl("mailto:hello@acme.com")).toBe("mailto:hello@acme.com");
    expect(normalizeExternalUrl("tel:+19165550142")).toBe("tel:+19165550142");
  });

  it("refuses what can never be a working link", () => {
    expect(normalizeExternalUrl("call us for a quote")).toBeNull();
    expect(normalizeExternalUrl("roofing")).toBeNull();
    expect(normalizeExternalUrl("")).toBeNull();
    expect(normalizeExternalUrl(null)).toBeNull();
  });

  it("refuses schemes that have no business in an href", () => {
    expect(normalizeExternalUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeExternalUrl("data:text/html,<script>")).toBeNull();
  });
});

describe("mergeServiceArea", () => {
  it("adds a town that is not there yet", () => {
    expect(mergeServiceArea(["Sacramento"], "Elk Grove")).toEqual(["Sacramento", "Elk Grove"]);
  });

  it("ignores an exact repeat, whatever the casing", () => {
    expect(mergeServiceArea(["Sacramento"], "sacramento")).toEqual(["Sacramento"]);
  });

  it("folds the bare town into the qualified one", () => {
    expect(mergeServiceArea(["Sacramento"], "Sacramento, CA")).toEqual(["Sacramento, CA"]);
    expect(mergeServiceArea(["Sacramento, CA"], "Sacramento")).toEqual(["Sacramento, CA"]);
  });

  it("keeps two different towns that share a name", () => {
    // The reason this merge lives in the editor and not in a server-side
    // dedupe: these are genuinely two places.
    expect(mergeServiceArea(["Springfield, IL"], "Springfield, MO")).toEqual([
      "Springfield, IL",
      "Springfield, MO",
    ]);
  });

  it("drops blanks", () => {
    expect(mergeServiceArea(["Sacramento"], "   ")).toEqual(["Sacramento"]);
  });
});

describe("serviceAreaKey", () => {
  it("keys on the town alone", () => {
    expect(serviceAreaKey("Sacramento, CA")).toBe("sacramento");
    expect(serviceAreaKey("  elk grove ")).toBe("elk grove");
    expect(serviceAreaKey("St. Helena, CA")).toBe("st helena");
  });
});

describe("looksLikeStreetAddress", () => {
  it("catches the address the generated summary used to carry", () => {
    expect(looksLikeStreetAddress("Oak Street Reroof - 1200 J St, Sacramento, CA")).toBe(true);
    expect(looksLikeStreetAddress("4417 Winding Way, Sacramento")).toBe(true);
  });

  it("catches UK street types too", () => {
    // The first real showcase this ran against. A US-only list of street words
    // passes this straight through, which is the failure that matters: it
    // looks like the check is working right up until it isn't.
    expect(looksLikeStreetAddress("20 Charlcote Crescent, Crewe, England")).toBe(true);
    expect(looksLikeStreetAddress("14 Ashfield Gardens, Manchester")).toBe(true);
    expect(looksLikeStreetAddress("3 Bakers Mews, London")).toBe(true);
  });

  it("does not flag ordinary copy that happens to have a number or a street word", () => {
    expect(looksLikeStreetAddress("Full tear-off on a 1960s ranch")).toBe(false);
    expect(looksLikeStreetAddress("Oak Street Reroof")).toBe(false);
    expect(looksLikeStreetAddress("Sacramento, CA")).toBe(false);
    expect(looksLikeStreetAddress("")).toBe(false);
  });
});

describe("withoutStreetAddress", () => {
  it("keeps the job name and the town, loses the street", () => {
    expect(withoutStreetAddress("Oak Street Reroof - 1200 J St, Sacramento, CA")).toBe(
      "Oak Street Reroof, Sacramento, CA",
    );
  });

  it("leaves a line that names no street untouched", () => {
    expect(withoutStreetAddress("Full tear-off and re-roof, Sacramento, CA")).toBe(
      "Full tear-off and re-roof, Sacramento, CA",
    );
  });

  it("returns just the town when the street was the whole line", () => {
    expect(withoutStreetAddress("1200 J St, Sacramento, CA")).toBe("Sacramento, CA");
  });
});
