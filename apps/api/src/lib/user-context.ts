import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@sitepix/db";
import {
  bearerToken,
  requireSitepixSupabasePublishableKey,
  requireSitepixSupabaseUrl,
} from "./supabase";

export type AuthedContext = {
  supabase: SupabaseClient<Database>;
  userId: string;
  token?: string;
  claims?: Record<string, unknown>;
};

export type ServiceContext = Pick<AuthedContext, "supabase" | "userId"> & {
  claims?: Record<string, unknown>;
};

export class AuthError extends Error {
  status = 401;
}

export function createAuthedSupabaseClient(token: string): SupabaseClient<Database> {
  return createClient<Database>(requireSitepixSupabaseUrl(), requireSitepixSupabasePublishableKey(), {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function requireAuthedContext(request: Request): Promise<AuthedContext> {
  const token = bearerToken(request);
  if (!token) throw new AuthError("Unauthorized");

  const supabase = createAuthedSupabaseClient(token);
  const { data, error } = await supabase.auth.getClaims(token);
  if (error || !data?.claims?.sub) throw new AuthError("Unauthorized");

  return {
    supabase,
    userId: data.claims.sub as string,
    token,
    claims: data.claims as Record<string, unknown>,
  };
}
