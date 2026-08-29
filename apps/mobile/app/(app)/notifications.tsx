import { useCallback, useMemo, useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router, Stack } from "expo-router";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type Notification,
  type NotificationPage,
} from "@/api/notifications";
import {
  inboxSummary,
  markedRead,
  notificationGlyph,
  notificationTarget,
  notificationTone,
  unreadCount,
  type NotificationGlyph,
} from "@/api/notification-target";
import { spacing } from "@/theme";
import {
  Bell,
  CheckCheck,
  ClipboardCheck,
  FolderKanban,
  Megaphone,
  MessageSquare,
  SquareCheckBig,
  Users,
  Workflow,
} from "@/ui/icons";
import {
  Button,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SkeletonList,
  Text,
  type LucideIcon,
} from "@/ui";

/**
 * The notifications inbox.
 *
 * The one surface that answers "does anything need me", and until now the phone
 * had no route to it at all: assignments, mentions and completions were raised
 * by triggers, delivered to the web bell, and simply never seen by the person
 * holding the phone on site. That is the wrong way round. A task assigned to
 * someone in a crawlspace is the exact case notifications exist for.
 *
 * Read-only in the offline sense, and deliberately so. There is nothing here to
 * enqueue: marking read is a preference, not work, and a mark that failed
 * because the tunnel had no signal is not worth a queue row. What it does have
 * is optimism, so the count drops the instant a row is opened rather than after
 * a round trip.
 */

/** The six glyph names `notificationGlyph` returns, resolved to icons. */
const GLYPHS: Record<NotificationGlyph, LucideIcon> = {
  task: SquareCheckBig,
  checklist: ClipboardCheck,
  workflow: Workflow,
  comment: MessageSquare,
  team: Users,
  project: FolderKanban,
  announcement: Megaphone,
};

const QUERY_KEY = ["notifications"] as const;

export default function NotificationsScreen() {
  const queryClient = useQueryClient();
  const [markingAll, setMarkingAll] = useState(false);

  const query = useInfiniteQuery({
    queryKey: QUERY_KEY,
    queryFn: ({ pageParam }) => listNotifications(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: NotificationPage) => last.nextCursor ?? undefined,
  });

  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.notifications) ?? [],
    [query.data],
  );
  const unread = unreadCount(items);

  /**
   * Apply the read stamp across every loaded page.
   *
   * `useInfiniteQuery` stores pages, not a flat list, so the patch has to run
   * per page. `markedRead` returns the same array when it changed nothing,
   * which keeps a page that had no unread rows referentially stable and out of
   * the re-render.
   */
  const patchRead = useCallback(
    (ids: ReadonlySet<string>) => {
      const at = new Date().toISOString();
      queryClient.setQueryData<{ pages: NotificationPage[]; pageParams: unknown[] }>(
        QUERY_KEY,
        (current) =>
          current && {
            ...current,
            pages: current.pages.map((page) => {
              const notifications = markedRead(page.notifications, ids, at);
              return notifications === page.notifications ? page : { ...page, notifications };
            }),
          },
      );
      // The tab badge reads its own count, so it has to be told separately or
      // it keeps showing the number that was true before the tap.
      void queryClient.invalidateQueries({ queryKey: ["notifications-unread"] });
    },
    [queryClient],
  );

  const open = useCallback(
    (n: Notification) => {
      if (!n.readAt) {
        patchRead(new Set([n.id]));
        /*
         * Fire and forget. The row is already marked in the cache, and a failed
         * mark is a notification that reappears unread later, which is a far
         * smaller problem than a tap that blocks on the network before
         * navigating.
         */
        void markNotificationRead(n.id).catch(() => {});
      }

      const target = notificationTarget(n);
      // Null is a real answer: team and workspace notifications point at
      // surfaces the phone does not have native screens for yet. The row still
      // marks itself read, it just does not navigate.
      if (target) router.push({ pathname: target.pathname as never, params: target.params });
    },
    [patchRead],
  );

  const markAll = useCallback(async () => {
    const ids = new Set(items.filter((n) => !n.readAt).map((n) => n.id));
    if (ids.size === 0) return;
    setMarkingAll(true);
    patchRead(ids);
    try {
      await markAllNotificationsRead();
    } catch {
      // Server-side this is one statement, so a failure means the whole thing
      // did not happen. Refetching puts the unread marks back rather than
      // leaving the list claiming a state the server does not agree with.
      void query.refetch();
    } finally {
      setMarkingAll(false);
    }
  }, [items, patchRead, query]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Notifications",
          headerRight: () =>
            unread > 0 ? (
              <Button
                label="Mark all read"
                size="sm"
                variant="ghost"
                icon={CheckCheck}
                disabled={markingAll}
                onPress={() => void markAll()}
              />
            ) : null,
        }}
      />

      <Screen
        padded={false}
        scroll={false}
        // Nothing is docked at the bottom of this screen, so the list runs to
        // the safe area rather than reserving a footer's worth of dead space.
        bottomInset={0}
      >
        {query.isLoading ? (
          <View style={{ padding: spacing.lg }}>
            <SkeletonList rows={6} />
          </View>
        ) : query.error ? (
          <ErrorState
            title="Could not load notifications"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="Nothing yet"
            body="Assignments, mentions and completions land here. You will see them on this phone as soon as somebody raises one."
          />
        ) : (
          <ScrollView
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom: spacing.xxl,
              gap: spacing.md,
            }}
            refreshControl={
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={() => void query.refetch()}
              />
            }
            onMomentumScrollEnd={({ nativeEvent }) => {
              // Load the next page a screenful early, so scrolling never stops
              // at a spinner on a connection that is merely slow.
              const { contentOffset, layoutMeasurement, contentSize } = nativeEvent;
              const remaining = contentSize.height - (contentOffset.y + layoutMeasurement.height);
              if (
                remaining < layoutMeasurement.height &&
                query.hasNextPage &&
                !query.isFetchingNextPage
              ) {
                void query.fetchNextPage();
              }
            }}
          >
            <Text variant="caption" tone="muted">
              {inboxSummary(items.length, unread)}
            </Text>

            <ListGroup>
              {items.map((n, index) => (
                <View key={n.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={GLYPHS[notificationGlyph(n.type)]}
                    iconTone={notificationTone(n.type)}
                    title={n.title}
                    /*
                     * Body and age share one line. A notification body is a
                     * sentence ("Assigned by Sam"), and stacking a third line
                     * under it for a timestamp turns a scannable list into a
                     * wall.
                     */
                    subtitle={
                      n.body
                        ? `${n.body} · ${relativeTime(n.createdAt)}`
                        : relativeTime(n.createdAt)
                    }
                    unread={!n.readAt}
                    onPress={() => open(n)}
                  />
                </View>
              ))}
            </ListGroup>

            {query.hasNextPage ? (
              <Button
                label={query.isFetchingNextPage ? "Loading" : "Load older"}
                variant="secondary"
                fullWidth
                disabled={query.isFetchingNextPage}
                onPress={() => void query.fetchNextPage()}
              />
            ) : null}
          </ScrollView>
        )}
      </Screen>
    </>
  );
}
