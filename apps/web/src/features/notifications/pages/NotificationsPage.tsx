import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Bell, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { formatRelativeTime } from "@/lib/format-time";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
} from "@/lib/notifications.functions";

const PAGE_SIZE = 20;

export function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listNotifications({ data: { limit: PAGE_SIZE } });
      setItems(res.notifications);
      setNextCursor(res.nextCursor);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await listNotifications({ data: { cursor: nextCursor, limit: PAGE_SIZE } });
      setItems((cur) => [...cur, ...res.notifications]);
      setNextCursor(res.nextCursor);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  };

  const openNotification = async (n: Notification) => {
    if (!n.readAt) {
      setItems((cur) => cur.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      markNotificationRead({ data: { notificationId: n.id } }).catch(() => {});
    }
    if (n.linkPath) navigate({ to: n.linkPath });
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await markAllNotificationsRead();
      setItems((cur) => cur.map((n) => (n.readAt ? n : { ...n, readAt: new Date().toISOString() })));
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to mark all as read");
    } finally {
      setMarkingAll(false);
    }
  };

  const unreadCount = items.filter((n) => !n.readAt).length;

  return (
    <div className="mx-auto max-w-3xl px-3 pb-16 pt-4 sm:px-4">
      <PageHeader
        title="Notifications"
        description={loading ? "Loading…" : `${items.length} notification${items.length === 1 ? "" : "s"}`}
        actions={
          unreadCount > 0 ? (
            <Button variant="outline" size="sm" disabled={markingAll} onClick={() => void markAllRead()}>
              <CheckCheck className="mr-1.5 h-4 w-4" />
              Mark all read
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <Card className="mt-6 flex flex-col items-center gap-2 border-dashed p-12 text-center text-sm text-muted-foreground">
          <Bell className="h-10 w-10 opacity-40" />
          <p className="font-medium">No notifications yet</p>
          <p className="text-xs">
            Task assignments, checklist assignments, comment mentions, and team activity will show up
            here.
          </p>
        </Card>
      ) : (
        <>
          <div className="mt-5 grid gap-2">
            {items.map((n) => (
              <Card
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => void openNotification(n)}
                className={`flex items-start gap-3 border-border/60 p-4 text-left transition-colors hover:bg-accent ${
                  n.readAt ? "" : "border-primary/30 bg-primary/5"
                }`}
              >
                {!n.readAt && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />}
                <div className={`min-w-0 flex-1 ${n.readAt ? "pl-5" : ""}`}>
                  <p className="text-sm font-semibold text-foreground">{n.title}</p>
                  {n.body && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>}
                  <p className="mt-1.5 text-xs text-muted-foreground">{formatRelativeTime(n.createdAt)}</p>
                </div>
              </Card>
            ))}
          </div>
          {nextCursor && (
            <div className="mt-5 flex justify-center">
              <Button variant="outline" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                {loadingMore ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
