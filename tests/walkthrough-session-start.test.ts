import { describe, expect, it } from "vitest";
import { rpcRegistry } from "../apps/api/src/domains/rpc/registry";
import { sessionStartedAt } from "../apps/api/src/domains/walkthroughs/service";

const NOW = Date.parse("2026-10-01T12:00:00.000Z");

describe("sessionStartedAt", () => {
  it("keeps a recent recording start sent by the phone", () => {
    expect(sessionStartedAt("2026-10-01T09:30:00.000Z", NOW)).toBe("2026-10-01T09:30:00.000Z");
  });

  it("falls back to now when the start is missing or unparseable", () => {
    expect(sessionStartedAt(undefined, NOW)).toBe("2026-10-01T12:00:00.000Z");
    expect(sessionStartedAt("not a date", NOW)).toBe("2026-10-01T12:00:00.000Z");
  });

  it("falls back to now when the start is far in the future or over a week old", () => {
    expect(sessionStartedAt("2026-10-01T13:00:00.000Z", NOW)).toBe("2026-10-01T12:00:00.000Z");
    expect(sessionStartedAt("2026-09-20T12:00:00.000Z", NOW)).toBe("2026-10-01T12:00:00.000Z");
  });
});

describe("createWalkthroughSession input", () => {
  it("lets an unusable start time through to the fallback instead of refusing the walk", async () => {
    // Parsing is the first thing the op does; a refusal there would lose the queued walk.
    const entry = rpcRegistry.createWalkthroughSession;
    const parse = (data: unknown) =>
      entry.handle({ userId: "u1", supabase: null } as any, data).catch((e: Error) => e);
    const bad = await parse({
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "Walk",
      startedAt: "not a date",
    });
    // It gets past validation and fails later, at the (absent) database.
    expect(String((bad as Error)?.message ?? "")).not.toMatch(/invalid|datetime/i);
  });
});
