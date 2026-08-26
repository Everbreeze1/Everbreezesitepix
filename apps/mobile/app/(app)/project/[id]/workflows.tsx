import { FlatList, RefreshControl, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { listProjectWorkflows } from "@/api/workflows";
import { QueueBanner } from "@/components/QueueBanner";
import { spacing, useTheme } from "@/theme";
import { Workflow } from "@/ui/icons";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  ProgressBar,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * The workflows running on a project, with how far through each one is.
 *
 * The progress bar was already here as a hand-rolled track and fill. It moves to
 * `ProgressBar` because the checklist runner and the upload queue draw the same
 * thing, and the three had different heights and different radii. The one real
 * change is the colour: a finished workflow now reads green rather than a
 * slightly darker blue than an unfinished one, which was a distinction nobody
 * could see.
 */
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
          <SkeletonList rows={4} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load workflows"}
            onRetry={() => void refetch()}
          />
        ) : (
          <FlatList
            data={workflows}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: spacing.lg, gap: spacing.md, flexGrow: 1 }}
            refreshControl={
              <RefreshControl
                refreshing={isRefetching}
                onRefresh={() => void refetch()}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
            ListEmptyComponent={
              <EmptyState
                icon={Workflow}
                title="No workflows here"
                body="Workflows are the named phases a job moves through. Apply one to this project from the web app."
              />
            }
            renderItem={({ item }) => {
              const finished = Boolean(item.completed_at);
              return (
                <Card
                  onPress={() => router.push(`/workflow/${item.id}`)}
                  accessibilityLabel={`${item.name}, ${
                    finished ? "complete" : `${item.done} of ${item.total} steps done`
                  }`}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      gap: spacing.md,
                      marginBottom: spacing.md,
                    }}
                  >
                    <Text variant="heading" style={{ flex: 1 }} numberOfLines={2}>
                      {item.name}
                    </Text>
                    {finished ? <Badge label="Complete" tone="success" /> : null}
                  </View>

                  <ProgressBar
                    value={item.done}
                    total={item.total}
                    tone={finished ? "success" : "primary"}
                    showLabel
                    label={finished ? "Complete" : `${item.done} of ${item.total} steps done`}
                  />
                </Card>
              );
            }}
          />
        )}
      </View>
    </>
  );
}
