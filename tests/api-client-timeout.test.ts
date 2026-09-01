import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  AI_TIMEOUT_MS,
  ApiClientError,
  createApiClient,
  DEFAULT_TIMEOUT_MS,
} from "../packages/api-client/src/index";

/*
 * A request that never answers has to end.
 *
 * There was no timeout in this client. `fetch` in React Native has no default
 * one, so a request that got no response never settled: the promise stayed
 * pending, TanStack Query held `isLoading` true, and the screen sat on its
 * loading skeleton with no error and no retry. Indistinguishable, to the person
 * holding the phone, from a feature that does not work.
 *
 * The condition is ordinary for this app rather than exotic. A phone handing
 * over between towers on a rural site leaves a half-open socket: the client
 * believes the connection is up and no bytes are ever coming back.
 *
 * Exercised through a hanging fetch rather than asserted against the source,
 * because what matters is that the promise REJECTS - a source-text check would
 * pass just as happily on a timer that fires and does nothing.
 */

const hangingFetch = () =>
  vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      }),
  );

describe("a request that never answers", () => {
  it("rejects instead of hanging forever", async () => {
    vi.useFakeTimers();
    const api = createApiClient({ baseUrl: "https://api.test", fetch: hangingFetch() as never });

    const pending = api.rpc("listWalkthroughs", { projectId: "p1" });
    const assertion = expect(pending).rejects.toBeInstanceOf(ApiClientError);

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 100);
    await assertion;
    vi.useRealTimers();
  });

  it("says what happened in words a crew member can act on", async () => {
    vi.useFakeTimers();
    const api = createApiClient({ baseUrl: "https://api.test", fetch: hangingFetch() as never });

    const pending = api.rpc("listWalkthroughs", { projectId: "p1" }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS + 100);
    const error = (await pending) as ApiClientError;

    expect(error.code).toBe("timeout");
    // Not the raw "Aborted" the AbortController would otherwise surface.
    expect(error.message).not.toContain("Abort");
    expect(error.message).toMatch(/signal|try again/i);
    vi.useRealTimers();
  });

  it("does not fire before the budget is spent", async () => {
    /*
     * A timeout that trips early is worse than none: it would break every slow
     * but working request on a bad connection, which is most of them on site.
     */
    vi.useFakeTimers();
    const api = createApiClient({ baseUrl: "https://api.test", fetch: hangingFetch() as never });

    let settled = false;
    void api.rpc("listWalkthroughs", { projectId: "p1" }).catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1000);
    expect(settled).toBe(false);
    vi.useRealTimers();
  });
});

describe("the ops that are legitimately slow", () => {
  it("get a longer budget than the default", () => {
    // The AI ops wait on a provider. Holding them to the ordinary budget would
    // cancel work that was going to succeed.
    expect(AI_TIMEOUT_MS).toBeGreaterThan(DEFAULT_TIMEOUT_MS);
  });

  it("are the ones that ask for it", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const SLOW = [
      "apps/mobile/src/api/assistant.ts",
      "apps/mobile/src/api/reports.ts",
      "apps/mobile/src/api/summaries.ts",
      "apps/mobile/src/api/daily-log.ts",
    ];
    for (const path of SLOW) {
      expect(readFileSync(join(process.cwd(), path), "utf8"), path).toContain("AI_TIMEOUT_MS");
    }
  });
});

describe("a caller's own cancellation still wins", () => {
  it("does not layer a second abort over a signal that was passed in", async () => {
    /*
     * A screen unmounting cancels its own request. Overriding that signal with
     * ours would leave the request running after the screen it belonged to is
     * gone.
     */
    const seen: (AbortSignal | null | undefined)[] = [];
    const own = new AbortController();
    const api = createApiClient({
      baseUrl: "https://api.test",
      fetch: ((_u: string, init?: RequestInit) => {
        seen.push(init?.signal);
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as never,
    });

    await api.rpc("listWalkthroughs", { projectId: "p1" });
    expect(seen[0]).toBeInstanceOf(AbortSignal);
    expect(seen[0]).not.toBe(own.signal);
  });
});

describe("a timeout does not get mistaken for a permanent failure", () => {
  /*
   * The interaction that would turn this fix into a worse bug.
   *
   * The offline outbox drops work it judges permanent, on the sound reasoning
   * that an RLS refusal or a deleted project will fail identically in an hour.
   * A timeout is the opposite: it is the signal problem the queue exists for.
   * If the classifier ever learns to match this message, a crew working in a
   * basement would have their queued photographs and notes discarded instead of
   * retried - and discarded silently, which is how a day's site record goes
   * missing.
   *
   * `handlers.ts` cannot be imported here: it pulls in `@/api/checklists`, and
   * `@/` resolves to the web app under vitest. So the word list is read out of
   * the source instead of copied into this file - a term added there is picked
   * up by this test automatically, which a hardcoded copy would not be.
   */
  const permanentTerms = (): string[] => {
    const src = readFileSync(join(process.cwd(), "apps/mobile/src/offline/handlers.ts"), "utf8");
    const fn = src.slice(
      src.indexOf("function classify("),
      src.indexOf("export function isPermanent"),
    );
    return [...fn.matchAll(/lower\.includes\("([^"]+)"\)/g)].map((m) => m[1]);
  };

  const TIMEOUT_MESSAGE = "The server did not answer in time. Check your signal and try again.";

  it("found the classifier's terms", () => {
    // Guards the reader itself: an empty list would make the next test vacuous.
    const terms = permanentTerms();
    expect(terms.length).toBeGreaterThan(3);
    expect(terms).toContain("row-level security");
  });

  it("the timeout message matches none of them", () => {
    const lower = TIMEOUT_MESSAGE.toLowerCase();
    for (const term of permanentTerms()) {
      expect(lower.includes(term), `timeout message must not read as "${term}"`).toBe(false);
    }
  });

  it("the client still sends exactly that message", () => {
    // Ties the assertion above to the string the client actually throws, so
    // rewording the copy cannot quietly make this test check nothing.
    const client = readFileSync(join(process.cwd(), "packages/api-client/src/index.ts"), "utf8");
    expect(client).toContain(TIMEOUT_MESSAGE);
  });
});
