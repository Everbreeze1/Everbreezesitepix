import { createApiClient } from "@sitepix/api-client";
import { supabase } from "./supabase";

const baseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

/**
 * SitePix `/v1` client for mobile.
 * @see docs/api.md
 */
export const api = createApiClient({
  baseUrl,
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});
