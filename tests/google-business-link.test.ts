import { describe, expect, it } from "vitest";
import {
  googleReviewsUrl,
  googleWriteReviewUrl,
  parseGoogleBusinessLink,
} from "../apps/api/src/domains/portfolio/google-business";

/**
 * "Connect your Google Business Profile" is only as good as its tolerance for
 * whatever a contractor pastes, and there is no single format to paste. Maps
 * hands out four different link shapes depending on whether you used the app,
 * the desktop site, the Share sheet or the Business Profile dashboard - and the
 * failure mode when parsing regresses is silent: the lookup falls through to a
 * text search and quietly connects a company in another state.
 *
 * So the pure half of the resolver is pinned here. Nothing in this file touches
 * the network; the Places calls are exercised against the real API, not mocked
 * into a test that would pass forever regardless.
 */

describe("parseGoogleBusinessLink", () => {
  it("takes a place_id straight out of a Business Profile share link", () => {
    const parsed = parseGoogleBusinessLink(
      "https://search.google.com/local/writereview?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    );
    expect(parsed.placeId).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
  });

  it("reads the ?place_id= form as well as ?placeid=", () => {
    const parsed = parseGoogleBusinessLink(
      "https://www.google.com/maps/place/?q=place_id:ignored&place_id=ChIJrTLr-GyuEmsRBfy61i59si0",
    );
    expect(parsed.placeId).toBe("ChIJrTLr-GyuEmsRBfy61i59si0");
  });

  it("finds a place id embedded in a path rather than a query", () => {
    const parsed = parseGoogleBusinessLink(
      "https://www.google.com/maps/place/data=!4m2!3m1!1sChIJN1t_tDeuEmsRUsoyG83frY4",
    );
    expect(parsed.placeId).toBe("ChIJN1t_tDeuEmsRUsoyG83frY4");
  });

  it("falls back to the business name in a plain maps URL", () => {
    const parsed = parseGoogleBusinessLink(
      "https://www.google.com/maps/place/Everbreeze+Heating+And+Air/@38.58,-121.49,17z",
    );
    expect(parsed.placeId).toBeNull();
    expect(parsed.query).toBe("Everbreeze Heating And Air");
  });

  it("decodes an escaped name rather than searching for percent signs", () => {
    const parsed = parseGoogleBusinessLink(
      "https://www.google.com/maps/place/Dave%27s%20Roofing%20%26%20Siding/@38.58,-121.49,17z",
    );
    expect(parsed.query).toBe("Dave's Roofing & Siding");
  });

  it("flags a short link as needing a redirect before it can be read", () => {
    const parsed = parseGoogleBusinessLink("https://maps.app.goo.gl/aBcDeF123");
    expect(parsed.placeId).toBeNull();
    expect(parsed.needsExpanding).toBe(true);
  });

  it("treats g.page review shortcuts as expandable", () => {
    const parsed = parseGoogleBusinessLink("https://g.page/r/CQ1a2b3c4d5e/review");
    expect(parsed.needsExpanding).toBe(true);
  });

  it("does not try to expand a link that is already canonical", () => {
    const parsed = parseGoogleBusinessLink(
      "https://search.google.com/local/reviews?placeid=ChIJN1t_tDeuEmsRUsoyG83frY4",
    );
    expect(parsed.needsExpanding).toBe(false);
  });

  it("passes typed text through as a search query", () => {
    const parsed = parseGoogleBusinessLink("  Everbreeze Heating and Air, Sacramento  ");
    expect(parsed.placeId).toBeNull();
    expect(parsed.query).toBe("Everbreeze Heating and Air, Sacramento");
    expect(parsed.needsExpanding).toBe(false);
  });

  it("reads the ?q= parameter when there is no /maps/place/ segment", () => {
    const parsed = parseGoogleBusinessLink("https://www.google.com/maps?q=Acme+Roofing+Elk+Grove");
    expect(parsed.query).toBe("Acme Roofing Elk Grove");
  });

  it("returns nothing usable for an unrelated URL", () => {
    const parsed = parseGoogleBusinessLink("https://example.com/about");
    expect(parsed.placeId).toBeNull();
    expect(parsed.query).toBeNull();
  });
});

describe("review URLs", () => {
  const placeId = "ChIJN1t_tDeuEmsRUsoyG83frY4";

  it("builds the read-the-reviews link a prospect follows", () => {
    expect(googleReviewsUrl(placeId)).toBe(
      `https://search.google.com/local/reviews?placeid=${placeId}`,
    );
  });

  it("builds the leave-a-review link that lands on a job report", () => {
    expect(googleWriteReviewUrl(placeId)).toBe(
      `https://search.google.com/local/writereview?placeid=${placeId}`,
    );
  });

  it("escapes an id so a stray character cannot break out of the query string", () => {
    expect(googleReviewsUrl("a&b=c")).toBe(
      "https://search.google.com/local/reviews?placeid=a%26b%3Dc",
    );
  });
});
