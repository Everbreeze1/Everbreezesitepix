import { useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addProjectToGroup,
  combineProjects,
  listMergeTargets,
  listProjectGroupMemberships,
  mergeTargetAddress,
  searchMergeTargets,
} from "@/api/project-actions";
import { listProjectGroups } from "@/api/project-groups";
import { spacing } from "@/theme";
import { Check, FolderPlus, Workflow } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ListGroup,
  ListRow,
  RowDivider,
  SearchField,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * File this job under a group, the web menu's "File under a group".
 *
 * A group the job is already in shows ticked and does nothing, as on the web:
 * removing a job from a group is done from the group itself, where the rest of
 * its members are in view.
 */
export function ProjectGroupSheet({
  visible,
  projectId,
  onClose,
}: {
  visible: boolean;
  projectId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const groups = useQuery({
    queryKey: ["project-groups"],
    queryFn: listProjectGroups,
    enabled: visible,
  });
  const memberships = useQuery({
    queryKey: ["project-group-memberships", projectId],
    queryFn: () => listProjectGroupMemberships(projectId),
    enabled: visible,
  });
  const member = new Set(memberships.data ?? []);

  const add = useMutation({
    mutationFn: (groupId: string) => addProjectToGroup(groupId, projectId),
    onSuccess: () => {
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: ["project-group-memberships", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-groups"] });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not add it to that group."),
  });

  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return (groups.data ?? []).filter((group) => {
      const haystack = `${group.name} ${group.description ?? ""}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });
  }, [groups.data, search]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="File under a group"
      subtitle="Groups gather related jobs, like one customer's properties."
    >
      {failure ? (
        <Text variant="caption" tone="destructive">
          {failure}
        </Text>
      ) : null}
      {(groups.data ?? []).length > 6 ? (
        <View style={{ marginHorizontal: -spacing.lg }}>
          <SearchField
            value={search}
            onChangeText={setSearch}
            placeholder="Search groups"
            accessibilityLabel="Search groups"
          />
        </View>
      ) : null}
      {groups.isLoading || memberships.isLoading ? (
        <SkeletonList rows={3} />
      ) : groups.error ? (
        <Text variant="body" tone="muted">
          {groups.error instanceof Error ? groups.error.message : "Could not load your groups."}
        </Text>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title={search ? "Nothing matches" : "No groups yet"}
          body={search ? "Try a different word." : "Create one from Groups, then file jobs in it."}
        />
      ) : (
        <ListGroup>
          {shown.map((group, index) => {
            const inIt = member.has(group.id);
            const adding = add.isPending && add.variables === group.id;
            return (
              <View key={group.id}>
                {index > 0 ? <RowDivider /> : null}
                <ListRow
                  title={group.name}
                  subtitle={group.description ?? undefined}
                  disabled={inIt || add.isPending}
                  right={
                    inIt ? (
                      <Badge label="Added" tone="success" icon={Check} variant="soft" />
                    ) : adding ? (
                      <Badge label="Adding" tone="neutral" variant="outline" />
                    ) : undefined
                  }
                  onPress={inIt ? undefined : () => add.mutate(group.id)}
                />
              </View>
            );
          })}
        </ListGroup>
      )}
    </Sheet>
  );
}

/**
 * Merge this job into another, the web menu's "Merge into another project".
 *
 * Pick the job that survives, confirm, and everything here moves across:
 * photos, videos, tasks, documents, checklists, workflows and walkthroughs.
 * This job is then removed, so the confirmation says so plainly and the
 * screen leaves for the job everything went to.
 */
export function ProjectMergeSheet({
  visible,
  projectId,
  projectName,
  onClose,
  onMerged,
}: {
  visible: boolean;
  projectId: string;
  projectName: string;
  onClose: () => void;
  onMerged: (targetId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [failure, setFailure] = useState<string | null>(null);

  const targets = useQuery({
    queryKey: ["merge-targets", projectId],
    queryFn: () => listMergeTargets(projectId),
    enabled: visible,
  });

  const merge = useMutation({
    mutationFn: (targetId: string) => combineProjects(projectId, targetId),
    onSuccess: (targetId) => {
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project", targetId] });
      void queryClient.invalidateQueries({ queryKey: ["project-photos", targetId] });
      onMerged(targetId);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not merge these projects."),
  });

  const shown = useMemo(
    () => searchMergeTargets(targets.data ?? [], search),
    [targets.data, search],
  );

  const confirm = (targetId: string, targetName: string) =>
    Alert.alert(
      `Merge into "${targetName}"?`,
      `Every photo, video, task, document, checklist, workflow and walkthrough on "${projectName}" moves to "${targetName}", and "${projectName}" is removed. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Merge", style: "destructive", onPress: () => merge.mutate(targetId) },
      ],
    );

  return (
    <Sheet
      visible={visible}
      onClose={() => (merge.isPending ? undefined : onClose())}
      title="Merge into another project"
      subtitle="Moves everything here to the job you pick, then removes this one."
    >
      {failure ? (
        <Text variant="caption" tone="destructive">
          {failure}
        </Text>
      ) : null}
      {merge.isPending ? (
        <Text variant="bodyStrong">Moving everything across. Keep the app open.</Text>
      ) : null}
      <View style={{ marginHorizontal: -spacing.lg }}>
        <SearchField
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name or address"
          accessibilityLabel="Search projects"
        />
      </View>
      {targets.isLoading ? (
        <SkeletonList rows={4} />
      ) : targets.error ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="body" tone="muted">
            {targets.error instanceof Error ? targets.error.message : "Could not load your jobs."}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void targets.refetch()} />
        </View>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={search ? "Nothing matches" : "No other jobs to merge into"}
          body={search ? "Try a different word." : "Only jobs you created yourself can be merged."}
        />
      ) : (
        <ListGroup>
          {shown.map((target, index) => (
            <View key={target.id}>
              {index > 0 ? <RowDivider /> : null}
              <ListRow
                title={target.name}
                subtitle={mergeTargetAddress(target) ?? undefined}
                disabled={merge.isPending}
                onPress={() => confirm(target.id, target.name)}
              />
            </View>
          ))}
        </ListGroup>
      )}
    </Sheet>
  );
}
