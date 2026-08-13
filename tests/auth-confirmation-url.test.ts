import { describe, it, expect } from "vitest";
import { buildConfirmationUrl } from "../apps/api/src/domains/email/auth-send";

/*
 * The confirmation link is the one part of signup that nothing in this repo
 * exercises: it is built on the server, rendered into an email, and only fails
 * when a human clicks it — at which point Supabase reports
 * `{"message":"No API key found in request"}`, which points at authentication
 * rather than at the doubled `/auth/v1/auth/v1/` path that actually caused it.
 */
describe("buildConfirmationUrl", () => {
  const base = {
    token_hash: "abc123",
    email_action_type: "signup",
    redirect_to: "https://www.everbreezesitepix.com/dashboard",
  };

  it("does not double /auth/v1 when Supabase sends the GoTrue base", () => {
    const url = buildConfirmationUrl({
      ...base,
      site_url: "https://ulmgvtuqjlzzadlwtiog.supabase.co/auth/v1",
    });
    expect(url).not.toContain("/auth/v1/auth/v1");
    expect(url.startsWith("https://ulmgvtuqjlzzadlwtiog.supabase.co/auth/v1/verify?")).toBe(true);
  });

  it("still appends /auth/v1/verify to a bare origin", () => {
    const url = buildConfirmationUrl({
      ...base,
      site_url: "https://ulmgvtuqjlzzadlwtiog.supabase.co",
    });
    expect(url.startsWith("https://ulmgvtuqjlzzadlwtiog.supabase.co/auth/v1/verify?")).toBe(true);
  });

  it("tolerates a trailing slash on either form", () => {
    for (const site_url of [
      "https://x.supabase.co/",
      "https://x.supabase.co/auth/v1/",
    ]) {
      const url = buildConfirmationUrl({ ...base, site_url });
      expect(url.startsWith("https://x.supabase.co/auth/v1/verify?")).toBe(true);
      expect(url).not.toContain("//auth");
      expect(url).not.toContain("/auth/v1/auth/v1");
    }
  });

  it("carries token, type and redirect_to through", () => {
    const url = new URL(
      buildConfirmationUrl({ ...base, site_url: "https://x.supabase.co/auth/v1" }),
    );
    expect(url.searchParams.get("token")).toBe("abc123");
    expect(url.searchParams.get("type")).toBe("signup");
    expect(url.searchParams.get("redirect_to")).toBe(
      "https://www.everbreezesitepix.com/dashboard",
    );
  });

  it("omits redirect_to when Supabase did not send one", () => {
    const url = new URL(
      buildConfirmationUrl({
        token_hash: "t",
        email_action_type: "recovery",
        site_url: "https://x.supabase.co/auth/v1",
      }),
    );
    expect(url.searchParams.has("redirect_to")).toBe(false);
    expect(url.searchParams.get("type")).toBe("recovery");
  });

  it("falls back to the product domain when site_url is absent", () => {
    const url = buildConfirmationUrl({ ...base, site_url: undefined });
    expect(url.startsWith("https://everbreezesitepix.com/auth/v1/verify?")).toBe(true);
  });
});

describe("buildConfirmationUrl — email change action types", () => {
  /*
   * Supabase's secure email change fires `email_change_current` (to the old
   * address) and `email_change_new` (to the new one). Those are hook action
   * types; GoTrue's /verify endpoint only understands `email_change`, so
   * passing them through unchanged builds a link the endpoint rejects.
   */
  const base = {
    token_hash: "tok",
    site_url: "https://x.supabase.co/auth/v1",
    redirect_to: "https://www.everbreezesitepix.com/settings",
  };

  for (const action of ["email_change_current", "email_change_new", "email_change"]) {
    it(`${action} verifies as type=email_change`, () => {
      const url = new URL(buildConfirmationUrl({ ...base, email_action_type: action }));
      expect(url.searchParams.get("type")).toBe("email_change");
    });
  }

  it("leaves unrelated action types alone", () => {
    for (const action of ["signup", "recovery", "magiclink", "invite", "reauthentication"]) {
      const url = new URL(buildConfirmationUrl({ ...base, email_action_type: action }));
      expect(url.searchParams.get("type")).toBe(action);
    }
  });
});

describe("buildConfirmationUrl — email change carries the right token", () => {
  /*
   * An email change mints two tokens: `token_hash` for the old address to
   * approve, `token_hash_new` for the new one to confirm. Handing the old
   * token to the new address confirms the wrong half and leaves the change
   * pending.
   */
  const base = {
    site_url: "https://x.supabase.co/auth/v1",
    token_hash: "OLD_TOKEN",
    token_hash_new: "NEW_TOKEN",
  };

  it("the message to the NEW address uses token_hash_new", () => {
    for (const action of ["email_change", "email_change_new"]) {
      const url = new URL(buildConfirmationUrl({ ...base, email_action_type: action }));
      expect(url.searchParams.get("token"), action).toBe("NEW_TOKEN");
    }
  });

  it("the message to the CURRENT address uses token_hash", () => {
    const url = new URL(
      buildConfirmationUrl({ ...base, email_action_type: "email_change_current" }),
    );
    expect(url.searchParams.get("token")).toBe("OLD_TOKEN");
  });

  it("falls back to token_hash when no new token is present", () => {
    const url = new URL(
      buildConfirmationUrl({
        site_url: base.site_url,
        token_hash: "ONLY_TOKEN",
        email_action_type: "email_change",
      }),
    );
    expect(url.searchParams.get("token")).toBe("ONLY_TOKEN");
  });

  it("other flows are unaffected", () => {
    const url = new URL(buildConfirmationUrl({ ...base, email_action_type: "signup" }));
    expect(url.searchParams.get("token")).toBe("OLD_TOKEN");
  });
});
