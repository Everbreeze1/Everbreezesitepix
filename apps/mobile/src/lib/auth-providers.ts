/**
 * Which social sign-in providers this Supabase project actually has enabled.
 *
 * The web app shipped "Continue with Google" and "Continue with Apple"
 * unconditionally while neither was configured, so both returned
 *
 *   {"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
 *
 * and two of the three ways onto the product were dead ends. Hard-coding the
 * buttons out only moves the problem, because they then stay hidden after the
 * provider is turned on.
 *
 * `/auth/v1/settings` is a public endpoint reporting exactly what is on, so the
 * UI follows the project's real configuration with no deploy. Mobile asks the
 * same question as `apps/web/src/hooks/use-auth-providers.tsx`, for the same
 * reason: a store build cannot be corrected as quickly as a web deploy, so a
 * dead button on a phone lives much longer than one on the web.
 *
 * Fails closed. If the request errors, nothing social is offered and email,
 * which always works, is the only path shown.
 */

export type SocialProvider = "google" | "apple";

const SUPABASE_URL = process.env.EXPO_PUBLIC_EVERLUMEN_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.EXPO_PUBLIC_EVERLUMEN_SUPABASE_PUBLISHABLE_KEY ?? "";

type Settings = { external?: Record<string, boolean> };

export async function fetchEnabledProviders(): Promise<SocialProvider[]> {
  if (!SUPABASE_URL || !SUPABASE_KEY) return [];
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: SUPABASE_KEY },
    });
    if (!res.ok) throw new Error(`settings ${res.status}`);
    const json = (await res.json()) as Settings;
    const external = json.external ?? {};
    return (["google", "apple"] as SocialProvider[]).filter((p) => external[p] === true);
  } catch {
    return [];
  }
}

/** Human label for a provider button. */
export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: "Continue with Google",
  apple: "Continue with Apple",
};
