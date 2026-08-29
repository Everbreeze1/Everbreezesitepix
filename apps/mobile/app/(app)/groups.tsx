import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Image } from "expo-image";
import { Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createProjectGroup,
  deleteProjectGroup,
  getGroupProjectIds,
  listProjectGroups,
  setGroupProjects,
  updateProjectGroup,
  type ProjectGroup,
} from "@/api/project-groups";
import {
  covers,
  groupNameError,
  groupSummary,
  memberCount,
  orderedSelection,
  selectionChanged,
  toggled,
} from "@/api/group-view";
import { listProjects, type ProjectListItem } from "@/api/projects";
import { radius, spacing, useTheme } from "@/theme";
import { CircleCheck, FolderKanban, FolderPlus, Plus, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Project groups.
 *
 * A group is one person's own filing of jobs: "the Riverside contract", "last
 * winter's callbacks". Owner-scoped, not team-scoped, because the RLS policy is
 * `owner_id = auth.uid()` with no teammate clause. The copy here says "your"
 * rather than "the team's" for that reason: describing them as shared would be
 * describing something the data does not do.
 *
 * Membership is edited as a set and saved as a whole list, which is the shape
 * the `setGroupProjects` op offers and the right one for a phone: the picker
 * shows every project with a tick, and saving sends what the person can see
 * rather than a diff they never expressed.
 */
export default function GroupsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<ProjectGroup | "new" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [picking, setPicking] = useState<ProjectGroup | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const groupsQuery = useQuery({ queryKey: ["project-groups"], queryFn: listProjectGroups });
  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: listProjects });

  const groups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const projects = useMemo(
    () => (projectsQuery.data ?? []).filter((project) => !project.archived),
    [projectsQuery.data],
  );

  const run = useMutation({
    mutationFn: async (work: () => Promise<unknown>) => work(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["project-groups"] });
      void queryClient.invalidateQueries({ queryKey: ["project-group-members"] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not save."),
  });

  const save = useCallback(() => {
    const error = groupNameError(draftName);
    if (error) {
      setNameError(error);
      return;
    }
    const target = editing;
    const name = draftName.trim();
    const description = draftDescription.trim() || null;
    setEditing(null);

    if (target === "new") {
      run.mutate(() => createProjectGroup({ name, description, projectIds: [] }));
    } else if (target) {
      run.mutate(() => updateProjectGroup(target.id, { name, description }));
    }
  }, [editing, draftName, draftDescription, run]);

  const confirmDelete = useCallback(
    (group: ProjectGroup) => {
      Alert.alert(
        `Delete "${group.name}"?`,
        "The projects in it are untouched. Only the grouping goes.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => run.mutate(() => deleteProjectGroup(group.id)),
          },
        ],
      );
    },
    [run],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Groups" }} />

      <Screen
        scroll
        padded={false}
        refreshing={groupsQuery.isRefetching}
        onRefresh={() => void groupsQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        {groupsQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : groupsQuery.error ? (
          <ErrorState
            title="Could not load your groups"
            message={groupsQuery.error instanceof Error ? groupsQuery.error.message : undefined}
            onRetry={() => void groupsQuery.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {groups.length === 0 ? (
              <EmptyState
                icon={FolderPlus}
                title="No groups yet"
                body="A group is your own filing of jobs: one contract, one client, one season. It does not change anything on the projects themselves."
                action={{
                  label: "New group",
                  icon: Plus,
                  onPress: () => {
                    setDraftName("");
                    setDraftDescription("");
                    setNameError(null);
                    setEditing("new");
                  },
                }}
              />
            ) : (
              <>
                {groups.map((group) => {
                  const count = memberCount(group);
                  const thumbs = covers(group);
                  return (
                    <Card key={group.id}>
                      <View style={{ gap: spacing.md }}>
                        <View
                          style={{
                            flexDirection: "row",
                            alignItems: "flex-start",
                            gap: spacing.sm,
                          }}
                        >
                          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                            <Text variant="bodyStrong" numberOfLines={2}>
                              {group.name}
                            </Text>
                            <Text variant="caption" tone="muted">
                              {groupSummary(count)}
                            </Text>
                          </View>
                          <IconButton
                            icon={Trash2}
                            tone="destructive"
                            surface={false}
                            accessibilityLabel={`Delete ${group.name}`}
                            onPress={() => confirmDelete(group)}
                          />
                        </View>

                        {group.description ? (
                          <Text variant="caption" tone="muted" numberOfLines={3}>
                            {group.description}
                          </Text>
                        ) : null}

                        {/*
                          Covers the service already picked and signed: the
                          newest photo per project, capped at four. More than
                          four on a phone is a strip too small to recognise
                          anything in.
                        */}
                        {thumbs.length > 0 ? (
                          <View style={{ flexDirection: "row", gap: spacing.xs }}>
                            {thumbs.map((url) => (
                              <Image
                                key={url}
                                source={{ uri: url }}
                                style={{
                                  flex: 1,
                                  aspectRatio: 1,
                                  borderRadius: radius.sm,
                                  backgroundColor: theme.colors.secondary,
                                }}
                                contentFit="cover"
                              />
                            ))}
                          </View>
                        ) : null}

                        <View style={{ flexDirection: "row", gap: spacing.sm }}>
                          <Button
                            label="Projects"
                            icon={FolderKanban}
                            size="sm"
                            variant="secondary"
                            onPress={() => setPicking(group)}
                          />
                          <Button
                            label="Rename"
                            size="sm"
                            variant="ghost"
                            onPress={() => {
                              setDraftName(group.name);
                              setDraftDescription(group.description ?? "");
                              setNameError(null);
                              setEditing(group);
                            }}
                          />
                        </View>
                      </View>
                    </Card>
                  );
                })}

                <Button
                  label="New group"
                  icon={Plus}
                  variant="secondary"
                  fullWidth
                  onPress={() => {
                    setDraftName("");
                    setDraftDescription("");
                    setNameError(null);
                    setEditing("new");
                  }}
                />
              </>
            )}
          </View>
        )}
      </Screen>

      <Sheet
        visible={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "New group" : "Rename group"}
      >
        <View style={{ gap: spacing.lg }}>
          <Field
            label="Name"
            value={draftName}
            onChangeText={(next) => {
              setDraftName(next);
              if (nameError) setNameError(null);
            }}
            placeholder="Riverside contract"
            error={nameError ?? undefined}
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={save}
          />
          <Field
            label="Description"
            value={draftDescription}
            onChangeText={setDraftDescription}
            placeholder="What this group is for"
            hint="Optional"
            multiline
            rows={2}
          />
          <Button label="Save" fullWidth onPress={save} />
        </View>
      </Sheet>

      <ProjectPicker
        group={picking}
        projects={projects}
        loading={projectsQuery.isLoading}
        onClose={() => setPicking(null)}
        onSave={(groupId, ids) => {
          setPicking(null);
          run.mutate(() => setGroupProjects(groupId, ids));
        }}
      />
    </>
  );
}

/**
 * Choosing which projects are in a group.
 *
 * Saving is disabled until something actually changes, comparing as a set
 * rather than as an array: the picker builds its list in the project list's
 * order and the server returns membership in insertion order, so a direct
 * comparison would report a change every time it opened and rewrite every
 * membership row for somebody who only scrolled.
 */
function ProjectPicker({
  group,
  projects,
  loading,
  onClose,
  onSave,
}: {
  group: ProjectGroup | null;
  projects: ProjectListItem[];
  loading: boolean;
  onClose: () => void;
  onSave: (groupId: string, projectIds: string[]) => void;
}) {
  /*
   * The membership comes from `getProjectGroup`, not from the row this sheet
   * was handed.
   *
   * `listProjectGroups` returns a `project_count` and no ids at all, so seeding
   * from the list row opened every picker empty: a group with four projects in
   * it offered four unticked rows, and saving would have removed all four.
   */
  const membersQuery = useQuery({
    queryKey: ["project-group-members", group?.id],
    queryFn: () => getGroupProjectIds(group!.id),
    enabled: Boolean(group),
  });
  const stored = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  /*
   * Re-seed when the membership arrives, and when a different group is opened.
   * Keyed on the group plus the stored list so a slow fetch still seeds once it
   * lands rather than leaving the sheet permanently empty.
   */
  const [seenFor, setSeenFor] = useState<string | null>(null);
  const seedKey = group ? `${group.id}:${stored.join(",")}` : null;
  if (seedKey && seenFor !== seedKey) {
    setSeenFor(seedKey);
    setSelected(new Set(stored));
  }

  const changed = selectionChanged(stored, selected);

  return (
    <Sheet
      visible={group !== null}
      onClose={onClose}
      title={group ? `Projects in ${group.name}` : undefined}
      subtitle={`${selected.size} chosen`}
      footer={
        <Button
          label={membersQuery.isLoading ? "Loading" : changed ? "Save" : "Nothing changed"}
          fullWidth
          disabled={!changed || membersQuery.isLoading}
          onPress={() => group && onSave(group.id, orderedSelection(projects, selected))}
        />
      }
    >
      {loading || membersQuery.isLoading ? (
        <SkeletonList rows={4} />
      ) : projects.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects to add yet" />
      ) : (
        <ListGroup>
          {projects.map((project, index) => {
            const on = selected.has(project.id);
            return (
              <View key={project.id}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  icon={on ? CircleCheck : FolderKanban}
                  iconTone={on ? "success" : "muted"}
                  title={project.name}
                  subtitle={project.client_name ?? project.city ?? undefined}
                  right={on ? <Badge label="In" tone="success" /> : undefined}
                  onPress={() => setSelected((current) => toggled(current, project.id))}
                />
              </View>
            );
          })}
        </ListGroup>
      )}
    </Sheet>
  );
}
