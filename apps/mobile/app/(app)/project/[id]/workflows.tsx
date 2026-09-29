import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProjectWorkflows } from "@/api/workflows";
import {
  applyWorkflowTemplate,
  listWorkflowTemplates,
  type TemplateSummary,
} from "@/api/templates";
import { ActionRail } from "@/components/ActionRail";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { QueueBanner } from "@/components/QueueBanner";
import { TemplatePickerSheet } from "@/components/TemplatePickerSheet";
import { useAuth } from "@/lib/auth";
import { spacing, useTheme } from "@/theme";
import { LayoutTemplate, Plus, RefreshCw, Workflow } from "@/ui/icons";
import {
  ActionSheet,
  CardGrid,
  EmptyState,
  ErrorState,
  ItemCard,
  KebabButton,
  SkeletonList,
  StatusChip,
  useCardPage,
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
  const { inset } = useCardPage();
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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

  const complete = workflows.filter((row) => Boolean(row.completed_at)).length;
  const steps = workflows.reduce(
    (acc, row) => ({ done: acc.done + row.done, total: acc.total + row.total }),
    { done: 0, total: 0 },
  );
  const summary =
    workflows.length === 0
      ? null
      : `${workflows.length} workflow${workflows.length === 1 ? "" : "s"} · ${complete} complete · ${steps.done} of ${steps.total} steps done`;

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader
          projectId={id}
          title="Workflows"
          summary={summary}
          progress={
            workflows.length > 0
              ? {
                  value: steps.done,
                  total: steps.total,
                  tone: complete === workflows.length ? "success" : "primary",
                }
              : null
          }
          actions={<KebabButton onPress={() => setMenuOpen(true)} />}
        />
        <QueueBanner />

        {isLoading ? (
          <SkeletonList rows={4} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load workflows"}
            onRetry={() => void refetch()}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: inset,
              paddingTop: spacing.lg,
              // Room for the floating New workflow button.
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
          >
            {workflows.length === 0 ? (
              <EmptyState
                icon={Workflow}
                title="No workflows here"
                body="Workflows are the named phases a job moves through. Start one from a template."
                action={{ label: "Use a template", icon: Plus, onPress: () => setPicking(true) }}
              />
            ) : (
              <CardGrid>
                {workflows.map((item) => {
                  const finished = Boolean(item.completed_at);
                  return (
                    <ItemCard
                      key={item.id}
                      icon={Workflow}
                      iconTone={finished ? "success" : "primary"}
                      title={item.name}
                      meta={`${item.total} step${item.total === 1 ? "" : "s"}`}
                      status={
                        finished ? (
                          <StatusChip label="Complete" tone="success" />
                        ) : item.done > 0 ? (
                          <StatusChip label="In progress" tone="primary" />
                        ) : (
                          <StatusChip label="Not started" />
                        )
                      }
                      progress={{
                        value: item.done,
                        total: item.total,
                        tone: finished ? "success" : "primary",
                        label: finished ? "Complete" : `${item.done} of ${item.total} steps done`,
                      }}
                      onPress={() => router.push(`/workflow/${item.id}`)}
                      accessibilityLabel={`${item.name}, ${
                        finished ? "complete" : `${item.done} of ${item.total} steps done`
                      }`}
                    />
                  );
                })}
              </CardGrid>
            )}
          </ScrollView>
        )}

        {/* Hidden while the empty state offers the same thing. */}
        {isLoading || workflows.length === 0 ? null : (
          <ActionRail
            actions={[
              {
                key: "new-workflow",
                icon: Plus,
                label: "New workflow",
                hint: "Start a workflow from a template",
                onPress: () => setPicking(true),
              },
            ]}
          />
        )}
      </View>
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Workflows"
        actions={[
          {
            label: "Manage templates",
            icon: LayoutTemplate,
            onPress: () => router.push("/templates"),
          },
          { label: "Refresh", icon: RefreshCw, onPress: () => void refetch() },
        ]}
      />
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
