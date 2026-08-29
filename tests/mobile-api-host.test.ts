import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The mobile app talks to TWO hosts, and confusing them is a silent outage.
 *
 * `/v1` is served by `apps/api` on Railway at https://api.everlumen.co. The web
 * app is `apps/web` on Vercel at https://everlumen.co. For a long time
 * `apps/mobile` had one variable, `EXPO_PUBLIC_API_BASE_URL`, pointed at the
 * web host and used for both.
 *
 * The result was that all 44 `/v1/rpc` operations went to
 * https://everlumen.co/v1/rpc, which is not a route on the web app. Every
 * server-backed screen showed "Request failed": notifications, team, workspace,
 * photo AI, site logs, timeline, pipelines, groups, portfolio, report drafting,
 * the activity feed and every share link.
 *
 * Nothing caught it. The types were fine, all 44 op names were real, every
 * table and column existed, tsc and lint and 2305 tests were green. It only
 * appears against the live hosts, which is why it survived so long and why it
 * is pinned here.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

/** `apps/mobile/eas.json`, whose `env` blocks are baked into every build. */
function easEnvs(): Record<string, Record<string, string>> {
  const eas = JSON.parse(read("apps/mobile/eas.json")) as {
    build: Record<string, { env?: Record<string, string> }>;
  };
  const out: Record<string, Record<string, string>> = {};
  for (const [name, profile] of Object.entries(eas.build)) {
    if (profile.env) out[name] = profile.env;
  }
  return out;
}

describe("the API host and the web host are not the same variable", () => {
  it("every build profile that sets one sets both", () => {
    /*
     * A profile with only the API variable makes `webAppLink` return null, so
     * every share link and every Open-on-web row goes dead. That failure is
     * quieter than the RPC one: the rows just grey out.
     */
    for (const [name, env] of Object.entries(easEnvs())) {
      if (!("EXPO_PUBLIC_API_BASE_URL" in env)) continue;
      expect(
        env.EXPO_PUBLIC_WEB_BASE_URL,
        `eas.json profile "${name}" sets the API host but not the web host`,
      ).toBeTruthy();
    }
  });

  it("points the API variable at the API host, not the web host", () => {
    // The exact mistake. `https://everlumen.co/v1/rpc` is a 404 that renders as
    // the SPA shell, so the client reports "Request failed" and nothing logs a
    // reason anywhere.
    for (const [name, env] of Object.entries(easEnvs())) {
      const api = env.EXPO_PUBLIC_API_BASE_URL;
      if (!api) continue;
      expect(api, `eas.json profile "${name}" has the API host wrong`).toMatch(/^https:\/\/api\./);
    }
  });

  it("never gives the two variables the same value", () => {
    for (const [name, env] of Object.entries(easEnvs())) {
      if (!env.EXPO_PUBLIC_API_BASE_URL || !env.EXPO_PUBLIC_WEB_BASE_URL) continue;
      expect(
        env.EXPO_PUBLIC_API_BASE_URL,
        `eas.json profile "${name}" points both variables at one host`,
      ).not.toBe(env.EXPO_PUBLIC_WEB_BASE_URL);
    }
  });

  it("documents both in .env.example, so a fresh checkout sets both", () => {
    const example = read("apps/mobile/.env.example");
    expect(example).toContain("EXPO_PUBLIC_API_BASE_URL");
    expect(example).toContain("EXPO_PUBLIC_WEB_BASE_URL");
  });
});

describe("api.ts keeps the two origins apart", () => {
  const source = () => read("apps/mobile/src/lib/api.ts");

  it("builds the client from the API variable", () => {
    expect(source()).toMatch(/baseUrl:\s*apiBaseUrl/);
  });

  it("builds web links from the web variable, never the API one", () => {
    /*
     * The regression to guard. `webAppLink` returning an API-origin URL puts
     * `https://api.everlumen.co/share/reports/<token>` in front of a customer,
     * which 404s: the share routes are on the web app.
     */
    const src = source();
    const fn = src.slice(src.indexOf("export function webAppLink"));
    expect(fn).toContain("webBaseUrl");
    expect(fn).not.toContain("apiBaseUrl");
  });

  it("reads each variable from its own env name", () => {
    const src = source();
    expect(src).toMatch(/apiBaseUrl\s*=\s*\(process\.env\.EXPO_PUBLIC_API_BASE_URL/);
    expect(src).toMatch(/webBaseUrl\s*=\s*\(process\.env\.EXPO_PUBLIC_WEB_BASE_URL/);
  });
});
