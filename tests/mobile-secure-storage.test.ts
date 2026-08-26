import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The Supabase session store on mobile.
 *
 * This holds the refresh token, which is a long-lived credential: anything
 * holding it can mint access tokens until it is revoked. It lives in the iOS
 * Keychain / Android Keystore rather than AsyncStorage, and the only reason it
 * needs code at all is SecureStore's size cap, which a session with populated
 * `user_metadata` clears easily.
 *
 * The failure modes are quiet ones. A value that does not reassemble exactly
 * does not throw, it just fails to parse, and the user is silently signed out.
 */

type Secure = typeof import("./doubles/expo-secure-store");
type Async = typeof import("./doubles/async-storage");
type Module = typeof import("../apps/mobile/src/lib/secure-storage");

let secure: Secure;
let asyncStore: Async;
let storage: Module["secureStorage"];

beforeEach(async () => {
  vi.resetModules();
  secure = await import("./doubles/expo-secure-store");
  asyncStore = await import("./doubles/async-storage");
  secure.__reset();
  asyncStore.__reset();
  secure.__setMaxValueBytes(Infinity);
  ({ secureStorage: storage } = await import("../apps/mobile/src/lib/secure-storage"));
});

const KEY = "sb-project-auth-token";

describe("round trips", () => {
  it("stores and reads a small value in one piece", async () => {
    await storage.setItem(KEY, "hello");
    expect(await storage.getItem(KEY)).toBe("hello");
    // Small enough to need no manifest, so it should be one entry.
    expect(secure.__dump().size).toBe(1);
  });

  it("reports a miss as null rather than throwing", async () => {
    expect(await storage.getItem(KEY)).toBeNull();
  });

  it("round trips a session larger than the SecureStore cap", async () => {
    /*
     * The case that made this module necessary. Android refuses past roughly
     * 2048 bytes, so the double is set to refuse there too: a version that
     * tried to write the whole thing would fail this test rather than passing
     * on a machine where nothing enforces the limit.
     */
    secure.__setMaxValueBytes(2048);
    const session = JSON.stringify({
      access_token: "a".repeat(3000),
      refresh_token: "r".repeat(600),
      user: { name: "Dana Reyes" },
    });

    await storage.setItem(KEY, session);
    expect(await storage.getItem(KEY)).toBe(session);
    expect(secure.__dump().size).toBeGreaterThan(1);
  });

  it("round trips non-ASCII content without splitting a character", async () => {
    /*
     * Chunking by byte size can land a boundary in the middle of a multi-byte
     * character, and an emoji is a surrogate pair on top of that. A display
     * name is user-supplied, so this is ordinary input, not an edge case.
     */
    secure.__setMaxValueBytes(2048);
    const session = JSON.stringify({
      access_token: "a".repeat(1500),
      user: { name: "Ana Muñoz 👷🏽‍♀️ Ünïcödé ".repeat(60) },
    });

    await storage.setItem(KEY, session);
    expect(await storage.getItem(KEY)).toBe(session);
  });

  it("shrinks from many chunks back to one without leaving the old ones behind", async () => {
    /*
     * Signing out of a big session and into a small one. Stale chunks left
     * past the new end would be read back as part of the next value.
     */
    secure.__setMaxValueBytes(2048);
    await storage.setItem(KEY, "x".repeat(6000));
    await storage.setItem(KEY, "small");

    expect(await storage.getItem(KEY)).toBe("small");
    expect(secure.__dump().size).toBe(1);
  });

  it("grows from one chunk to many", async () => {
    secure.__setMaxValueBytes(2048);
    await storage.setItem(KEY, "small");
    const big = "y".repeat(6000);
    await storage.setItem(KEY, big);

    expect(await storage.getItem(KEY)).toBe(big);
  });
});

describe("removal", () => {
  it("clears every chunk", async () => {
    secure.__setMaxValueBytes(2048);
    await storage.setItem(KEY, "z".repeat(6000));
    await storage.removeItem(KEY);

    expect(await storage.getItem(KEY)).toBeNull();
    expect(secure.__dump().size).toBe(0);
  });
});

describe("migration off AsyncStorage", () => {
  it("moves a session left by the previous client and deletes the original", async () => {
    /*
     * Before this module, the session lived in AsyncStorage in plain text.
     * Without the migration, shipping the fix signs out every existing install,
     * which reads as a bug to whoever is holding the phone.
     */
    asyncStore.__seed(KEY, "legacy-session");

    expect(await storage.getItem(KEY)).toBe("legacy-session");
    // Read again: it now comes from SecureStore, and the plaintext copy is gone.
    expect(await storage.getItem(KEY)).toBe("legacy-session");
    expect(asyncStore.__has(KEY)).toBe(false);
    expect(secure.__dump().size).toBeGreaterThan(0);
  });

  it("does not invent a session when neither store has one", async () => {
    expect(await storage.getItem(KEY)).toBeNull();
    expect(secure.__dump().size).toBe(0);
  });
});

describe("a partially written value", () => {
  it("reads as absent rather than as a truncated session", async () => {
    /*
     * The process can die between chunk writes. Returning what did land would
     * hand supabase-js half a session: it would fail to parse, or worse, parse
     * into something that looks valid and is not. Absent means the user signs
     * in again, which is the honest outcome.
     */
    secure.__setMaxValueBytes(2048);
    await storage.setItem(KEY, "q".repeat(6000));

    const keys = [...secure.__dump().keys()].filter((key) => key !== KEY);
    await secure.deleteItemAsync(keys[keys.length - 1]);

    expect(await storage.getItem(KEY)).toBeNull();
  });
});
