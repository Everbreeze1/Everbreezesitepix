import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { router, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listProjectBoards,
  listStagedProjects,
  setProjectStage,
  type ProjectBoard,
  type StagedProject,
} from "@/api/pipelines";
import {
  boardSummary,
  emptyStageBody,
  orderedStages,
  projectsInStage,
  readableOn,
  stageCounts,
  unstaged,
} from "@/api/pipeline-view";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { FolderKanban, FolderInput, Plus } from "@/ui/icons";
import {
  ActionSheet,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  SkeletonList,
  Text,
  type SheetAction,
} from "@/ui";

/**
 * Pipelines.
 *
 * **A kanban board on a six inch screen is a column picker plus a list.** Not a
 * board: horizontally scrolling columns on a phone show one and a half of them,
 * hide the rest behind a gesture nobody knows is there, and fight the vertical
 * scroll inside each. So the stages are a row of pills across the top, and the
 * jobs in the chosen one are an ordinary list underneath.
 *
 * Moving a job is a sheet rather than a drag, for the same reason the template
 * editor uses arrows: drag on a touch screen needs a long press to disambiguate
 * from scrolling, and the target here is off screen anyway.
 *
 * A stage is exclusive, and this screen must never suggest otherwise. That is
 * the whole point of `20260917000000_pipeline_stages.sql`: the old boards made
 * a column a tag, tags are many-per-project, and a job could stand in three
 * columns at once. `projectsInStage` matches one id, and jobs with no stage are
 * a separate list rather than a first column.
 */
export default function PipelinesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [boardId, setBoardId] = useState<string | null>(null);
  const [stageId, setStageId] = useState<string | null>(null);
  const [moving, setMoving] = useState<StagedProject | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const boardsQuery = useQuery({ queryKey: ["project-boards"], queryFn: listProjectBoards });
  const projectsQuery = useQuery({
    queryKey: ["staged-projects"],
    queryFn: listStagedProjects,
  });

  const boards = useMemo(() => boardsQuery.data ?? [], [boardsQuery.data]);
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);

  const board: ProjectBoard | null =
    boards.find((candidate) => candidate.id === boardId) ?? boards[0] ?? null;
  const stages = useMemo(() => (board ? orderedStages(board) : []), [board]);
  const counts = useMemo(() => stageCounts(projects, stages), [projects, stages]);

  /*
   * Default to the first stage whenever the chosen one is not on this board.
   *
   * Covers three cases with one rule: nothing chosen yet, a board switch, and a
   * stage deleted underneath somebody. Without it the list silently shows
   * nothing and looks like an empty pipeline.
   */
  useEffect(() => {
    if (stages.length === 0) return;
    if (!stageId || !stages.some((stage) => stage.id === stageId)) {
      setStageId(stages[0].id);
    }
  }, [stages, stageId]);

  const stage = stages.find((candidate) => candidate.id === stageId) ?? null;
  const inStage = stage ? projectsInStage(projects, stage.id) : [];
  const notOnBoard = useMemo(() => unstaged(projects), [projects]);

  const move = useMutation({
    mutationFn: (args: { projectId: string; stageId: string | null }) =>
      setProjectStage(args.projectId, args.stageId),
    onSuccess: () => {
      /*
       * Refetched, not patched. Moving a job also changes its `status`, because
       * the stage owns which of the three buckets it counts as, and guessing
       * that here would put a second copy of a server rule on the phone.
       */
      void queryClient.invalidateQueries({ queryKey: ["staged-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not move that job."),
  });

  const moveActions = useCallback(
    (project: StagedProject): SheetAction[] => {
      const actions: SheetAction[] = stages
        .filter((candidate) => candidate.id !== project.pipeline_stage_id)
        .map((candidate) => ({
          label: candidate.name,
          onPress: () => move.mutate({ projectId: project.id, stageId: candidate.id }),
        }));

      if (project.pipeline_stage_id) {
        actions.push({
          label: "Take off this pipeline",
          destructive: true,
          onPress: () => move.mutate({ projectId: project.id, stageId: null }),
        });
      }
      return actions;
    },
    [stages, move],
  );

  if (boardsQuery.isLoading || projectsQuery.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Pipelines" }} />
        <SkeletonList rows={6} />
      </>
    );
  }

  if (boardsQuery.error) {
    return (
      <>
        <Stack.Screen options={{ title: "Pipelines" }} />
        <ErrorState
          title="Could not load your pipelines"
          message={boardsQuery.error instanceof Error ? boardsQuery.error.message : undefined}
          onRetry={() => void boardsQuery.refetch()}
        />
      </>
    );
  }

  if (boards.length === 0) {
    return (
      <>
        <Stack.Screen options={{ title: "Pipelines" }} />
        <EmptyState
          icon={FolderKanban}
          title="No pipelines yet"
          body="A pipeline tracks a job through the stages your business actually has: quoted, scheduled, on site, invoiced. Create one on the web and it appears here."
        />
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: board?.name ?? "Pipelines" }} />

      <Screen
        scroll
        padded={false}
        refreshing={projectsQuery.isRefetching}
        onRefresh={() => {
          void boardsQuery.refetch();
          void projectsQuery.refetch();
        }}
        bottomInset={spacing.xxl}
      >
        {/*
          The board picker only appears when there is more than one. A single
          control with a single option is a control that teaches nothing and
          takes a row of screen.
        */}
        {boards.length > 1 ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
            <ListGroup>
              {boards.map((candidate, index) => (
                <View key={candidate.id}>
                  {index > 0 ? <RowDivider inset={false} /> : null}
                  <ListRow
                    title={candidate.name}
                    subtitle={boardSummary(
                      candidate.stages?.length ?? 0,
                      projects.filter((project) =>
                        (candidate.stages ?? []).some((s) => s.id === project.pipeline_stage_id),
                      ).length,
                    )}
                    value={candidate.id === board?.id ? "Showing" : undefined}
                    onPress={() => {
                      setBoardId(candidate.id);
                      setStageId(null);
                    }}
                  />
                </View>
              ))}
            </ListGroup>
          </View>
        ) : null}

        {/*
          The stages, as a horizontally scrolling row of pills. This is the one
          place a horizontal scroll is right: the pills are small, there are
          rarely more than six, and the selected one is always brought into view
          because it is what the list below is showing.
        */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: spacing.lg,
            paddingTop: spacing.lg,
            gap: spacing.sm,
          }}
        >
          {stages.map((candidate) => {
            const on = candidate.id === stage?.id;
            return (
              <Pressable
                key={candidate.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${candidate.name}, ${counts.get(candidate.id) ?? 0} jobs`}
                onPress={() => setStageId(candidate.id)}
                style={{
                  borderRadius: radius.pill,
                  paddingHorizontal: spacing.md,
                  // Tall enough to hit with gloves on, which is the floor
                  // everything tappable in this app is held to.
                  minHeight: HIT_TARGET,
                  justifyContent: "center",
                  // The stage's own colour when selected, so the pill row is
                  // the legend for the board rather than a second colour
                  // scheme to learn.
                  backgroundColor: on ? candidate.color : theme.colors.secondary,
                }}
              >
                <Text
                  variant="caption"
                  // Computed from the stage colour, because stage colours run
                  // from near-black to amber and a fixed foreground is
                  // unreadable against half of them.
                  style={{ color: on ? readableOn(candidate.color) : theme.colors.foreground }}
                >
                  {candidate.name} {counts.get(candidate.id) ?? 0}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {failure ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          </View>
        ) : null}

        <SectionHeader title={stage ? `${stage.name} (${inStage.length})` : "Stages"} />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
          {stages.length === 0 ? (
            <Text variant="caption" tone="muted">
              This pipeline has no stages yet. Add them on the web and they appear here.
            </Text>
          ) : inStage.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="Nothing here"
              body={emptyStageBody(stage?.name ?? "this stage")}
            />
          ) : (
            <ListGroup>
              {inStage.map((project, index) => (
                <View key={project.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <ListRow
                    icon={FolderKanban}
                    title={project.name}
                    subtitle={project.client_name ?? project.city ?? undefined}
                    right={
                      <Badge
                        label="Move"
                        tone="neutral"
                        variant="outline"
                        icon={FolderInput}
                        style={{ opacity: move.isPending ? 0.5 : 1 }}
                      />
                    }
                    // The row moves the job. Opening the project is a longer
                    // journey and is one tap away from the project list; what
                    // somebody is on this screen to do is move things.
                    onPress={() => setMoving(project)}
                    accessibilityHint="Choose a different stage for this job"
                  />
                </View>
              ))}
            </ListGroup>
          )}

          {notOnBoard.length > 0 ? (
            <>
              <SectionHeader title={`Not on a pipeline (${notOnBoard.length})`} />
              {/*
                A separate list, never a first column. A job with no stage is
                not a job at the start of the pipeline, and folding the two
                together would pull every job in the workspace onto whichever
                board somebody happened to open.
              */}
              <ListGroup>
                {notOnBoard.slice(0, 10).map((project, index) => (
                  <View key={project.id}>
                    {index > 0 ? <RowDivider /> : null}
                    <ListRow
                      icon={FolderKanban}
                      iconTone="muted"
                      title={project.name}
                      subtitle={project.client_name ?? project.city ?? undefined}
                      right={<Badge label="Add" tone="primary" variant="outline" icon={Plus} />}
                      onPress={() => setMoving(project)}
                    />
                  </View>
                ))}
              </ListGroup>
              {notOnBoard.length > 10 ? (
                <Button
                  label="All projects"
                  variant="ghost"
                  fullWidth
                  onPress={() => router.push("/projects")}
                />
              ) : null}
            </>
          ) : null}
        </View>
      </Screen>

      <ActionSheet
        visible={moving !== null}
        onClose={() => setMoving(null)}
        title={moving ? `Move ${moving.name}` : undefined}
        actions={moving ? moveActions(moving) : []}
      />
    </>
  );
}
