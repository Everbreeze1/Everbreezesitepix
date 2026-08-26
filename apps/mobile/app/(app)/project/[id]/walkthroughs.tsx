import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { listProjectWalkthroughs } from "@/api/walkthroughs";
import { QueueBanner } from "@/components/QueueBanner";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

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

  return (
    <>
      <Stack.Screen options={{ title: "Walkthroughs" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Failed to load walkthroughs"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={walkthroughs}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              walkthroughs.length
                ? { padding: spacing.lg, paddingBottom: 120 }
                : { flexGrow: 1, justifyContent: "center", padding: spacing.xl }
            }
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.primary}
              />
            }
            ListEmptyComponent={
              <Text
                style={[
                  typography.body,
                  { color: theme.colors.mutedForeground, textAlign: "center" },
                ]}
              >
                No walkthroughs yet. Record one as you walk the site.
              </Text>
            }
            renderItem={({ item }) => (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/walkthrough/${item.id}`)}
                style={[
                  styles.row,
                  { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  {item.title}
                </Text>
                <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                  {relativeTime(item.created_at)}
                  {formatDuration(item.duration_seconds)
                    ? ` · ${formatDuration(item.duration_seconds)}`
                    : ""}
                </Text>

                {/*
                 * Transcript state is shown plainly rather than hidden. A
                 * walkthrough recorded on the phone has video and photos but no
                 * transcript yet, and a report generated without one would be
                 * thin for reasons the user cannot see from here.
                 */}
                <Text
                  style={[
                    typography.caption,
                    { color: item.transcript ? theme.colors.primary : theme.colors.safety },
                  ]}
                >
                  {item.transcript
                    ? "Transcript ready"
                    : "No transcript yet. Generate it from the web app."}
                </Text>
              </Pressable>
            )}
          />
        )}

        <Pressable
          accessibilityRole="button"
          style={[styles.fab, { backgroundColor: theme.colors.primary }]}
          onPress={() => router.push(`/project/${id}/walkthrough-record`)}
        >
          <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
            Record
          </Text>
        </Pressable>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  row: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: spacing.md,
    gap: spacing.xs,
    minHeight: HIT_TARGET,
  },
  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.xl,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    minHeight: HIT_TARGET,
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
