import { createApiClient } from "@everlumen/api-client";
import { supabase } from "./supabase";

/*
 * TWO HOSTS, NOT ONE. This was a bug and it broke 44 operations.
 *
 * `/v1` is served by `apps/api` on Railway at https://api.everlumen.co. The web
 * app is on Vercel at https://everlumen.co. They are different origins, and an
 * earlier version of this file used a single `EXPO_PUBLIC_API_BASE_URL` for
 * both, on the assumption they were the same host.
 *
 * The failure is silent and total: every `api.rpc()` call went to
 * https://everlumen.co/v1/rpc, which is not a route on the web app, so Vercel
 * answered with the SPA's 200-or-404 HTML shell. The client then failed to
 * parse it and reported "Request failed" on every screen that talks to the
 * server: notifications, team, workspace, photo AI, site logs, timeline,
 * pipelines, groups, portfolio, reports, activity and sharing.
 *
 * Nothing catches this in CI. The types are fine, the op names are all real,
 * and the failure only appears against the live hosts.
 */
const apiBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

/**
 * Where the **web app** lives, for public share links and Open-on-web rows.
 *
 * Deliberately separate from the API origin. A share link has to point at the
 * page a customer opens in a browser, which is the web app; an RPC has to point
 * at the API. Folding them into one variable is what caused the outage above.
 */
const webBaseUrl = (process.env.EXPO_PUBLIC_WEB_BASE_URL ?? "").replace(/\/$/, "");

/**
 * Everlumen `/v1` client for mobile.
 * @see docs/api.md
 */
export const api = createApiClient({
  baseUrl: apiBaseUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

/**
 * Origin of the web app, for building public share links.
 *
 * **Not** the API origin. Empty when unconfigured, which `shareUrl` treats as
 * "cannot build a link" rather than producing a relative one.
 */
export const webAppUrl = webBaseUrl;

/**
 * A path on the web app, or null when no origin is configured.
 *
 * Report authoring, the portfolio builder, template and blueprint editing and
 * billing are all long-form work on a large screen, and the parity matrix in
 * `docs/mobile-plan.md` marks them web-only or view-only on purpose. Opening
 * them in the system browser is honest about that: the person gets the real
 * feature rather than a cut-down phone version of it, and comes back to where
 * they were.
 *
 * Returning null rather than a relative path matters: a caller that got
 * `"/teams"` back would hand it to the browser, which would treat it as a file
 * path and open nothing.
 */
export function webAppLink(path: string): string | null {
  if (!webBaseUrl) return null;
  return `${webBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
