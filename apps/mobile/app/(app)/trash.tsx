import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { Stack, router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listTrashedProjects,
  purgeProject,
  restoreProject,
  type TrashedProject,
} from "@/api/trash";
import {
  contentsLabel,
  isUrgent,
  purgeWarning,
  sortedByUrgency,
  timeLeftLabel,
  trashSummary,
} from "@/api/trash-view";
import { spacing } from "@/theme";
import { RotateCcw, Trash2, TriangleAlert } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * Deleted projects, and getting them back.
 *
 * The phone already had a photo trash inside one job. This is the level above,
 * and it was missing entirely: a job deleted on the web could not be found from
 * a device, let alone recovered. That is the wrong way round for the client
 * that people carry, because the person who notices a job has gone is usually
 * the one standing on it.
 *
 * Everything the server returns here is owned by the caller - the query is
 * scoped to `owner_id` - which is what makes both buttons safe to offer on
 * every row: neither can silently match nothing.
 *
 * Moving a live job INTO the trash is not here. That already exists on the
 * project screen, and a second route to the same act would mean two paths with
 * different permission behaviour.
 */
export default function TrashScreen() {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["trashed-projects"], queryFn: listTrashedProjects });
  const projects = useMemo(() => sortedByUrgency(query.data ?? []), [query.data]);

  function forget(projectId: string) {
    queryClient.setQueryData<TrashedProject[]>(["trashed-projects"], (prev) =>
      (prev ?? []).filter((p) => p.id !== projectId),
    );
  }

  const restore = useMutation({
    mutationFn: (projectId: string) => restoreProject(projectId),
    onSuccess: (_ok, projectId) => {
      forget(projectId);
      setFailure(null);
      // The project list and its counts are both wrong now.
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["trash-counts"] });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not restore that project."),
  });

  const purge = useMutation({
    mutationFn: (projectId: string) => purgeProject(projectId),
    onSuccess: (_ok, projectId) => {
      forget(projectId);
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: ["trash-counts"] });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not delete that project."),
  });

  const confirmPurge = useCallback(
    (project: TrashedProject) => {
      /*
       * Two-step, and the second step names the photo count. "Delete Riverside
       * Unit 4" and "Delete Riverside Unit 4 and its 340 photographs" are
       * different decisions, and the purge removes the storage objects too.
       */
      Alert.alert("Delete for good?", purgeWarning(project), [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete for good",
          style: "destructive",
          onPress: () => purge.mutate(project.id),
        },
      ]);
    },
    [purge],
  );

  const busy = restore.isPending || purge.isPending;

  return (
    <>
      <Stack.Screen options={{ title: "Trash" }} />
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
      >
        <PageHeader
          title="Trash"
          subtitle={query.isLoading ? undefined : trashSummary(query.data ?? [])}
        />

        {query.isLoading ? (
          <SkeletonList rows={4} />
        ) : query.error ? (
          <ErrorState
            title="Could not load the trash"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            icon={Trash2}
            title="Nothing deleted"
            body="Deleted projects wait here for 60 days before they go for good."
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {projects.map((project) => (
              <Card key={project.id} style={{ gap: spacing.sm }}>
                <View style={{ gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={1}>
                    {project.name}
                  </Text>
                  {project.location ? (
                    <Text variant="caption" tone="muted" numberOfLines={1}>
                      {project.location}
                    </Text>
                  ) : null}
                  <Text variant="caption" tone="muted">
                    {contentsLabel(project)}
                  </Text>
                </View>

                {/*
                  The countdown is the server's own, not recomputed here. The
                  purge runs on the server's clock, so a phone in another
                  timezone counting for itself would disagree with the thing
                  that actually deletes the data.
                */}
                <Badge
                  label={timeLeftLabel(project)}
                  tone={isUrgent(project) ? "warning" : "neutral"}
                  icon={isUrgent(project) ? TriangleAlert : undefined}
                  variant="soft"
                />

                <View style={{ flexDirection: "row", gap: spacing.sm }}>
                  <Button
                    label="Put back"
                    icon={RotateCcw}
                    size="sm"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onPress={() => restore.mutate(project.id)}
                  />
                  <Button
                    label="Delete for good"
                    variant="destructive"
                    size="sm"
                    style={{ flex: 1 }}
                    disabled={busy}
                    onPress={() => confirmPurge(project)}
                  />
                </View>
              </Card>
            ))}

            <Text variant="caption" tone="muted">
              Photos deleted inside a job are kept separately, on that job&apos;s own trash.
            </Text>

            <Button
              label="Back to projects"
              variant="secondary"
              fullWidth
              onPress={() => router.replace("/(app)/(tabs)/projects")}
            />
          </View>
        )}
      </Screen>
    </>
  );
}
