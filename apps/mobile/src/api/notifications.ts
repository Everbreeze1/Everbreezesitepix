import { api } from "@/lib/api";
import type { NotificationType } from "./notification-target";

/**
 * The notifications inbox.
 *
 * Through `/v1/rpc` rather than a direct RLS read, even though the table grants
 * `SELECT` to the recipient and would answer a `supabase.from("notifications")`
 * query perfectly well. Two reasons, and the second is the real one:
 *
 * 1. `packages/db` still declares roughly fourteen tables and `notifications`
 *    is not among them, so a direct read means another `(supabase as any)`.
 * 2. The mark-read ops are not plain updates. `markAllNotificationsRead` is one
 *    statement server-side and would be a read-then-write race from a client.
 *
 * The pure half of this feature (where a row navigates to, how its age reads,
 * the optimistic mark-read patch) lives in `notification-target.ts`, which
 * imports nothing and is tested directly.
 */

export type Notification = {
  id: string;
  recipientId: string;
  actorId: string | null;
  /*
   * Widened past the union because the column is plain `text` with a CHECK
   * upstream, and the server has added five types since the table was created.
   * A build of the app older than the newest type still has to render its
   * notifications rather than fall through to undefined.
   */
  type: NotificationType | (string & {});
  title: string;
  body: string | null;
  linkPath: string | null;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
  readAt: string | null;
  createdAt: string;
};

export type NotificationPage = {
  notifications: Notification[];
  nextCursor: string | null;
};

/** Matches the server's `max(50)`, and is what one screenful plus scroll costs. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

export async function listNotifications(cursor?: string): Promise<NotificationPage> {
  const result = await api.rpc<Partial<NotificationPage>>("listNotifications", {
    limit: NOTIFICATIONS_PAGE_SIZE,
    ...(cursor ? { cursor } : {}),
  });
  // Defaulting rather than trusting the shape: an empty inbox and a changed
  // response should both render an empty list, not crash the tab.
  return {
    notifications: result?.notifications ?? [],
    nextCursor: result?.nextCursor ?? null,
  };
}

export async function getUnreadNotificationCount(): Promise<number> {
  const result = await api.rpc<{ count?: number }>("getUnreadNotificationCount");
  return result?.count ?? 0;
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await api.rpc("markNotificationRead", { notificationId });
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.rpc("markAllNotificationsRead");
}
