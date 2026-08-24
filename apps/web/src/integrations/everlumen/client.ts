// Everlumen Supabase client. Set VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
// (Vercel env vars in production; .env locally) - this file is NOT auto-generated,
// but it also must not hardcode a project so the env is the single source of truth.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@everlumen/db";

export const EVERLUMEN_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
// Publishable key - safe to ship in client code (RLS applies).
export const EVERLUMEN_SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as
  | string
  | undefined;

function createSupabaseClient() {
  if (!EVERLUMEN_SUPABASE_URL || !EVERLUMEN_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error(
      "Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY - set them in .env (local) or the Vercel project env (production).",
    );
  }
  return createClient<Database>(EVERLUMEN_SUPABASE_URL, EVERLUMEN_SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storage: typeof window !== "undefined" ? localStorage : undefined,
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/everlumen/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
