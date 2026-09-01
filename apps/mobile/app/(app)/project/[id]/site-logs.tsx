import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { createSiteLog, deleteSiteLog, listSiteLogs } from "@/api/site-logs";
import {
  defaultSiteLogTitle,
  openTodoCount,
  siteLogSummary,
  type SiteLogRow,
} from "@/api/site-log-notes";
import { spacing } from "@/theme";
import { FileText, Plus, Trash2 } from "@/ui/icons";
import {
  Button,
  CountBadge,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * A project's site logs.
 *
 * A site log is the day's photos with a note and a to-do list against each one:
 * the thing a supervisor writes up at the end of a visit and sends on. It has
 * existed on the web since July and had no route from the phone, which is
 * backwards, because the photos are taken on the phone and the notes are
 * remembered on the walk back to the van rather than at a desk that evening.
 *
 * This screen is the list. Everything about one log lives in `site-log/[logId]`.
 */
export default function ProjectSiteLogsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["site-logs", id], [id]);

  const query = useQuery({
    queryKey,
    queryFn: () => listSiteLogs(id!),
    enabled: Boolean(id),
  });

  const logs = query.data ?? [];

  const create = useMutation({
    mutationFn: () =>
      createSiteLog({
        projectId: id!,
        title: defaultSiteLogTitle(),
        // Created empty and filled in on the next screen. Making the log first
        // means a crew that gets interrupted halfway through choosing photos
        // still has something to come back to.
        photoIds: [],
        notes: {},
      }),
    onSuccess: (row) => {
      void queryClient.invalidateQueries({ queryKey });
      router.push({ pathname: "/site-log/[logId]", params: { logId: row.id, projectId: id! } });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not start a log."),
  });

  const remove = useMutation({
    mutationFn: (logId: string) => deleteSiteLog(logId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not delete that log."),
  });

  const confirmDelete = useCallback(
    (log: SiteLogRow) => {
      Alert.alert(
        `Delete "${log.title}"?`,
        "The photos stay on the project. Only the notes and to-dos written on this log go.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => remove.mutate(log.id) },
        ],
      );
    },
    [remove],
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Site logs",
          /*
           * In the header, not under the list. The action's reach must not
           * shrink as the list grows: below the rows, the cost of creating one
           * more rises with how many you already have.
           */
          headerRight: () => (
            <IconButton
              icon={Plus}
              accessibilityLabel="Start a log"
              surface={false}
              tone="primary"
              disabled={create.isPending}
              onPress={() => create.mutate()}
            />
          ),
        }}
      />

      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        {query.isLoading ? (
          <SkeletonList rows={4} />
        ) : query.error ? (
          <ErrorState
            title="Could not load site logs"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {logs.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No site logs yet"
                /*
                  No PDF claim. Export calls `generateSiteLogPdf`, which returns
                  a file the phone would then have to save or share, and that
                  half is not built. Advertising it here is the app promising
                  something it cannot do, which is worse than not mentioning it.
                */
                body="Pick the day's photos, write a line against each, and add anything that still needs doing before you leave."
                action={{ label: "Start a log", onPress: () => create.mutate(), icon: Plus }}
              />
            ) : (
              <>
                <ListGroup>
                  {logs.map((log, index) => {
                    const open = openTodoCount(log);
                    return (
                      <View key={log.id}>
                        {index > 0 ? <RowDivider /> : null}
                        <ListRow
                          icon={FileText}
                          title={log.title}
                          subtitle={`${siteLogSummary(log)} · ${relativeTime(log.updated_at)}`}
                          right={
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: spacing.sm,
                              }}
                            >
                              {/*
                                The open to-do count, not the total. It is the
                                only number on this row anybody acts on.
                              */}
                              {open > 0 ? <CountBadge count={open} tone="primary" /> : null}
                              <IconButton
                                icon={Trash2}
                                tone="destructive"
                                surface={false}
                                accessibilityLabel={`Delete ${log.title}`}
                                onPress={() => confirmDelete(log)}
                              />
                            </View>
                          }
                          onPress={() =>
                            router.push({
                              pathname: "/site-log/[logId]",
                              params: { logId: log.id, projectId: id! },
                            })
                          }
                        />
                      </View>
                    );
                  })}
                </ListGroup>
              </>
            )}
          </View>
        )}
      </Screen>
    </>
  );
}
