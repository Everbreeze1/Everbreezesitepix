import { useEffect, useState } from "react";
import {
  SITEPIX_SUPABASE_URL,
  SITEPIX_SUPABASE_PUBLISHABLE_KEY,
} from "@/integrations/sitepix/client";

/**
 * Which social sign-in providers this Supabase project actually has enabled.
 *
 * Signup and login both rendered "Continue with Google" and "Continue with
 * Apple" unconditionally, but neither provider was enabled on the project, so
 * clicking either returned
 *
 *   {"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}
 *
 * Two of the three ways onto the product were dead ends, and they were the most
 * visually prominent ones. Hard-coding them out would only move the problem:
 * the buttons would then stay hidden after the providers were configured.
 *
 * `/auth/v1/settings` is a public endpoint that reports exactly what is turned
 * on, so the UI can follow the project's real configuration - buttons vanish
 * while a provider is off and come back the moment it is enabled, with no
 * deploy.
 *
 * Fails closed: if the request errors, nothing social is offered and email
 * signup - which always works - is the only path shown.
 */
export type SocialProvider = "google" | "apple";

const CACHE_KEY = "sitepix:authProviders";

type Settings = { external?: Record<string, boolean> };

export function useAuthProviders() {
  // Seed from sessionStorage so the buttons don't flash in and out on every
  // navigation between /login and /signup.
  const [enabled, setEnabled] = useState<SocialProvider[] | null>(() => {
    if (typeof sessionStorage === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      return raw ? (JSON.parse(raw) as SocialProvider[]) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    let cancelled = false;
    if (!SITEPIX_SUPABASE_URL || !SITEPIX_SUPABASE_PUBLISHABLE_KEY) {
      setEnabled([]);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`${SITEPIX_SUPABASE_URL}/auth/v1/settings`, {
          headers: { apikey: SITEPIX_SUPABASE_PUBLISHABLE_KEY },
        });
        if (!res.ok) throw new Error(`settings ${res.status}`);
        const json = (await res.json()) as Settings;
        const ext = json.external ?? {};
        const list = (["google", "apple"] as SocialProvider[]).filter((p) => ext[p] === true);
        if (cancelled) return;
        setEnabled(list);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify(list));
        } catch {
          /* private mode - the fetch above still works, just uncached */
        }
      } catch {
        // Fail closed rather than offering a button that 400s.
        if (!cancelled) setEnabled((prev) => prev ?? []);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    /** null while unknown - render nothing rather than guessing. */
    providers: enabled,
    has: (p: SocialProvider) => !!enabled?.includes(p),
    any: !!enabled && enabled.length > 0,
  };
}
