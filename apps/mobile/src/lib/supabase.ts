import "react-native-url-polyfill/auto";
import { AppState } from "react-native";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@everlumen/db";
import { secureStorage } from "./secure-storage";

const url = process.env.EXPO_PUBLIC_EVERLUMEN_SUPABASE_URL ?? "";
const key = process.env.EXPO_PUBLIC_EVERLUMEN_SUPABASE_PUBLISHABLE_KEY ?? "";

if (!url || !key) {
  console.warn(
    "[everlumen] Set EXPO_PUBLIC_EVERLUMEN_SUPABASE_URL and EXPO_PUBLIC_EVERLUMEN_SUPABASE_PUBLISHABLE_KEY",
  );
}

export const supabase = createClient<Database>(
  url || "https://placeholder.supabase.co",
  key || "placeholder",
  {
    auth: {
      // Keychain / Keystore backed, not AsyncStorage. See `./secure-storage`.
      storage: secureStorage,
      autoRefreshToken: true,
      persistSession: true,
      // No URL to read a session out of on native; OAuth arrives by deep link.
      detectSessionInUrl: false,
    },
  },
);

/*
 * supabase-js runs the token refresh on a timer, and a suspended app has no
 * timers. Without this the app wakes after a long backgrounding holding an
 * expired access token, and the first request of the session fails before the
 * library notices it should refresh.
 */
AppState.addEventListener("change", (state) => {
  if (state === "active") void supabase.auth.startAutoRefresh();
  else void supabase.auth.stopAutoRefresh();
});
