import { rpcOp } from "./everlumen-api";
import type { Notification } from "@everlumen/api";

export type { Notification };

export const listNotifications = rpcOp<
  { cursor?: string; limit?: number },
  { notifications: Notification[]; nextCursor: string | null }
>("listNotifications");

export const getUnreadNotificationCount = rpcOp<undefined, { count: number }>(
  "getUnreadNotificationCount",
);

export const markNotificationRead = rpcOp<{ notificationId: string }, { ok: true }>(
  "markNotificationRead",
);

export const markAllNotificationsRead = rpcOp<undefined, { ok: true }>("markAllNotificationsRead");
