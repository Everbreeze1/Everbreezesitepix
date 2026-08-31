import { useCallback, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { Stack } from "expo-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import {
  checkIsPlatformAdmin,
  getFeedbackSummary,
  listFeedback,
  replyToFeedback,
  setFeedbackStatus,
  type FeedbackPage,
} from "@/api/admin";
import {
  canReply,
  FEEDBACK_STATUSES,
  nextStatuses,
  normaliseStatus,
  queueHeadline,
  replyError,
  reportSummary,
  STATUS_LABELS,
  WEB_ONLY_ADMIN,
  type FeedbackReport,
  type FeedbackStatus,
} from "@/api/admin-view";
import { spacing } from "@/theme";
import { LifeBuoy, Send, Server } from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
  type SheetAction,
} from "@/ui";

/**
 * The platform admin console: triage, not administration.
 *
 * The web console is twelve routes. Most of it is administration done
 * deliberately at a desk, and putting that on a phone would be building a way
 * to delete a customer's workspace with a thumb on a train. What earns a phone
 * screen is the part a staff member wants away from one: read the feedback
 * queue, move a report on, answer it.
 *
 * **The gate is the important part of this file.** `platform_admins` has no
 * client access at all by design, so the phone cannot check membership itself
 * and does not try: it asks the server and believes the answer. `checkIsPlatformAdmin`
 * returns false on any unexpected shape or failure, because the two ways of
 * being wrong are not symmetric. Showing this to a customer exposes other
 * customers' reports; hiding it from a staff member costs them one trip to the
 * web console.
 */
export default function AdminScreen() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FeedbackStatus | "all">("new");
  const [actionsFor, setActionsFor] = useState<FeedbackReport | null>(null);
  const [replyingTo, setReplyingTo] = useState<FeedbackReport | null>(null);
  const [reply, setReply] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const adminQuery = useQuery({
    queryKey: ["is-platform-admin"],
    queryFn: checkIsPlatformAdmin,
    // Staff membership does not change during a session, and re-asking on every
    // focus spends a request to learn what it already knows.
    staleTime: 10 * 60 * 1000,
  });
  const isAdmin = adminQuery.data === true;

  const summaryQuery = useQuery({
    queryKey: ["feedback-summary"],
    queryFn: getFeedbackSummary,
    enabled: isAdmin,
  });

  const queueQuery = useInfiniteQuery({
    queryKey: ["feedback", filter],
    queryFn: ({ pageParam }) =>
      listFeedback({
        status: filter === "all" ? undefined : filter,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: FeedbackPage) => last.nextCursor ?? undefined,
    enabled: isAdmin,
  });

  const reports = useMemo(
    () => queueQuery.data?.pages.flatMap((page) => page.reports) ?? [],
    [queueQuery.data],
  );

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["feedback"] });
    void queryClient.invalidateQueries({ queryKey: ["feedback-summary"] });
  }, [queryClient]);

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      refresh();
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not work."),
  });

  const sendReply = useCallback(() => {
    const target = replyingTo;
    if (!target) return;
    const bad = replyError(reply);
    if (bad) {
      setFormError(bad);
      return;
    }
    const message = reply.trim();
    setReplyingTo(null);
    setReply("");
    setFormError(null);
    /*
     * Replying moves the report to `triaged` at the same time. Answering
     * something and leaving it in "not looked at" is a queue that lies to the
     * next person who opens it.
     */
    run.mutate(() => replyToFeedback({ reportId: target.id, message, status: "triaged" }));
  }, [replyingTo, reply, run]);

  const rowActions = useCallback(
    (report: FeedbackReport): SheetAction[] => {
      const current = normaliseStatus(report.status);
      const actions: SheetAction[] = [];

      if (canReply(report)) {
        actions.push({
          label: "Reply",
          icon: Send,
          onPress: () => {
            setReply("");
            setFormError(null);
            setReplyingTo(report);
          },
        });
      }

      for (const status of nextStatuses(current)) {
        actions.push({
          label: `Move to: ${STATUS_LABELS[status]}`,
          onPress: () => run.mutate(() => setFeedbackStatus([report.id], status)),
        });
      }
      return actions;
    },
    [run],
  );

  if (adminQuery.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Admin" }} />
        <SkeletonList rows={4} />
      </>
    );
  }

  /*
   * Not an error state, and deliberately not a "you are not allowed" message
   * either. Somebody who reaches this route without being staff should learn
   * nothing about what is behind it.
   */
  if (!isAdmin) {
    return (
      <>
        <Stack.Screen options={{ title: "Admin" }} />
        <EmptyState icon={Server} title="Nothing here" body="This screen is for Everlumen staff." />
      </>
    );
  }

  const statusCounts = (summaryQuery.data?.status ?? {}) as Partial<Record<FeedbackStatus, number>>;

  return (
    <>
      <Stack.Screen options={{ title: "Feedback queue" }} />

      <Screen padded={false} scroll={false} bottomInset={0}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
          <Text variant="bodyStrong">{queueHeadline(statusCounts)}</Text>
          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            <Chip label="All" selected={filter === "all"} onPress={() => setFilter("all")} />
            {FEEDBACK_STATUSES.map((status) => (
              <Chip
                key={status}
                label={STATUS_LABELS[status]}
                count={statusCounts[status]}
                selected={filter === status}
                onPress={() => setFilter(status)}
              />
            ))}
          </View>
        </View>

        {queueQuery.isLoading ? (
          <SkeletonList rows={5} />
        ) : queueQuery.error ? (
          <ErrorState
            title="Could not load the queue"
            message={queueQuery.error instanceof Error ? queueQuery.error.message : undefined}
            onRetry={() => void queueQuery.refetch()}
          />
        ) : reports.length === 0 ? (
          <EmptyState
            icon={LifeBuoy}
            title="Nothing in this bucket"
            body="Reports land here from both the web app and the phone."
          />
        ) : (
          // Virtualised, like the notifications inbox: this paginates thirty a
          // page and a busy queue is hundreds.
          <FlatList
            data={reports}
            keyExtractor={(report) => report.id}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
            refreshing={queueQuery.isRefetching}
            onRefresh={() => void queueQuery.refetch()}
            onEndReached={() => {
              if (queueQuery.hasNextPage && !queueQuery.isFetchingNextPage) {
                void queueQuery.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.6}
            initialNumToRender={8}
            maxToRenderPerBatch={8}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item: report }) => (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Badge
                      label={report.kind}
                      tone={
                        report.kind === "bug"
                          ? "danger"
                          : report.kind === "praise"
                            ? "success"
                            : "neutral"
                      }
                      variant="soft"
                    />
                    <Text variant="caption" tone="muted" style={{ flex: 1 }} numberOfLines={1}>
                      {relativeTime(report.created_at)}
                    </Text>
                  </View>

                  <Text variant="body" numberOfLines={6}>
                    {report.description}
                  </Text>

                  <Text variant="caption" tone="muted" numberOfLines={2}>
                    {reportSummary(report)}
                  </Text>

                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <Button
                      label="Handle"
                      size="sm"
                      variant="secondary"
                      disabled={run.isPending}
                      onPress={() => setActionsFor(report)}
                    />
                    {!canReply(report) ? (
                      <Badge label="Nobody to reply to" tone="neutral" variant="outline" />
                    ) : null}
                  </View>
                </View>
              </Card>
            )}
            ListFooterComponent={
              <View style={{ paddingTop: spacing.lg, gap: spacing.sm }}>
                {queueQuery.hasNextPage ? (
                  <Button
                    label={queueQuery.isFetchingNextPage ? "Loading" : "Load older"}
                    variant="secondary"
                    fullWidth
                    disabled={queueQuery.isFetchingNextPage}
                    onPress={() => void queueQuery.fetchNextPage()}
                  />
                ) : null}

                {/*
                  Said out loud. Without it a staff member concludes the console
                  is half-built rather than deliberately narrow, and goes hunting
                  for a delete button that is missing on purpose.
                */}
                <SectionHeader title="Still on the web" />
                <ListGroup>
                  {WEB_ONLY_ADMIN.map((item, index) => (
                    <View key={item}>
                      {index > 0 ? <RowDivider inset={false} /> : null}
                      <ListRow title={item} />
                    </View>
                  ))}
                </ListGroup>
                <Text variant="caption" tone="muted">
                  Each of those is irreversible or a configuration change, and a phone is the wrong
                  place for both.
                </Text>
              </View>
            }
          />
        )}
      </Screen>

      <ActionSheet
        visible={actionsFor !== null}
        onClose={() => setActionsFor(null)}
        title={actionsFor ? STATUS_LABELS[normaliseStatus(actionsFor.status)] : undefined}
        actions={actionsFor ? rowActions(actionsFor) : []}
      />

      <Sheet
        visible={replyingTo !== null}
        onClose={() => setReplyingTo(null)}
        title="Reply"
        subtitle="Lands in their notifications, not their email."
      >
        <View style={{ gap: spacing.lg }}>
          {replyingTo ? (
            <Card>
              <Text variant="caption" tone="muted" numberOfLines={6}>
                {replyingTo.description}
              </Text>
            </Card>
          ) : null}
          <Field
            value={reply}
            onChangeText={(next) => {
              setReply(next);
              if (formError) setFormError(null);
            }}
            placeholder="What you did about it"
            multiline
            rows={5}
            error={formError ?? undefined}
          />
          <Button label="Send and mark read" icon={Send} fullWidth onPress={sendReply} />
        </View>
      </Sheet>
    </>
  );
}
