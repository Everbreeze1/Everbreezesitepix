import { useCallback } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { getProjectWorkflowStrip } from "@/api/workflow-strip";
import { currentPhaseIndex, phaseDone, runIsStaged } from "@/api/workflow-state";
import { spacing, useTheme } from "@/theme";
import { Text } from "@/ui";

/**
 * "Workflow · <name>" under the project header: one dot per phase, joined by a
 * line, so where the job stands reads at a glance.
 *
 * The phone version of the web `ProjectWorkflowStrip`. Complete phases are
 * filled, the current one is ringed, the rest are hollow. Tapping it opens the
 * project's Workflows screen, where the phases are worked through. With no
 * workflow on the job it draws a quiet "none started" line rather than
 * nothing, so the feature never looks missing; a failed read draws nothing,
 * because a header strip is never worth an error state.
 */
export function ProjectWorkflowStrip({
  projectId,
  onOpen,
}: {
  projectId: string;
  onOpen: () => void;
}) {
  const theme = useTheme();
  const query = useQuery({
    queryKey: ["project-workflow-strip", projectId],
    queryFn: () => getProjectWorkflowStrip(projectId),
    staleTime: 30_000,
  });

  // Coming back from the Workflows screen is the moment a phase may have moved.
  const { refetch } = query;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  if (query.isLoading || query.error) return null;

  const workflow = query.data;
  const container = {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: theme.colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    gap: spacing.sm,
  } as const;

  if (!workflow || workflow.phases.length === 0) {
    return (
      <View style={container}>
        <Text variant="overline" tone="muted">
          WORKFLOW · NONE STARTED
        </Text>
        <Pressable accessibilityRole="button" onPress={onOpen} hitSlop={8}>
          <Text variant="caption" tone="primary" style={{ fontWeight: "700" }}>
            Start a workflow from a template
          </Text>
        </Pressable>
      </View>
    );
  }

  const entries = workflow.phases.map((phase) => ({ phase, items: phase.items }));
  const doneAll = Boolean(workflow.completed_at);
  // A stage counts as done once it is marked done, the same as the runner.
  const staged = runIsStaged(workflow);
  const activeIndex = doneAll ? -1 : currentPhaseIndex(entries, staged);
  const done = theme.colors.success;

  return (
    <View style={container}>
      <Text variant="overline" tone="muted" numberOfLines={1}>
        {`WORKFLOW · ${workflow.name.toUpperCase()}`}
      </Text>
      {/*
        Scrolls sideways for a long run of phases. The row inside is one
        button, so a tap anywhere on the dots opens the workflow while a drag
        still scrolls.
      */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open workflow ${workflow.name}`}
          onPress={onOpen}
          style={({ pressed }) => ({
            flexDirection: "row",
            flexGrow: 1,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          {entries.map(({ phase, items }, index) => {
            const complete = doneAll || phaseDone(phase, items, staged);
            const active = index === activeIndex;
            const last = index === entries.length - 1;
            return (
              <View key={phase.id} style={{ minWidth: 84, flex: 1, alignItems: "center" }}>
                {!last ? (
                  <View
                    style={{
                      position: "absolute",
                      top: 6,
                      left: "50%",
                      width: "100%",
                      height: 2,
                      backgroundColor: complete ? done : theme.colors.border,
                    }}
                  />
                ) : null}
                <View
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 7,
                    borderWidth: 2,
                    borderColor: complete || active ? done : theme.colors.border,
                    backgroundColor: complete ? done : theme.colors.card,
                  }}
                />
                <Text
                  variant="caption"
                  tone={complete || active ? "default" : "muted"}
                  numberOfLines={2}
                  align="center"
                  style={{ marginTop: spacing.xs, paddingHorizontal: 2, fontWeight: "600" }}
                >
                  {phase.name}
                </Text>
              </View>
            );
          })}
        </Pressable>
      </ScrollView>
    </View>
  );
}
