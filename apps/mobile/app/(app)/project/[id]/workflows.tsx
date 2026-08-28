import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProjectWorkflows } from "@/api/workflows";
import {
  applyWorkflowTemplate,
  listWorkflowTemplates,
  type TemplateSummary,
} from "@/api/templates";
import { QueueBanner } from "@/components/QueueBanner";
import { TemplatePickerSheet } from "@/components/TemplatePickerSheet";
import { useAuth } from "@/lib/auth";
import { spacing, useTheme } from "@/theme";
import { Plus, Workflow } from "@/ui/icons";
import {
  Badge,
  Card,
  EmptyState,
  ErrorState,
  IconButton,
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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  /**
   * Start a workflow template on this project.
   *
   * Three tables in a fixed order, so this needs a connection and cannot be
   * queued. On success it opens the workflow: applying a template and then
   * being left on the grid to find the card it created is the interaction the
   * web version explicitly fixed.
   */
  async function applyTemplate(template: TemplateSummary) {
    if (!id || !user?.id) return;
    setApplying(true);
    setApplyError(null);
    try {
      const workflowId = await applyWorkflowTemplate(id, template, user.id);
      await queryClient.invalidateQueries({ queryKey: ["project-workflows", id] });
      setPicking(false);
      router.push(`/workflow/${workflowId}`);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Could not start that workflow");
    } finally {
      setApplying(false);
    }
  }

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-workflows", id],
    queryFn: () => listProjectWorkflows(id!),
    enabled: Boolean(id),
  });

  const workflows = data ?? [];

  return (
    <>
      <Stack.Screen
        options={{
          title: "Workflows",
          headerRight: () => (
            <IconButton
              icon={Plus}
              accessibilityLabel="Start a workflow from a template"
              surface={false}
              tone="primary"
              onPress={() => setPicking(true)}
            />
          ),
        }}
      />
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
                body="Workflows are the named phases a job moves through. Start one from a template."
                action={{ label: "Use a template", icon: Plus, onPress: () => setPicking(true) }}
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
      <TemplatePickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Start a workflow"
        subtitle="From a workspace template"
        load={{ key: "workflow-templates", fetch: listWorkflowTemplates }}
        applying={applying}
        error={applyError}
        onPick={(template) => void applyTemplate(template)}
      />
    </>
  );
}
