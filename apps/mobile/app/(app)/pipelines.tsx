import { useCallback, useMemo, useState } from "react";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listProjectBoards,
  listStagedProjects,
  setProjectStage,
  type ProjectBoard,
  type StagedProject,
} from "@/api/pipelines";
import {
  boardColumnWidth,
  boardSummary,
  emptyStageBody,
  nextStage,
  orderedStages,
  projectsInStage,
  stageCounts,
  unstaged,
  withStage,
  type PipelineStage,
} from "@/api/pipeline-view";
import { listProjectCardExtras } from "@/api/project-cards";
import { BoardCard, BoardColumn } from "@/components/PipelineBoard";
import { useProjectCrews } from "@/components/ProjectCrewAvatars";
import { spacing, useTheme } from "@/theme";
import { CircleCheck, FolderInput, FolderKanban, X } from "@/ui/icons";
import {
  ActionSheet,
  Chip,
  EmptyState,
  ErrorState,
  SearchField,
  SkeletonList,
  Text,
  type SheetAction,
} from "@/ui";

/**
 * Pipelines, as the web draws them: a board.
 *
 * One column per stage with the stage's colour along its top and a count,
 * cards with the job's newest photo, address, crew and last activity, and the
 * columns scrolling sideways. On a phone a column is most of the screen wide
 * and snaps into place, so one stage reads at a time and the edge of the next
 * says there is more.
 *
 * The web's drag becomes two things on a touch screen. The advance arrow on a
 * card moves it on to the next stage in one tap, which is the move somebody
 * makes nine times out of ten. The kebab (or a long press) opens the move menu,
 * which reaches any stage, including one scrolled off screen. A drag would need
 * a long press to tell it from a scroll and a target that is usually not in
 * view.
 *
 * A stage is exclusive, and this screen must never suggest otherwise. That is
 * the whole point of `20260917000000_pipeline_stages.sql`: the old boards made
 * a column a tag, tags are many-per-project, and a job could stand in three
 * columns at once. `projectsInStage` matches one id, and jobs with no stage sit
 * in their own "Not in a pipeline" column at the end, never in the first stage.
 */
export default function PipelinesScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [boardId, setBoardId] = useState<string | null>(null);
  const [moving, setMoving] = useState<StagedProject | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [boardHeight, setBoardHeight] = useState(0);

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
  const notOnBoard = useMemo(() => unstaged(projects), [projects]);
  const placed = useMemo(
    () => Array.from(counts.values()).reduce((sum, n) => sum + n, 0),
    [counts],
  );

  const q = search.trim().toLowerCase();
  const matches = useCallback(
    (project: StagedProject) =>
      !q ||
      [project.name, project.client_name, project.location, project.street, project.city]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    [q],
  );

  /*
   * Photos and crews for the cards on this board, in one request each. The
   * jobs not on a pipeline are included because they have a column too, but
   * capped: a workspace with hundreds of unstaged jobs should not pay for
   * pictures of all of them to draw one board.
   */
  const cardIds = useMemo(() => {
    const onBoard = projects.filter((project) => counts.has(project.pipeline_stage_id ?? ""));
    return [...onBoard, ...notOnBoard.slice(0, 40)].slice(0, 200).map((project) => project.id);
  }, [projects, counts, notOnBoard]);
  const extrasQuery = useQuery({
    queryKey: ["pipeline-card-extras", cardIds.join(",")],
    queryFn: () => listProjectCardExtras(cardIds),
    enabled: cardIds.length > 0,
    staleTime: 10 * 60 * 1000,
  });
  const crews = useProjectCrews(cardIds);

  const move = useMutation({
    mutationFn: (args: { projectId: string; stageId: string | null }) =>
      setProjectStage(args.projectId, args.stageId),
    onMutate: async ({ projectId, stageId }) => {
      await queryClient.cancelQueries({ queryKey: ["staged-projects"] });
      const before = queryClient.getQueryData<StagedProject[]>(["staged-projects"]);
      if (before) {
        queryClient.setQueryData(["staged-projects"], withStage(before, projectId, stageId));
      }
      return { before };
    },
    onSuccess: () => setFailure(null),
    onError: (error: unknown, _args, context) => {
      if (context?.before) queryClient.setQueryData(["staged-projects"], context.before);
      setFailure(error instanceof Error ? error.message : "Could not move that job.");
    },
    onSettled: () => {
      /*
       * Refetched after the optimistic move. Moving a job also changes its
       * `status`, because the stage owns which of the three buckets it counts
       * as, and guessing that here would put a second copy of a server rule
       * on the phone.
       */
      void queryClient.invalidateQueries({ queryKey: ["staged-projects"] });
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const moveActions = useCallback(
    (project: StagedProject): SheetAction[] => {
      const onBoard = counts.has(project.pipeline_stage_id ?? "");
      const actions: SheetAction[] = stages.map((candidate) => ({
        label:
          candidate.id === project.pipeline_stage_id
            ? `${candidate.name} (here now)`
            : onBoard
              ? `Move to ${candidate.name}`
              : `Add to ${candidate.name}`,
        icon: candidate.id === project.pipeline_stage_id ? CircleCheck : FolderInput,
        disabled: candidate.id === project.pipeline_stage_id,
        onPress: () => move.mutate({ projectId: project.id, stageId: candidate.id }),
      }));
      if (project.pipeline_stage_id) {
        actions.push({
          label: "Take off this pipeline",
          icon: X,
          destructive: true,
          onPress: () => move.mutate({ projectId: project.id, stageId: null }),
        });
      }
      actions.push({
        label: "Open project",
        icon: FolderKanban,
        onPress: () => router.push({ pathname: "/project/[id]", params: { id: project.id } }),
      });
      return actions;
    },
    [stages, counts, move],
  );

  const refreshing = projectsQuery.isRefetching || boardsQuery.isRefetching;
  const refresh = () => {
    void boardsQuery.refetch();
    void projectsQuery.refetch();
    void extrasQuery.refetch();
  };

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

  const columnWidth = boardColumnWidth(width);
  const columnGap = spacing.md;
  /*
   * The columns fill the board's height. The floor used to be 240pt, which on
   * a phone held on its side (about 180pt of board under the search and the
   * summary) pushed the bottom of every column off the screen where it could
   * not be scrolled to. 160 still shows two cards.
   */
  const columnHeight = Math.max(
    160,
    boardHeight - spacing.md - Math.max(insets.bottom, spacing.md),
  );

  /*
   * Every job in the workspace can be off the pipeline, so this column is
   * capped rather than drawing hundreds of cards nobody scrolls through.
   * Search reaches the rest.
   */
  const unstagedMatching = notOnBoard.filter(matches);
  const unstagedShown = unstagedMatching.slice(0, 40);
  const unstagedHidden = unstagedMatching.length - unstagedShown.length;

  const card = (project: StagedProject, stage: PipelineStage | null) => {
    const extras = extrasQuery.data?.[project.id];
    const next = stage ? nextStage(stages, stage.id) : (stages[0] ?? null);
    return (
      <BoardCard
        key={project.id}
        project={project}
        color={stage?.color}
        thumb={extras?.urls[0] ?? null}
        latestPhotoAt={extras?.latestAt ?? null}
        crew={crews[project.id]}
        next={next}
        busy={move.isPending && move.variables?.projectId === project.id}
        onOpen={() => router.push({ pathname: "/project/[id]", params: { id: project.id } })}
        onMenu={() => setMoving(project)}
        onAdvance={() => {
          if (next) move.mutate({ projectId: project.id, stageId: next.id });
        }}
      />
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: board?.name ?? "Pipelines" }} />

      <View
        style={{
          flex: 1,
          // Clear of the notch of a phone on its side; zero upright.
          paddingLeft: insets.left,
          paddingRight: insets.right,
          backgroundColor: theme.colors.background,
        }}
      >
        <View style={{ paddingTop: spacing.md, gap: spacing.sm }}>
          {/*
            The board picker only appears when there is more than one. A single
            control with a single option teaches nothing and costs a row.
          */}
          {boards.length > 1 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}
            >
              {boards.map((candidate) => (
                <Chip
                  key={candidate.id}
                  label={candidate.name}
                  selected={candidate.id === board?.id}
                  onPress={() => setBoardId(candidate.id)}
                />
              ))}
            </ScrollView>
          ) : null}

          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Find a job on this board"
            accessibilityLabel="Search this pipeline"
          />

          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.xs }}>
            <Text variant="caption" tone="muted">
              {boardSummary(stages.length, placed)}
              {stages.length > 0 ? ". Tap the arrow on a card to move it to the next stage." : ""}
            </Text>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}
          </View>
        </View>

        <View
          style={{ flex: 1 }}
          onLayout={(event) => setBoardHeight(event.nativeEvent.layout.height)}
        >
          {stages.length === 0 ? (
            <EmptyState
              icon={FolderKanban}
              title="This pipeline has no stages yet"
              body="Add stages on the web and they appear here."
            />
          ) : boardHeight > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={columnWidth + columnGap}
              snapToAlignment="start"
              decelerationRate="fast"
              contentContainerStyle={{
                paddingHorizontal: spacing.lg,
                paddingTop: spacing.md,
                gap: columnGap,
              }}
            >
              {stages.map((stage) => {
                const inStage = projectsInStage(projects, stage.id).filter(matches);
                return (
                  <BoardColumn
                    key={stage.id}
                    stage={stage}
                    title={stage.name}
                    count={counts.get(stage.id) ?? 0}
                    width={columnWidth}
                    height={columnHeight}
                    empty={
                      q && (counts.get(stage.id) ?? 0) > 0
                        ? "Nothing here matches your search."
                        : emptyStageBody(stage.name)
                    }
                    isEmpty={inStage.length === 0}
                    refreshing={refreshing}
                    onRefresh={refresh}
                  >
                    {inStage.map((project) => card(project, stage))}
                  </BoardColumn>
                );
              })}

              {/*
                Its own column at the end, never folded into the first stage. A
                job with no stage is not a job at the start of the pipeline.
              */}
              {notOnBoard.length > 0 ? (
                <BoardColumn
                  stage={null}
                  title="Not in a pipeline"
                  count={notOnBoard.length}
                  width={columnWidth}
                  height={columnHeight}
                  empty="Nothing here matches your search."
                  isEmpty={unstagedShown.length === 0}
                  refreshing={refreshing}
                  onRefresh={refresh}
                >
                  {unstagedShown.map((project) => card(project, null))}
                  {unstagedHidden > 0 ? (
                    <Text key="more" variant="caption" tone="muted" align="center">
                      {`And ${unstagedHidden} more. Search to find one.`}
                    </Text>
                  ) : null}
                </BoardColumn>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </View>

      <ActionSheet
        visible={moving !== null}
        onClose={() => setMoving(null)}
        title={moving ? moving.name : undefined}
        actions={moving ? moveActions(moving) : []}
      />
    </>
  );
}
