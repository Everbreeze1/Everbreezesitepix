import { useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listProjectChecklists } from "@/api/checklists";
import {
  applyChecklistTemplate,
  listChecklistTemplates,
  type TemplateSummary,
} from "@/api/templates";
import { getProjectContributors } from "@/api/task-comments";
import { memberLabel } from "@/api/task-mentions";
import { QueueBanner } from "@/components/QueueBanner";
import { TemplatePickerSheet } from "@/components/TemplatePickerSheet";
import { useAuth } from "@/lib/auth";
import { spacing, useTheme } from "@/theme";
import { ClipboardCheck, Plus } from "@/ui/icons";
import {
  Avatar,
  Badge,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  IconButton,
  ProgressBar,
  SkeletonList,
  Text,
  type ChipOption,
} from "@/ui";

type Filter = "all" | "mine" | "open";

export default function ProjectChecklistsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

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

  return (
    <>
      <Stack.Screen
        options={{
          title: "Checklists",
          headerRight: () => (
            <IconButton
              icon={Plus}
              accessibilityLabel="Start a checklist from a template"
              surface={false}
              tone="primary"
              onPress={() => setPicking(true)}
            />
          ),
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <QueueBanner />

        <View style={{ paddingVertical: spacing.sm }}>
          <ChipGroup
            options={filters}
            value={filter}
            onChange={setFilter}
            label="Filter checklists"
          />
        </View>

        {isLoading ? (
          <SkeletonList rows={5} />
        ) : error ? (
          <ErrorState
            message={error instanceof Error ? error.message : "Failed to load checklists"}
            onRetry={() => void refetch()}
          />
        ) : (
          <FlatList
            data={checklists}
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
            }
            renderItem={({ item }) => {
              const complete = item.total > 0 && item.done === item.total;
              const mine = item.assigned_to === user?.id;
              const assignee = item.assigned_to ? nameById.get(item.assigned_to) : null;
              const assigneeName = mine ? "You" : assignee ? memberLabel(assignee) : null;

              return (
                <Card
                  onPress={() => router.push(`/checklist/${item.id}`)}
                  accessibilityLabel={`${item.name}, ${item.done} of ${item.total} done${
                    assigneeName ? `, assigned to ${assigneeName}` : ""
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
                    {complete ? <Badge label="Done" tone="success" /> : null}
                  </View>

                  {assigneeName ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: spacing.sm,
                        marginBottom: spacing.md,
                      }}
                    >
                      <Avatar name={assigneeName} size="sm" />
                      <Text variant="caption" tone={mine ? "primary" : "muted"}>
                        {mine ? "Assigned to you" : assigneeName}
                      </Text>
                    </View>
                  ) : null}

                  <ProgressBar
                    value={item.done}
                    total={item.total}
                    tone={complete ? "success" : "primary"}
                    showLabel
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
