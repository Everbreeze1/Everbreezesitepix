import { useCallback, useMemo, useState } from "react";
import { ActionRail } from "@/components/ActionRail";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { createSiteLog, deleteSiteLog, listSiteLogs } from "@/api/site-logs";
import {
  defaultSiteLogTitle,
  openTodoCount,
  siteLogSummary,
  type SiteLogRow,
} from "@/api/site-log-notes";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { spacing, useTheme } from "@/theme";
import { NotebookPen, Plus, Trash2 } from "@/ui/icons";
import {
  ActionSheet,
  CardGrid,
  EmptyState,
  ErrorState,
  ItemCard,
  SkeletonList,
  StatusChip,
  Text,
  useCardPage,
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
  const theme = useTheme();
  const { inset } = useCardPage();
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<SiteLogRow | null>(null);

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

  const openTodos = logs.reduce((sum, log) => sum + openTodoCount(log), 0);
  const summary =
    logs.length === 0
      ? null
      : [
          `${logs.length} log${logs.length === 1 ? "" : "s"}`,
          openTodos > 0 ? `${openTodos} open to-do${openTodos === 1 ? "" : "s"}` : "No open to-dos",
          `updated ${relativeTime(logs[0].updated_at)}`,
        ].join(" · ");

  const openLog = (logId: string) =>
    router.push({ pathname: "/site-log/[logId]", params: { logId, projectId: id! } });

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader projectId={id} title="Site logs" summary={summary} />

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: inset,
            paddingTop: spacing.lg,
            // Room for the floating Start a log button.
            paddingBottom: 120,
            gap: spacing.md,
            flexGrow: 1,
          }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={() => void query.refetch()}
              tintColor={theme.colors.mutedForeground}
              colors={[theme.colors.primary]}
            />
          }
        >
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}

          {query.isLoading ? (
            <SkeletonList rows={4} />
          ) : query.error ? (
            <ErrorState
              title="Could not load site logs"
              message={query.error instanceof Error ? query.error.message : undefined}
              onRetry={() => void query.refetch()}
            />
          ) : logs.length === 0 ? (
            <EmptyState
              icon={NotebookPen}
              title="No site logs yet"
              /*
                No PDF claim here: the list cannot export, only an open log
                can, and promising it from an empty screen oversells it.
              */
              body="Pick the day's photos, write a line against each, and add anything that still needs doing before you leave."
              action={{ label: "Start a log", onPress: () => create.mutate(), icon: Plus }}
            />
          ) : (
            <CardGrid>
              {logs.map((log) => {
                const open = openTodoCount(log);
                return (
                  <ItemCard
                    key={log.id}
                    icon={NotebookPen}
                    title={log.title}
                    meta={`${siteLogSummary(log)} · ${relativeTime(log.updated_at)}`}
                    /*
                      The open to-do count, not the total. It is the only
                      number on this card anybody acts on.
                    */
                    status={
                      open > 0 ? (
                        <StatusChip label={`${open} to do`} tone="warning" />
                      ) : (
                        <StatusChip label="Clear" tone="success" />
                      )
                    }
                    onPress={() => openLog(log.id)}
                    onMenu={() => setMenuFor(log)}
                    menuLabel={`More actions for ${log.title}`}
                  />
                );
              })}
            </CardGrid>
          )}
        </ScrollView>
      </View>

      {/* Hidden while the empty state offers the same thing. */}
      {query.isLoading || logs.length === 0 ? null : (
        <ActionRail
          actions={[
            {
              key: "new-log",
              icon: Plus,
              label: "Start a log",
              disabled: create.isPending,
              onPress: () => create.mutate(),
            },
          ]}
        />
      )}

      <ActionSheet
        visible={menuFor !== null}
        onClose={() => setMenuFor(null)}
        title={menuFor?.title}
        actions={
          menuFor
            ? [
                { label: "Open", icon: NotebookPen, onPress: () => openLog(menuFor.id) },
                {
                  label: "Delete this log",
                  icon: Trash2,
                  destructive: true,
                  onPress: () => confirmDelete(menuFor),
                },
              ]
            : []
        }
      />
    </>
  );
}
