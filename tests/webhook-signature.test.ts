import { describe, it, expect } from "vitest";
import { createHmac, randomBytes } from "node:crypto";
import { verifyStandardWebhook } from "../apps/api/src/lib/webhook-signature";

/*
 * Supabase Auth's HTTP hook signs with Standard Webhooks rather than sending a
 * bearer token. Getting this wrong is invisible locally — the handler simply
 * 401s and Supabase reports a bare 500 on signup, with no indication that a
 * signature was involved. These tests pin the wire format.
 */

const SECRET_B64 = randomBytes(24).toString("base64");
const SECRET = `v1,whsec_${SECRET_B64}`;

function sign(id: string, ts: number, body: string, secret = SECRET_B64) {
  return createHmac("sha256", Buffer.from(secret, "base64"))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
}

function req(headers: Record<string, string>) {
  return new Request("https://api.example.com/v1/auth/send-email", {
    method: "POST",
    headers,
  });
}

const now = () => Math.floor(Date.now() / 1000);

describe("verifyStandardWebhook", () => {
  const body = JSON.stringify({ user: { email: "a@b.com" }, email_data: {} });

  it("accepts a correctly signed request", () => {
    const ts = now();
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sign("msg_1", ts, body)}`,
    });
    expect(verifyStandardWebhook(r, body, SECRET)).toBe(true);
  });

  it("accepts the secret without its v1,whsec_ prefix", () => {
    // A hand-copied secret often loses the prefix; that must still work.
    const ts = now();
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sign("msg_1", ts, body)}`,
    });
    expect(verifyStandardWebhook(r, body, SECRET_B64)).toBe(true);
  });

  it("picks the matching signature out of several", () => {
    const ts = now();
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${"A".repeat(44)} v1,${sign("msg_1", ts, body)}`,
    });
    expect(verifyStandardWebhook(r, body, SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const ts = now();
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sign("msg_1", ts, body)}`,
    });
    // Same signature, different payload — this is the attack that matters:
    // swapping the recipient email on an otherwise valid request.
    const tampered = JSON.stringify({ user: { email: "attacker@evil.com" }, email_data: {} });
    expect(verifyStandardWebhook(r, tampered, SECRET)).toBe(false);
  });

  it("rejects a stale timestamp (replay)", () => {
    const ts = now() - 60 * 60;
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sign("msg_1", ts, body)}`,
    });
    expect(verifyStandardWebhook(r, body, SECRET)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const ts = now();
    const other = randomBytes(24).toString("base64");
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sign("msg_1", ts, body, other)}`,
    });
    expect(verifyStandardWebhook(r, body, SECRET)).toBe(false);
  });

  it("rejects missing signature headers", () => {
    expect(verifyStandardWebhook(req({}), body, SECRET)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    const ts = now();
    const r = req({
      "webhook-id": "msg_1",
      "webhook-timestamp": String(ts),
      "webhook-signature": `v1,${sign("msg_1", ts, body)}`,
    });
    expect(verifyStandardWebhook(r, body, undefined)).toBe(false);
  });
});
