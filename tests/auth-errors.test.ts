import { describe, it, expect } from "vitest";
import { authErrorMessage, isUnconfirmedEmail } from "../apps/web/src/lib/auth-errors";

/*
 * Signup and login are the two screens where a bad error message costs a
 * customer. These cases are all real: each string below actually reached a
 * user's toast, or would have.
 */
describe("authErrorMessage", () => {
  it("never renders an empty message", () => {
    for (const e of [null, undefined, {}, { message: "" }, { message: "   " }]) {
      const out = authErrorMessage(e);
      expect(out.length).toBeGreaterThan(0);
      expect(out).not.toBe("{}");
    }
  });

  it("does not leak a serialized object - the bug a user actually saw", () => {
    // The production signup failure rendered a toast reading literally `{}`.
    expect(authErrorMessage({ message: "{}" })).not.toContain("{}");
    expect(authErrorMessage({ message: "[object Object]" })).not.toContain("object Object");
    expect(authErrorMessage({ message: '{"code":500}' })).not.toContain("500");
  });

  it("hides our own infrastructure failures behind an apology", () => {
    for (const raw of [
      "Hook requires authorization token",
      "Database error saving new user",
      "unexpected_failure",
      "Failed to send email",
    ]) {
      const out = authErrorMessage({ message: raw });
      expect(out).toMatch(/on us|try again/i);
      expect(out).not.toContain("Hook");
      expect(out).not.toContain("Database");
    }
  });

  it("turns a duplicate signup into a next step", () => {
    expect(authErrorMessage({ message: "User already registered" })).toMatch(/logging in/i);
  });

  it("explains a rate limit without jargon", () => {
    const out = authErrorMessage({ message: "email rate limit exceeded" });
    expect(out).toMatch(/wait a few minutes/i);
    expect(out).not.toMatch(/rate limit exceeded/);
  });

  it("maps credential and confirmation failures", () => {
    expect(authErrorMessage({ message: "Invalid login credentials" })).toMatch(/Google or Apple/);
    expect(authErrorMessage({ message: "Email not confirmed" })).toMatch(/confirm your email/i);
  });

  it("maps password and link problems", () => {
    expect(authErrorMessage({ message: "Password should be at least 6 characters" })).toMatch(
      /at least 8 characters/i,
    );
    expect(authErrorMessage({ message: "Token has expired or is invalid" })).toMatch(/expired/i);
  });

  it("passes through an unknown but human-readable message", () => {
    const msg = "Your account has been suspended by an administrator.";
    expect(authErrorMessage({ message: msg })).toBe(msg);
  });

  it("suppresses stack traces and internal identifiers", () => {
    /*
     * The property that matters is that the raw string never reaches the user
     * - not which safe copy replaces it. A snake_case identifier happens to
     * match the infrastructure rule and gets the apology; a stack trace gets
     * the generic message. Both are acceptable, leaking either is not.
     */
    for (const raw of [
      "at Object.<anonymous>\n  at Module._compile",
      "some_internal_code",
      "x".repeat(300),
    ]) {
      const out = authErrorMessage({ message: raw });
      expect(out).not.toContain(raw);
      expect(out).toMatch(/went wrong|on us/i);
    }
  });

  it("reads message, error_description or msg", () => {
    expect(authErrorMessage({ error_description: "User already registered" })).toMatch(/logging in/i);
    expect(authErrorMessage({ msg: "email rate limit exceeded" })).toMatch(/wait a few minutes/i);
    expect(authErrorMessage("User already registered")).toMatch(/logging in/i);
  });

  it("honours a caller-supplied fallback", () => {
    expect(authErrorMessage({}, "google sign-in failed")).toBe("google sign-in failed");
  });
});

describe("isUnconfirmedEmail", () => {
  it("detects the unconfirmed-account case", () => {
    expect(isUnconfirmedEmail({ message: "Email not confirmed" })).toBe(true);
    expect(isUnconfirmedEmail({ message: "Please confirm your email" })).toBe(true);
  });

  it("does not fire on unrelated errors", () => {
    expect(isUnconfirmedEmail({ message: "Invalid login credentials" })).toBe(false);
    expect(isUnconfirmedEmail(null)).toBe(false);
  });
});
