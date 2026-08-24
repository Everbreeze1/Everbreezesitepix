import { describe, it, expect } from "vitest";
import { buildConfirmationUrl } from "../apps/api/src/domains/email/auth-send";

/*
 * The confirmation link is the one part of signup that nothing else in this
 * repo exercises: it is built on the server, rendered into an email, and only
 * fails when a human clicks it.
 *
 * It used to point straight at GoTrue's `/auth/v1/verify`. That showed the
 * customer a raw supabase.co subdomain, and because /verify spends its token on
 * a plain GET, link prescanners burned the token before the human clicked. It
 * now points at our own `/auth/confirm`, which exchanges the token from the
 * browser.
 */
describe("buildConfirmationUrl", () => {
  const base = {
    token_hash: "abc123",
    email_action_type: "signup",
    redirect_to: "https://www.everlumen.co/dashboard",
  };

  it("points at our own domain, never at supabase.co", () => {
    const url = buildConfirmationUrl({
      ...base,
      site_url: "https://ulmgvtuqjlzzadlwtiog.supabase.co/auth/v1",
    });
    expect(url).not.toContain("supabase.co");
    expect(url).not.toContain("/auth/v1/verify");
    expect(url.startsWith("https://www.everlumen.co/auth/confirm?")).toBe(true);
  });

  it("carries token_hash, type and next through", () => {
    const url = new URL(buildConfirmationUrl(base));
    expect(url.searchParams.get("token_hash")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.get("next")).toBe("/dashboard");
  });

  it("reduces redirect_to to a relative path", () => {
    /*
     * `next` is fed straight to navigate() on a page every new user visits, so
     * an absolute value would make our own confirmation email an open redirect.
     */
    const url = new URL(
      buildConfirmationUrl({ ...base, redirect_to: "https://evil.example.com/steal" }),
    );
    expect(url.origin).toBe("https://www.everlumen.co");
    const next = url.searchParams.get("next");
    expect(next).toBe("/steal");
    expect(next?.startsWith("//")).toBe(false);
  });

  it("omits next when Supabase did not send a redirect_to", () => {
    const url = new URL(buildConfirmationUrl({ token_hash: "t", email_action_type: "recovery" }));
    expect(url.searchParams.has("next")).toBe(false);
    expect(url.searchParams.get("type")).toBe("recovery");
  });

  it("keeps a recovery link headed for the password screen", () => {
    const url = new URL(
      buildConfirmationUrl({
        token_hash: "t",
        email_action_type: "recovery",
        redirect_to: "https://www.everlumen.co/reset-password",
      }),
    );
    expect(url.searchParams.get("next")).toBe("/reset-password");
    expect(url.searchParams.get("type")).toBe("recovery");
  });

  it("ignores site_url entirely - it points at GoTrue, not at the site", () => {
    for (const site_url of [
      undefined,
      "https://x.supabase.co",
      "https://x.supabase.co/auth/v1",
      "https://x.supabase.co/auth/v1/",
    ]) {
      const url = buildConfirmationUrl({ ...base, site_url });
      expect(url.startsWith("https://www.everlumen.co/auth/confirm?"), site_url).toBe(true);
    }
  });
});

describe("buildConfirmationUrl - which origin the link is minted on", () => {
  /*
   * GoTrue validates redirect_to against additional_redirect_urls before
   * calling the hook, so reusing its origin is what keeps a locally-run signup
   * landing back on the machine that started it. Anything unrecognised falls
   * back to production instead of being trusted.
   */
  const base = { token_hash: "t", email_action_type: "signup" };

  it("follows redirect_to onto our own hosts", () => {
    for (const [redirect_to, origin] of [
      ["https://www.everlumen.co/dashboard", "https://www.everlumen.co"],
      ["https://everlumen.co/dashboard", "https://everlumen.co"],
      ["http://localhost:5173/dashboard", "http://localhost:5173"],
      ["http://127.0.0.1:5173/dashboard", "http://127.0.0.1:5173"],
    ]) {
      expect(new URL(buildConfirmationUrl({ ...base, redirect_to })).origin, redirect_to).toBe(
        origin,
      );
    }
  });

  it("falls back to production for anything else", () => {
    for (const redirect_to of [
      "https://evil.example.com/x",
      "https://everlumen.co.evil.example.com/x",
      "not a url at all",
    ]) {
      expect(new URL(buildConfirmationUrl({ ...base, redirect_to })).origin, redirect_to).toBe(
        "https://www.everlumen.co",
      );
    }
  });
});

describe("buildConfirmationUrl - email change action types", () => {
  /*
   * Supabase's secure email change fires `email_change_current` (to the old
   * address) and `email_change_new` (to the new one). Those are hook action
   * types; `verifyOtp` only understands `email_change`, so passing them through
   * unchanged builds a link the exchange rejects.
   */
  const base = {
    token_hash: "tok",
    redirect_to: "https://www.everlumen.co/settings",
  };

  for (const action of ["email_change_current", "email_change_new", "email_change"]) {
    it(`${action} verifies as type=email_change`, () => {
      const url = new URL(buildConfirmationUrl({ ...base, email_action_type: action }));
      expect(url.searchParams.get("type")).toBe("email_change");
    });
  }

  it("leaves unrelated action types alone", () => {
    for (const action of ["signup", "recovery", "magiclink", "invite"]) {
      const url = new URL(buildConfirmationUrl({ ...base, email_action_type: action }));
      expect(url.searchParams.get("type")).toBe(action);
    }
  });
});

describe("buildConfirmationUrl - email change carries the right token", () => {
  /*
   * An email change mints two tokens: `token_hash` for the old address to
   * approve, `token_hash_new` for the new one to confirm. Handing the old
   * token to the new address confirms the wrong half and leaves the change
   * pending.
   */
  const base = {
    token_hash: "OLD_TOKEN",
    token_hash_new: "NEW_TOKEN",
  };

  it("the message to the NEW address uses token_hash_new", () => {
    for (const action of ["email_change", "email_change_new"]) {
      const url = new URL(buildConfirmationUrl({ ...base, email_action_type: action }));
      expect(url.searchParams.get("token_hash"), action).toBe("NEW_TOKEN");
    }
  });

  it("the message to the CURRENT address uses token_hash", () => {
    const url = new URL(
      buildConfirmationUrl({ ...base, email_action_type: "email_change_current" }),
    );
    expect(url.searchParams.get("token_hash")).toBe("OLD_TOKEN");
  });

  it("falls back to token_hash when no new token is present", () => {
    const url = new URL(
      buildConfirmationUrl({ token_hash: "ONLY_TOKEN", email_action_type: "email_change" }),
    );
    expect(url.searchParams.get("token_hash")).toBe("ONLY_TOKEN");
  });

  it("other flows are unaffected", () => {
    const url = new URL(buildConfirmationUrl({ ...base, email_action_type: "signup" }));
    expect(url.searchParams.get("token_hash")).toBe("OLD_TOKEN");
  });
});
