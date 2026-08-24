import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import {
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/lib/notifications.functions";
import { qk } from "@/lib/query-keys";

const RECENT_LIMIT = 8;

export function useNotifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const unreadQuery = useQuery({
    queryKey: qk.notificationsUnread(user?.id ?? ""),
    queryFn: () => getUnreadNotificationCount(),
    enabled: !!user,
  });

  const listQuery = useQuery({
    queryKey: qk.notificationsList(user?.id ?? ""),
    queryFn: () => listNotifications({ data: { limit: RECENT_LIMIT } }),
    enabled: !!user,
  });

  useEffect(() => {
    if (!user) return;
    const channelName = `notifications:${user.id}:${Math.random().toString(36).slice(2)}`;
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: qk.notificationsUnread(user.id) });
      qc.invalidateQueries({ queryKey: qk.notificationsList(user.id) });
    };
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `recipient_id=eq.${user.id}`,
        },
        invalidate,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [user, qc]);

  const patchRead = (ids: Set<string>) => {
    if (!user) return;
    qc.setQueryData(
      qk.notificationsList(user.id),
      (cur: { notifications: Notification[]; nextCursor: string | null } | undefined) =>
        cur && {
          ...cur,
          notifications: cur.notifications.map((n) =>
            ids.has(n.id) && !n.readAt ? { ...n, readAt: new Date().toISOString() } : n,
          ),
        },
    );
    qc.setQueryData(
      qk.notificationsUnread(user.id),
      (cur: { count: number } | undefined) => cur && { count: Math.max(0, cur.count - ids.size) },
    );
  };

  const markRead = async (notificationId: string) => {
    const n = listQuery.data?.notifications.find((x) => x.id === notificationId);
    if (n?.readAt) return;
    patchRead(new Set([notificationId]));
    await markNotificationRead({ data: { notificationId } });
  };

  const markAllRead = async () => {
    const unreadIds = (listQuery.data?.notifications ?? [])
      .filter((n) => !n.readAt)
      .map((n) => n.id);
    if (unreadIds.length === 0 && (unreadQuery.data?.count ?? 0) === 0) return;
    patchRead(new Set(unreadIds));
    if (user) qc.setQueryData(qk.notificationsUnread(user.id), { count: 0 });
    await markAllNotificationsRead();
  };

  return {
    unreadCount: unreadQuery.data?.count ?? 0,
    recent: listQuery.data?.notifications ?? [],
    isLoading: listQuery.isLoading,
    markRead,
    markAllRead,
  };
}
