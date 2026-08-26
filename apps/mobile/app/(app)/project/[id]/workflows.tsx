import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listProjectWorkflows } from "@/api/workflows";
import { QueueBanner } from "@/components/QueueBanner";
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

export default function ProjectWorkflowsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-workflows", id],
    queryFn: () => listProjectWorkflows(id!),
    enabled: Boolean(id),
  });

  const workflows = data ?? [];

  return (
    <>
      <Stack.Screen options={{ title: "Workflows" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        {isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : error ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {error instanceof Error ? error.message : "Failed to load workflows"}
            </Text>
          </View>
        ) : (
          <FlatList
            data={workflows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={
              workflows.length
                ? { padding: spacing.lg }
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
                No workflows on this project. Apply one from the web app.
              </Text>
            }
            renderItem={({ item }) => {
              const ratio = item.total > 0 ? item.done / item.total : 0;
              const finished = Boolean(item.completed_at);
              return (
                <Link href={`/workflow/${item.id}`} asChild>
                  <Pressable
                    style={[
                      styles.row,
                      { backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                    ]}
                  >
                    <Text style={[typography.heading, { color: theme.colors.foreground }]}>
                      {item.name}
                    </Text>
                    <Text
                      style={[
                        typography.caption,
                        { color: theme.colors.mutedForeground, marginTop: spacing.xs },
                      ]}
                    >
                      {finished ? "Complete" : `${item.done} of ${item.total} steps done`}
                    </Text>
                    <View style={[styles.track, { backgroundColor: theme.colors.muted }]}>
                      <View
                        style={[
                          styles.fill,
                          {
                            width: `${Math.round(ratio * 100)}%`,
                            backgroundColor: finished
                              ? theme.colors.primary
                              : theme.colors.primaryGlow,
                          },
                        ]}
                      />
                    </View>
                  </Pressable>
                </Link>
              );
            }}
          />
        )}
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
    minHeight: HIT_TARGET,
  },
  track: { height: 6, borderRadius: radius.pill, marginTop: spacing.md, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
});
