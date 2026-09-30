import { useMemo, useState } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createBlankChecklist,
  deleteChecklist,
  listProjectChecklists,
  type ChecklistSummary,
} from "@/api/checklists";
import { checklistDeleteMessage } from "@/api/record-edit-rules";
import {
  applyChecklistTemplate,
  listChecklistTemplates,
  type TemplateSummary,
} from "@/api/templates";
import { getProjectContributors } from "@/api/task-comments";
import { memberLabel } from "@/api/task-mentions";
import { ActionRail } from "@/components/ActionRail";
import { ProjectSubPageHeader } from "@/components/ProjectSubPageHeader";
import { QueueBanner } from "@/components/QueueBanner";
import { TemplatePickerSheet } from "@/components/TemplatePickerSheet";
import { useAuth } from "@/lib/auth";
import { useRecordAuthoring } from "@/lib/use-access";
import { spacing, useTheme } from "@/theme";
import { ClipboardCheck, LayoutTemplate, ListPlus, Plus, RefreshCw, Trash2 } from "@/ui/icons";
import {
  ActionSheet,
  Avatar,
  CardGrid,
  ChipGroup,
  EmptyState,
  ErrorState,
  ItemCard,
  KebabButton,
  SkeletonList,
  StatusChip,
  Text,
  useCardPage,
  type ChipOption,
} from "@/ui";

type Filter = "all" | "mine" | "open";

export default function ProjectChecklistsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { inset } = useCardPage();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [rowMenu, setRowMenu] = useState<ChecklistSummary | null>(null);
  const { canAuthor } = useRecordAuthoring();

  /**
   * A blank checklist, as the web's "Blank checklist" makes one: a placeholder
   * name, then straight into Edit mode to rename it and type the items.
   */
  async function startBlank() {
    if (!id || !user?.id) return;
    try {
      const checklistId = await createBlankChecklist(id, user.id);
      await queryClient.invalidateQueries({ queryKey: ["project-checklists", id] });
      router.push(`/checklist/${checklistId}?edit=1`);
    } catch (e) {
      Alert.alert(
        "Could not create the checklist",
        e instanceof Error ? e.message : "Try again when you have signal.",
      );
    }
  }

  function confirmDelete(row: ChecklistSummary) {
    Alert.alert("Delete this checklist?", checklistDeleteMessage(row.name, row.total), [
      { text: "Keep", style: "cancel" },
      {
        text: "Delete checklist",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteChecklist(row.id);
            await queryClient.invalidateQueries({ queryKey: ["project-checklists", id] });
          } catch (e) {
            Alert.alert(
              "Could not delete the checklist",
              e instanceof Error ? e.message : "Try again when you have signal.",
            );
          }
        },
      },
    ]);
  }

  /**
   * Start a template on this project.
   *
   * Needs a connection, unlike everything else here: the checklist row has to
   * exist before its items can reference it. On success it opens the new
   * checklist rather than dropping the user back on the list to hunt for the
   * card that just appeared.
   */
  async function applyTemplate(template: TemplateSummary) {
    if (!id || !user?.id) return;
    setApplying(true);
    setApplyError(null);
    try {
      const checklistId = await applyChecklistTemplate(id, template, user.id);
      await queryClient.invalidateQueries({ queryKey: ["project-checklists", id] });
      setPicking(false);
      router.push(`/checklist/${checklistId}`);
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : "Could not start that checklist");
    } finally {
      setApplying(false);
    }
  }
  const [filter, setFilter] = useState<Filter>("open");

  const { data, isLoading, isRefetching, error, refetch } = useQuery({
    queryKey: ["project-checklists", id],
    queryFn: () => listProjectChecklists(id!),
    enabled: Boolean(id),
  });

  /*
   * Names for `assigned_to`, which is a bare user id on the row. Shown rather
   * than hidden because a checklist assigned to someone else is the single most
   * useful thing to know before starting one: two people working the same list
   * is how a job gets signed off twice and inspected once.
   */
  const membersQuery = useQuery({
    queryKey: ["project-contributors", id],
    queryFn: () => getProjectContributors(id!),
    enabled: Boolean(id),
    staleTime: 10 * 60 * 1000,
  });

  const nameById = useMemo(
    () => new Map((membersQuery.data ?? []).map((member) => [member.user_id, member])),
    [membersQuery.data],
  );

  const all = useMemo(() => data ?? [], [data]);

  const checklists = useMemo(() => {
    if (filter === "all") return all;
    if (filter === "mine") return all.filter((row) => row.assigned_to === user?.id);
    return all.filter((row) => row.total === 0 || row.done < row.total);
  }, [all, filter, user?.id]);

  /*
   * Counts are taken off the full list, so "Mine 2" keeps reading 2 while the
   * Unfinished filter is showing. Counting the filtered list gives every
   * unselected chip a zero, which reads as "there are none".
   */
  const filters: ChipOption<Filter>[] = [
    {
      id: "open",
      label: "Unfinished",
      count: all.filter((row) => row.total === 0 || row.done < row.total).length,
    },
    { id: "mine", label: "Mine", count: all.filter((row) => row.assigned_to === user?.id).length },
    { id: "all", label: "All", count: all.length },
  ];

  const totals = all.reduce(
    (acc, row) => ({ done: acc.done + row.done, total: acc.total + row.total }),
    { done: 0, total: 0 },
  );
  const finished = all.filter((row) => row.total > 0 && row.done === row.total).length;
  const summary =
    all.length === 0
      ? null
      : `${all.length} checklist${all.length === 1 ? "" : "s"} · ${finished} done · ${totals.done} of ${totals.total} items checked`;

  return (
    <>
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <ProjectSubPageHeader
          projectId={id}
          title="Checklists"
          summary={summary}
          progress={
            all.length > 0
              ? {
                  value: totals.done,
                  total: totals.total,
                  tone: totals.total > 0 && totals.done === totals.total ? "success" : "primary",
                }
              : null
          }
          actions={<KebabButton onPress={() => setMenuOpen(true)} />}
        >
          {all.length > 0 ? (
            <ChipGroup
              options={filters}
              value={filter}
              onChange={setFilter}
              label="Filter checklists"
            />
          ) : null}
        </ProjectSubPageHeader>
        <QueueBanner />

        {isLoading ? (
          <SkeletonList rows={5} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load checklists"}
            onRetry={() => void refetch()}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{
              paddingHorizontal: inset,
              paddingTop: spacing.lg,
              // Room for the floating New checklist button.
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
            {checklists.length === 0 ? (
              all.length === 0 ? (
                <EmptyState
                  icon={ClipboardCheck}
                  title="No checklists here"
                  body="Checklists are the checks this job has to pass. Start one from a template."
                  action={{ label: "Use a template", icon: Plus, onPress: () => setPicking(true) }}
                />
              ) : (
                <EmptyState
                  title="Nothing matches that filter"
                  body="Every checklist on this project is either finished or assigned to someone else."
                  action={{ label: "Show all", onPress: () => setFilter("all") }}
                />
              )
            ) : (
              <CardGrid>
                {checklists.map((item) => {
                  const complete = item.total > 0 && item.done === item.total;
                  const mine = item.assigned_to === user?.id;
                  const assignee = item.assigned_to ? nameById.get(item.assigned_to) : null;
                  const assigneeName = mine ? "You" : assignee ? memberLabel(assignee) : null;

                  return (
                    <ItemCard
                      key={item.id}
                      icon={ClipboardCheck}
                      iconTone={complete ? "success" : "primary"}
                      title={item.name}
                      meta={`${item.total} item${item.total === 1 ? "" : "s"}`}
                      status={
                        complete ? (
                          <StatusChip label="Done" tone="success" />
                        ) : item.done > 0 ? (
                          <StatusChip label="In progress" tone="primary" />
                        ) : (
                          <StatusChip label="Not started" />
                        )
                      }
                      progress={{
                        value: item.done,
                        total: item.total,
                        tone: complete ? "success" : "primary",
                      }}
                      onPress={() => router.push(`/checklist/${item.id}`)}
                      onMenu={canAuthor ? () => setRowMenu(item) : undefined}
                      menuLabel={`Actions for ${item.name}`}
                      accessibilityLabel={`${item.name}, ${item.done} of ${item.total} done${
                        assigneeName ? `, assigned to ${assigneeName}` : ""
                      }`}
                    >
                      {assigneeName ? (
                        <View
                          style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}
                        >
                          <Avatar name={assigneeName} size="sm" />
                          <Text variant="caption" tone={mine ? "primary" : "muted"}>
                            {mine ? "Assigned to you" : assigneeName}
                          </Text>
                        </View>
                      ) : null}
                    </ItemCard>
                  );
                })}
              </CardGrid>
            )}
          </ScrollView>
        )}

        {/* Hidden while the empty state offers the same thing. */}
        {isLoading || all.length === 0 ? null : (
          <ActionRail
            actions={[
              {
                key: "new-checklist",
                icon: Plus,
                label: "New checklist",
                hint: "Start a checklist from a template",
                onPress: () => setPicking(true),
              },
            ]}
          />
        )}
      </View>
      <ActionSheet
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        title="Checklists"
        actions={[
          ...(canAuthor
            ? [{ label: "Blank checklist", icon: ListPlus, onPress: () => void startBlank() }]
            : []),
          {
            label: "Manage templates",
            icon: LayoutTemplate,
            onPress: () => router.push("/templates"),
          },
          { label: "Refresh", icon: RefreshCw, onPress: () => void refetch() },
        ]}
      />
      <ActionSheet
        visible={rowMenu !== null}
        onClose={() => setRowMenu(null)}
        title={rowMenu?.name}
        actions={
          rowMenu
            ? [
                {
                  label: "Open",
                  icon: ClipboardCheck,
                  onPress: () => router.push(`/checklist/${rowMenu.id}`),
                },
                {
                  label: "Edit items",
                  icon: ListPlus,
                  disabled: Boolean(rowMenu.completed_at),
                  onPress: () => router.push(`/checklist/${rowMenu.id}?edit=1`),
                },
                {
                  label: "Delete checklist",
                  icon: Trash2,
                  destructive: true,
                  onPress: () => confirmDelete(rowMenu),
                },
              ]
            : []
        }
      />
      <TemplatePickerSheet
        visible={picking}
        onClose={() => setPicking(false)}
        title="Start a checklist"
        subtitle="From a workspace template"
        load={{ key: "checklist-templates", fetch: listChecklistTemplates }}
        applying={applying}
        error={applyError}
        onPick={(template) => void applyTemplate(template)}
      />
    </>
  );
}
