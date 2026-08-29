import { describe, expect, it } from "vitest";
import {
  describeError,
  formatForSupport,
  MAX_MESSAGE,
  MAX_RECORDS,
  pushRecord,
  redact,
  type ErrorRecord,
} from "../apps/mobile/src/lib/error-redaction";

/*
 * Scrubbing an error before anybody sees it.
 *
 * Error messages here are assembled from whatever failed, and the things that
 * fail carry credentials: a Supabase URL with an `access_token` in the
 * fragment, a `Bearer` header echoed back in a fetch error, a share token, the
 * email of whoever was signed in. The moment one is shown to support, written
 * to a log or sent to a crash service, all of that is disclosed.
 *
 * So the tests below are mostly "this must not survive". A message stripped of
 * a useful detail is an inconvenience; a bearer token in a support ticket is an
 * incident.
 */

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk";

describe("credentials do not survive", () => {
  it("removes a JWT", () => {
    const out = redact(`Request failed: ${JWT}`);
    expect(out).not.toContain("eyJ");
    expect(out).toContain("[jwt removed]");
  });

  it("removes a token in a query string or a fragment", () => {
    for (const key of ["access_token", "refresh_token", "apikey", "token", "password"]) {
      const out = redact(`https://x.supabase.co/callback#${key}=abc123secret&other=1`);
      expect(out, key).not.toContain("abc123secret");
    }
  });

  it("removes a bearer header", () => {
    const out = redact("401 with header Authorization: Bearer abc.def.ghi");
    expect(out).not.toContain("abc.def.ghi");
    expect(out).toContain("Bearer [removed]");
  });

  it("removes a Supabase publishable or secret key", () => {
    const out = redact("apikey sb_publishable_yLRCsQwsTdML_BqvyTHnHw_LpsHou1r rejected");
    expect(out).not.toContain("yLRCsQwsTdML");
  });

  it("removes an email address", () => {
    // The signed-in user's address appears in auth errors routinely.
    expect(redact("No user found for sam.reyes@site.test")).not.toContain("sam.reyes@site.test");
  });

  it("removes a share link", () => {
    /*
     * A share link in a support ticket is a working public link to a customer's
     * job, which is exactly what the revoke switch exists to control.
     */
    const out = redact(
      "404 at https://everlumen.co/share/reports/9f2a1c8e-dead-beef-0000-111122223333",
    );
    expect(out).not.toContain("9f2a1c8e-dead-beef");
    expect(out).toContain("/share/[removed]");
  });

  it("removes anything long enough to be a credential", () => {
    const secret = "A".repeat(48);
    expect(redact(`token ${secret} is invalid`)).not.toContain(secret);
  });
});

describe("what it deliberately keeps", () => {
  it("keeps a uuid, which is what makes an error traceable", () => {
    /*
     * A uuid is an identifier, not a credential. The blunt final rule would eat
     * it, so uuids are lifted out and put back. Without that, every error loses
     * the one thing that would let somebody find the row it happened on.
     */
    const id = "9f2a1c8e-1234-4567-89ab-111122223333";
    expect(redact(`Row ${id} not found`)).toContain(id);
  });

  it("keeps the readable part of the message", () => {
    const out = redact(`Could not load notifications: ${JWT}`);
    expect(out).toContain("Could not load notifications");
  });

  it("keeps a uuid even when a credential sits beside it", () => {
    const id = "9f2a1c8e-1234-4567-89ab-111122223333";
    const out = redact(`Project ${id} rejected token ${JWT}`);
    expect(out).toContain(id);
    expect(out).not.toContain("eyJ");
  });

  it("does not mangle an ordinary message", () => {
    expect(redact("Network request failed")).toBe("Network request failed");
  });

  it("does not confuse a bare number in the message with a stashed uuid", () => {
    /*
     * Uuids are lifted out and fenced by a sentinel while the other rules run.
     * An earlier version fenced them with spaces, which meant the restore
     * pattern also matched real text: "step 0 of 5" would have had "0" replaced
     * by whichever uuid happened to be stashed at index 0, silently rewriting
     * the message into something untrue.
     *
     * U+E000 is a private-use codepoint, so nothing legitimate emits one.
     */
    expect(redact("Failed at step 0 of 5")).toBe("Failed at step 0 of 5");

    const id = "9f2a1c8e-1234-4567-89ab-111122223333";
    expect(redact(`Row ${id} failed at step 0 of 5`)).toBe(`Row ${id} failed at step 0 of 5`);
  });
});

describe("describeError takes whatever a catch gives it", () => {
  it("reads an Error", () => {
    expect(describeError(new Error("Boom"))).toBe("Boom");
  });

  it("falls back to the name when there is no message", () => {
    const error = new Error("");
    error.name = "TypeError";
    expect(describeError(error)).toBe("TypeError");
  });

  it("reads a string, an api error object, and anything else", () => {
    expect(describeError("plain")).toBe("plain");
    expect(describeError({ code: "unauthorized", message: "Unauthorized" })).toBe("Unauthorized");
    expect(describeError({ code: "rate_limited" })).toBe("rate_limited");
    expect(describeError(42)).toBe("42");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
  });

  it("survives a circular object, which a fetch error often is", () => {
    // A second failure inside the error handler is the worst place for one.
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => describeError(circular)).not.toThrow();
  });

  it("redacts, always", () => {
    expect(describeError(new Error(`failed ${JWT}`))).not.toContain("eyJ");
    expect(describeError(`signed in as sam@site.test`)).not.toContain("sam@site.test");
  });

  it("caps the length, because a stack trace is not a message", () => {
    // Words, not one long run: an unbroken 2000-character string is correctly
    // redacted as a possible credential long before the length cap matters.
    const long = "Something went wrong on this line. ".repeat(60);
    expect(describeError(long)).toHaveLength(MAX_MESSAGE);
  });
});

describe("the ring buffer", () => {
  const record = (n: number): ErrorRecord => ({
    at: `2026-08-30T00:00:${String(n).padStart(2, "0")}Z`,
    context: "test",
    message: `error ${n}`,
  });

  it("keeps the newest first", () => {
    const out = pushRecord([record(1)], record(2));
    expect(out[0].message).toBe("error 2");
  });

  it("is bounded, so a phone on a bad connection for a week cannot grow it", () => {
    let records: ErrorRecord[] = [];
    for (let i = 0; i < MAX_RECORDS + 20; i++) records = pushRecord(records, record(i));
    expect(records).toHaveLength(MAX_RECORDS);
    // The newest survived and the oldest went.
    expect(records[0].message).toBe(`error ${MAX_RECORDS + 19}`);
  });

  it("does not mutate", () => {
    const before = [record(1)];
    pushRecord(before, record(2));
    expect(before).toHaveLength(1);
  });
});

describe("formatForSupport", () => {
  it("says so rather than showing an empty box", () => {
    expect(formatForSupport([])).toContain("No errors");
  });

  it("puts the newest first, because that is what is being asked about", () => {
    const out = formatForSupport([
      { at: "t2", context: "notifications", message: "second" },
      { at: "t1", context: "team", message: "first" },
    ]);
    expect(out.indexOf("second")).toBeLessThan(out.indexOf("first"));
  });
});
