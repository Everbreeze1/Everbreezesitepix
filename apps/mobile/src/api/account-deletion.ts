import { api } from "@/lib/api";

/**
 * Closing your own account, from the phone.
 *
 * **Required by Google Play**, which since 2024 has rejected a support email
 * address as the only route to deletion. It has to be reachable in the app or
 * from a web page, and it has to actually delete.
 *
 * The op runs with the service role and deletes through
 * `auth.admin.deleteUser`, which cascades. Nothing here is optimistic and
 * nothing is queued: this is the one write in the app where a local guess about
 * whether it succeeded would be actively harmful, because the next thing that
 * happens is the session stops working.
 */

export async function deleteMyAccount(confirmEmail: string): Promise<void> {
  await api.rpc("deleteMyAccount", { confirmEmail });
}
