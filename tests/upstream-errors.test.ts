import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { jsonFromUnknownError } from "../apps/api/src/lib/errors";

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/*
 * Whose fault is it?
 *
 * `jsonFromUnknownError` maps a thrown value to an HTTP response, and a throw
 * with no `status` becomes 500 `internal_error` - "this server crashed". That
 * default is right for a genuine bug and wrong for everything upstream, and
 * the AI call sites all took it: a provider rate limit was reported to the
 * customer, and recorded in api_audit_logs, as our own crash. Thirty of the
 * hundred 5xx on record were that.
 */

describe("error status mapping", () => {
  const body = async (err: unknown) => {
    const res = jsonFromUnknownError(err);
    return { status: res.status, ...(await res.json()) };
  };

  it("a status-less throw is still an opaque 500", async () => {
    // The default must not soften: an untagged throw really is a bug here.
    const r = await body(new Error("boom"));
    expect(r.status).toBe(500);
    expect(r.code).toBe("internal_error");
  });

  it("forwards a 4xx message so the caller can act", async () => {
    const r = await body(Object.assign(new Error("Subscribe to unlock it."), { status: 403 }));
    expect(r.status).toBe(403);
    expect(r.message).toBe("Subscribe to unlock it.");
  });

  it("forwards a 5xx message only when it opts in", async () => {
    const opted = await body(
      Object.assign(new Error("The AI service is busy."), { status: 503, expose: true }),
    );
    expect(opted.status).toBe(503);
    expect(opted.code).toBe("service_unavailable");
    expect(opted.message).toBe("The AI service is busy.");
  });

  it("still hides an un-opted 5xx message", async () => {
    // A 5xx that nobody wrote for a person to read may carry internals.
    const r = await body(Object.assign(new Error("ECONNREFUSED 10.0.0.4:5432"), { status: 502 }));
    expect(r.status).toBe(500);
    expect(r.code).toBe("internal_error");
  });
});

describe("AI provider failures are not reported as our crashes", () => {
  const AI = "apps/api/src/domains/ai/service.ts";

  it("every provider response goes through the shared error helper", () => {
    const src = read(AI);
    expect(src).toContain("async function aiProviderError");

    /*
     * Asserted against the CODE, not the file.
     *
     * The helper's own doc comment quotes the line it replaced, so a plain
     * substring check on the file trips on its own explanation - a guard
     * nobody keeps. Comments are stripped first.
     *
     * The lookbehind is not optional, and tests/invariants.ts enforces it: an
     * unguarded slash-star matches the one inside `accept="image/*"` and then
     * runs to the next star-slash, deleting whatever lies between. A
     * `not.toContain` over a hole passes, which is the dangerous direction.
     */
    const code = src.replace(/(?<![\w"'])\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain('throw new Error("Rate limited');
    expect(code).not.toContain('throw new Error("AI credits exhausted');
    expect(code).not.toMatch(/throw new Error\(`AI (gateway )?error \$\{res\.status\}/);
  });

  it("every provider call has a deadline", () => {
    // A plain fetch to a third party with no timeout holds a connection open
    // for as long as the provider cares to stall.
    const src = read(AI);
    expect(src).toContain("AbortSignal.timeout(AI_TIMEOUT_MS)");
    expect(src, "a raw fetch would bypass the timeout").not.toContain("await fetch(ep.url");
  });

  it("gives caller-facing refusals a 4xx", () => {
    const src = read(AI);
    // A plan gate is an answer, not a crash.
    expect(src).toMatch(/requires an active plan[\s\S]{0,80}status: 403/);
    expect(src).toContain('new Error("Photo not found"), { status: 404 }');
  });

  it("the walkthrough transcribe path tags its own refusals too", () => {
    const src = read("apps/api/src/domains/walkthroughs/service.ts");
    expect(src).toContain('new Error("Walkthrough not found"), { status: 404 }');
    expect(src).toContain('new Error("Not authorized"), { status: 403 }');
    expect(src).toMatch(/no audio in it[\s\S]{0,40}status: 400/);
  });
});
