import { describe, expect, it } from "vitest";
import { isShareLive, shareTogglePatch, shareUrl } from "../apps/mobile/src/api/share-links";

/*
 * Public share links built on the phone.
 *
 * Every path here has a matching route under `apps/web/src/routes/share.*`, and
 * the failure mode is one nothing on this side can detect: a link that looks
 * fine, gets sent to a customer, and 404s when they open it.
 */

describe("shareUrl", () => {
  it("builds the route each kind actually has on the web app", () => {
    const at = "https://everlumen.co";
    expect(shareUrl(at, "photos", "abc")).toBe("https://everlumen.co/share/photos/abc");
    expect(shareUrl(at, "projects", "abc")).toBe("https://everlumen.co/share/projects/abc");
    expect(shareUrl(at, "checklists", "abc")).toBe("https://everlumen.co/share/checklists/abc");
    expect(shareUrl(at, "workflows", "abc")).toBe("https://everlumen.co/share/workflows/abc");
    expect(shareUrl(at, "walkthroughs", "abc")).toBe("https://everlumen.co/share/walkthroughs/abc");
  });

  it("tolerates a trailing slash on the origin", () => {
    /*
     * `EXPO_PUBLIC_API_BASE_URL` is written both ways in practice, and
     * `https://everlumen.co//share/photos/x` is not the same URL to every
     * router.
     */
    expect(shareUrl("https://everlumen.co/", "photos", "abc")).toBe(
      "https://everlumen.co/share/photos/abc",
    );
    expect(shareUrl("https://everlumen.co///", "photos", "abc")).toBe(
      "https://everlumen.co/share/photos/abc",
    );
  });

  it("returns null rather than a half-formed link", () => {
    /*
     * The important case. A caller handed "/share/photos/undefined" would put
     * it in a text message quite happily, and the person receiving it has no
     * way to tell it was never a real link.
     */
    expect(shareUrl("", "photos", "abc")).toBeNull();
    expect(shareUrl("https://everlumen.co", "photos", null)).toBeNull();
    expect(shareUrl("https://everlumen.co", "photos", "")).toBeNull();
    expect(shareUrl("https://everlumen.co", "photos", "   ")).toBeNull();
  });

  it("trims whitespace off a token", () => {
    expect(shareUrl("https://everlumen.co", "photos", "  abc  ")).toBe(
      "https://everlumen.co/share/photos/abc",
    );
  });
});

describe("isShareLive", () => {
  it("needs a token and no revocation", () => {
    expect(isShareLive("abc", null)).toBe(true);
  });

  it("treats a revoked record as not shared even though it still has a token", () => {
    /*
     * The case a naive `Boolean(share_token)` gets wrong. Switching sharing off
     * stamps `revoked_at` and keeps the token, so that turning it back on
     * restores the same URL instead of invalidating one already sent.
     */
    expect(isShareLive("abc", "2026-08-29T10:00:00.000Z")).toBe(false);
  });

  it("is false with no token at all", () => {
    expect(isShareLive(null, null)).toBe(false);
    expect(isShareLive(null, "2026-08-29T10:00:00.000Z")).toBe(false);
  });
});

describe("shareTogglePatch", () => {
  it("clears the revocation when enabling", () => {
    expect(shareTogglePatch(true)).toEqual({ revoked_at: null });
  });

  it("stamps a revocation when disabling", () => {
    const at = () => new Date("2026-08-29T09:41:07.000Z");
    expect(shareTogglePatch(false, at)).toEqual({ revoked_at: "2026-08-29T09:41:07.000Z" });
  });

  it("never touches the token", () => {
    // Destroying the token would break links already handed out, which is the
    // opposite of what "turn sharing off for now" should mean.
    expect("share_token" in shareTogglePatch(false)).toBe(false);
    expect("share_token" in shareTogglePatch(true)).toBe(false);
  });
});
