import { useEffect, useMemo } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listProjectWalkthroughs, listWalkthroughAuthors } from "@/api/walkthroughs";
import { getMyTeam } from "@/api/team";
import { memberName } from "@/api/team-roster";
import { ActionRail } from "@/components/ActionRail";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { QueueBanner } from "@/components/QueueBanner";
import { WalkthroughCard } from "@/components/walkthrough/WalkthroughCard";
import { useAuth } from "@/lib/auth";
import { spacing, useTheme } from "@/theme";
import { Sparkles, Video } from "@/ui/icons";
import {
  EmptyState,
  ErrorState,
  Icon,
  ListRow,
  SectionHeader,
  SkeletonList,
  Text,
  useCardPage,
} from "@/ui";
import { listProjectSummaries } from "@/api/summaries";
import { markdownPreview, summarySubtitle } from "@/api/summary-view";
import {
  aiSummaryStatus,
  photoOnlySummaries,
  recordedBy,
  summariesByWalkthrough,
  summaryFirstLine,
} from "@/api/walkthrough-list-view";

export default function ProjectWalkthroughsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  // Cards two or three across on a tablet and on a phone held on its side.
  const { inset, columns, width } = useCardPage();
  const cell = columns > 1 ? (width - inset * 2 - spacing.lg * (columns - 1)) / columns : undefined;
  const { session } = useAuth();

  /*
   * What was recorded and what was written up come from two ops, and the
   * service keeps them apart deliberately: a summary can exist with no
   * recording behind it at all, written from photographs. The screen pairs
   * them back up so each recording's card carries its own AI Summary.
   */
  const summariesQuery = useQuery({
    queryKey: ["project-summaries", id],
    queryFn: () => listProjectSummaries(id!),
    enabled: Boolean(id),
  });
  const summaries = useMemo(() => summariesQuery.data ?? [], [summariesQuery.data]);
  const pairs = useMemo(() => summariesByWalkthrough(summaries), [summaries]);

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-walkthroughs", id],
    queryFn: () => listProjectWalkthroughs(id!),
    enabled: Boolean(id),
  });

  const walkthroughs = useMemo(() => data ?? [], [data]);

  /*
   * Polled while any summary on the tab is still being written, so the badge
   * flips from Generating to Ready without a pull to refresh. Stopped the
   * moment nothing is pending.
   */
  const anyGenerating = walkthroughs.some(
    (w) => aiSummaryStatus(w, pairs.get(w.id)) === "generating",
  );
  const refetchSummaries = summariesQuery.refetch;
  useEffect(() => {
    if (!anyGenerating) return;
    const timer = setInterval(() => {
      void refetch();
      void refetchSummaries();
    }, 10_000);
    return () => clearInterval(timer);
  }, [anyGenerating, refetch, refetchSummaries]);

  const authorsQuery = useQuery({
    queryKey: ["walkthrough-authors", id],
    queryFn: () => listWalkthroughAuthors(id!),
    enabled: Boolean(id),
    staleTime: 5 * 60_000,
  });
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam, staleTime: 10 * 60_000 });
  const names = useMemo(
    () => new Map((teamQuery.data?.members ?? []).map((m) => [m.user_id, memberName(m)])),
    [teamQuery.data],
  );

  const fromPhotos = useMemo(() => photoOnlySummaries(summaries), [summaries]);

  const readyCount = walkthroughs.filter(
    (w) => aiSummaryStatus(w, pairs.get(w.id)) === "ready",
  ).length;
  const summaryLine =
    walkthroughs.length === 0
      ? null
      : `${walkthroughs.length} video${walkthroughs.length === 1 ? "" : "s"} · ${readyCount} AI Summar${
          readyCount === 1 ? "y" : "ies"
        } ready`;

  function refreshAll() {
    void refetch();
    void summariesQuery.refetch();
    void authorsQuery.refetch();
  }

  const openDetail = (walkthroughId: string, params: Record<string, string>) =>
    router.push({ pathname: "/walkthrough/[id]", params: { id: walkthroughId, ...params } });

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader projectId={id} title="Walkthroughs" summary={summaryLine} />
        <QueueBanner />

        {isLoading ? (
          <SkeletonList rows={4} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load walkthroughs"}
            onRetry={() => void refetch()}
          />
        ) : (
          <FlatList
            key={`cols-${columns}`}
            data={walkthroughs}
            keyExtractor={(item) => item.id}
            numColumns={columns}
            columnWrapperStyle={columns > 1 ? { gap: spacing.lg } : undefined}
            contentContainerStyle={{
              paddingHorizontal: inset,
              paddingTop: spacing.lg,
              gap: spacing.lg,
              // Clears the record button, which floats over the last row.
              paddingBottom: 120,
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={refreshAll}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
            ListHeaderComponent={
              walkthroughs.length > 0 ? (
                /*
                  Says up front that every walk is two things, which is what
                  the tab failed to make apparent before.
                */
                <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
                  <Icon icon={Sparkles} size="sm" tone="primary" />
                  <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                    Each walkthrough is a video and an AI Summary written from what you said, with
                    every photo described.
                  </Text>
                </View>
              ) : null
            }
            ListFooterComponent={
              fromPhotos.length > 0 ? (
                <View style={{ gap: spacing.sm }}>
                  <SectionHeader title="Written from photos" count={fromPhotos.length} />
                  {fromPhotos.map((summary) => (
                    <ListRow
                      key={summary.id}
                      title={summary.title}
                      subtitle={markdownPreview(summary.markdown) || summarySubtitle(summary)}
                      onPress={() =>
                        router.push({
                          pathname: "/summary/[summaryId]",
                          params: { summaryId: summary.id },
                        })
                      }
                    />
                  ))}
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                icon={Video}
                title="No walkthroughs yet"
                body="Record a narrated walk of the site and get two things: the video, and an AI Summary that describes every photo you took."
                action={{
                  label: "Record walkthrough",
                  icon: Video,
                  onPress: () => router.push(`/project/${id}/walkthrough-record`),
                }}
              />
            }
            renderItem={({ item }) => {
              const summary = pairs.get(item.id) ?? null;
              const status = aiSummaryStatus(item, summary);
              return (
                <View style={cell ? { width: cell } : undefined}>
                  <WalkthroughCard
                    walkthrough={item}
                    status={status}
                    firstLine={summaryFirstLine(summary?.markdown ?? null)}
                    author={recordedBy(
                      authorsQuery.data?.get(item.id),
                      session?.user?.id ?? null,
                      names,
                    )}
                    onWatch={() => openDetail(item.id, item.video_path ? { play: "1" } : {})}
                    onRead={() => openDetail(item.id, { tab: "summary" })}
                  />
                </View>
              );
            }}
          />
        )}

        {/*
          Not while the empty state is up, and not while the list is loading.

          `ListEmptyComponent` offers "Record walkthrough" as its own action, so
          with nothing recorded the rail would be a second identical button
          beside it. Hidden while loading too: a floating action over skeleton
          rows invites a tap before the screen can say whether there is
          anything there.
        */}
        {isLoading || walkthroughs.length === 0 ? null : (
          <ActionRail
            labelled
            actions={[
              {
                key: "record",
                icon: Video,
                label: "Record walkthrough",
                hint: "Starts recording a walkthrough of this site",
                onPress: () => router.push(`/project/${id}/walkthrough-record`),
              },
            ]}
          />
        )}
      </View>
    </>
  );
}
