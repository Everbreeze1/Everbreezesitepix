import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { listProjectWalkthroughs } from "@/api/walkthroughs";
import { QueueBanner } from "@/components/QueueBanner";
import { radius, spacing, useTheme } from "@/theme";
import { Video } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";
import { listProjectSummaries } from "@/api/summaries";
import { markdownPreview, summarySubtitle } from "@/api/summary-view";

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 1) return "";
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

export default function ProjectWalkthroughsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-walkthroughs", id],
    queryFn: () => listProjectWalkthroughs(id!),
    enabled: Boolean(id),
  });

  const walkthroughs = data ?? [];

  /*
   * What has been WRITTEN UP, which is a different question from what was
   * recorded. The service keeps the two lists apart deliberately - conflating
   * them once produced a feed of mixed row types - and a summary can exist with
   * no recording behind it at all, written from photographs.
   */
  const summariesQuery = useQuery({
    queryKey: ["project-summaries", id],
    queryFn: () => listProjectSummaries(id!),
    enabled: Boolean(id),
  });
  const summaries = summariesQuery.data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Walkthroughs" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
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
            data={walkthroughs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{
              padding: spacing.lg,
              gap: spacing.md,
              // Clears the record button, which floats over the last row.
              paddingBottom: 120,
              flexGrow: 1,
            }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
            ListHeaderComponent={
              summaries.length > 0 ? (
                <View style={{ gap: spacing.sm, marginBottom: spacing.md }}>
                  <SectionHeader title="Written up" count={summaries.length} />
                  {summaries.map((summary) => (
                    <ListRow
                      key={summary.id}
                      title={summary.title}
                      /*
                        The first line of the write-up itself when there is one,
                        because that is what tells two summaries of the same job
                        apart. The counts fall back for one still being written.
                      */
                      subtitle={markdownPreview(summary.markdown) || summarySubtitle(summary)}
                      onPress={() =>
                        router.push({
                          pathname: "/summary/[summaryId]",
                          params: { summaryId: summary.id },
                        })
                      }
                    />
                  ))}
                  <SectionHeader title="Recorded" count={walkthroughs.length || undefined} />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                icon={Video}
                title="No walkthroughs yet"
                body="Record yourself walking the site and talking. The video, the photos you snap along the way and the narration stay together."
                action={{
                  label: "Record one",
                  icon: Video,
                  onPress: () => router.push(`/project/${id}/walkthrough-record`),
                }}
              />
            }
            renderItem={({ item }) => {
              const duration = formatDuration(item.duration_seconds);
              return (
                <Card
                  onPress={() => router.push(`/walkthrough/${item.id}`)}
                  accessibilityLabel={`${item.title}, ${relativeTime(item.created_at)}${
                    item.transcript ? ", transcript ready" : ", no transcript yet"
                  }`}
                >
                  <View style={{ gap: spacing.xs }}>
                    <Text variant="bodyStrong" numberOfLines={2}>
                      {item.title}
                    </Text>
                    <Text variant="caption" tone="muted">
                      {relativeTime(item.created_at)}
                      {duration ? ` · ${duration}` : ""}
                    </Text>

                    {/*
                     * Transcript state is shown plainly rather than hidden. A
                     * walkthrough recorded on the phone has video and photos but
                     * no transcript yet, and a report generated without one
                     * would be thin for reasons invisible from this screen. As a
                     * badge rather than a third line of caption text, because it
                     * is the one thing here that changes what you can do next.
                     */}
                    <Badge
                      label={item.transcript ? "Transcript ready" : "No transcript"}
                      tone={item.transcript ? "success" : "warning"}
                      style={{ marginTop: spacing.xs }}
                    />
                  </View>
                </Card>
              );
            }}
          />
        )}

        <View style={styles.fab}>
          <Button
            label="Record"
            icon={Video}
            size="lg"
            onPress={() => router.push(`/project/${id}/walkthrough-record`)}
            accessibilityHint="Starts recording a walkthrough of this site"
            style={{ borderRadius: radius.pill }}
          />
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
