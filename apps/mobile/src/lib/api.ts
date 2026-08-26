import { createApiClient } from "@everlumen/api-client";
import { supabase } from "./supabase";

const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

/**
 * Everlumen `/v1` client for mobile.
 * @see docs/api.md
 */
export const api = createApiClient({
  baseUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

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
 * Same origin as `/v1`, so there is one variable to set rather than two that
 * can disagree. Returning null rather than a relative path matters: a caller
 * that got `"/teams"` back would hand it to the browser, which would treat it
 * as a file path and open nothing.
 */
export function webAppLink(path: string): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}
