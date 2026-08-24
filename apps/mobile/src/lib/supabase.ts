import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@everlumen/db";

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
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);
