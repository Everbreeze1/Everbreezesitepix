import { createApiClient } from "@sitepix/api-client";
import { supabase } from "@/integrations/sitepix/client";

/**
 * Browser client for SitePix `/v1`.
 * Privileged UI work should go through this - not createServerFn.
 * Points at the standalone @sitepix/api deployment; falls back to same-origin
 * (the old colocated-Worker setup) when VITE_API_BASE_URL is unset.
 */
export const sitepixApi = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? "",
  getAccessToken: async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
});

type RpcOptions = { idempotent?: boolean };

/**
 * Adapter matching former createServerFn call shape: `fn({ data })` or `fn()`.
 * Forwards to `POST /v1/rpc`.
 */
export function rpcOp<TData = undefined, TResult = unknown>(op: string, options?: RpcOptions) {
  type Arg = TData extends undefined
    ? void | Record<string, never> | { data?: undefined }
    : { data: TData };

  return async (arg?: Arg): Promise<TResult> => {
    const data =
      arg && typeof arg === "object" && arg !== null && "data" in arg
        ? (arg as { data: TData }).data
        : undefined;
    return sitepixApi.rpc<TResult>(
      op,
      data as unknown,
      options?.idempotent ? { idempotencyKey: crypto.randomUUID() } : undefined,
    );
  };
}
