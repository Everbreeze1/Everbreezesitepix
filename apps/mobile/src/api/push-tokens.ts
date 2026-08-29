import { supabase } from "@/lib/supabase";

/**
 * Registering this phone to receive push.
 *
 * Straight at `device_push_tokens` under RLS rather than through `/v1/rpc`,
 * because the policies are the whole of the rule: a person may register, claim
 * and unregister a token, and may see their own. Sending is the part that needs
 * the service role, and no client does it.
 *
 * See `supabase/migrations/20261004000000_device_push_tokens.sql`. The unique
 * index is on `token` alone, not on `(user_id, token)`, which is what makes a
 * phone handed from one employee to another move rather than duplicate.
 */

export type DeviceToken = {
  id: string;
  token: string;
  platform: string;
  device_name: string | null;
  last_seen_at: string;
  created_at: string;
};

/**
 * Register, or re-register, this device.
 *
 * An upsert on `token` rather than an insert. Expo hands back the same token
 * across launches, so an insert would fail on the unique index every time after
 * the first, and a "check then insert" would race two launches against each
 * other. Re-registering also moves the row to the caller, which is the
 * handed-over-phone case the policy is written for.
 */
export async function registerPushToken(args: {
  userId: string;
  token: string;
  platform: "ios" | "android";
  deviceName: string | null;
}): Promise<void> {
  const { error } = await (supabase as any).from("device_push_tokens").upsert(
    {
      user_id: args.userId,
      token: args.token,
      platform: args.platform,
      device_name: args.deviceName,
      // Touched every launch, which is what the 90-day sweep reads. A token
      // nothing refreshes belongs to an app that was uninstalled.
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "token" },
  );
  if (error) throw new Error(error.message);
}

/** Stop this device receiving. Used by sign-out and by the Account row. */
export async function unregisterPushToken(token: string): Promise<void> {
  const { error } = await (supabase as any).from("device_push_tokens").delete().eq("token", token);
  if (error) throw new Error(error.message);
}

/** Every phone this person is signed in on. */
export async function listMyDevices(): Promise<DeviceToken[]> {
  const { data, error } = await (supabase as any)
    .from("device_push_tokens")
    .select("id, token, platform, device_name, last_seen_at, created_at")
    .order("last_seen_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DeviceToken[];
}
