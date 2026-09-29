import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { goBack } from "@/lib/navigation";
import { useQuery } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { getProjectGroupDetail, type GroupProject } from "@/api/project-groups";
import { normaliseStatus, TASK_STATUS_LABELS } from "@/api/task-status";
import { ProjectStatusPill } from "@/components/ProjectStatusPill";
import { radius, spacing, useTheme } from "@/theme";
import {
  Camera,
  CircleCheck,
  ClipboardCheck,
  FolderKanban,
  ImageOff,
  ListTodo,
  MapPin,
} from "@/ui/icons";
import {
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ProgressBar,
  RowDivider,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One project group: every job in it, with its checklists and open tasks.
 *
 * The phone version of the web group page. The point of a group is seeing a
 * contract's jobs side by side, so each project is a card carrying its cover,
 * counts, checklists (with progress) and the first few tasks; a checklist or
 * task opens its own screen, where it is worked through, and the card itself
 * opens the project.
 *
 * Membership and renaming stay on the Groups list, where they already live.
 */

const TASK_PREVIEW = 6;

export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useQuery({
    queryKey: ["project-group", id],
    queryFn: () => getProjectGroupDetail(String(id)),
    enabled: Boolean(id),
  });

  const detail = query.data;

  return (
    <>
      <Stack.Screen options={{ title: detail?.group.name ?? "Group" }} />
      <Screen
        scroll
        padded={false}
        refreshing={query.isRefetching}
        onRefresh={() => void query.refetch()}
        bottomInset={spacing.xxl}
      >
        {query.isLoading ? (
          <SkeletonList rows={4} />
        ) : query.error || !detail ? (
          <ErrorState
            title="Could not load this group"
            message={query.error instanceof Error ? query.error.message : undefined}
            onRetry={() => void query.refetch()}
          />
        ) : (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            {detail.group.description ? (
              <Text variant="body" tone="muted">
                {detail.group.description}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Stat label="Projects" value={detail.totals.projects} />
              <Stat label="Photos" value={detail.totals.photos} />
              <Stat label="Checklists" value={detail.totals.checklists} />
              <Stat label="Open tasks" value={detail.totals.tasks} />
            </View>

            {detail.projects.length === 0 ? (
              <EmptyState
                icon={FolderKanban}
                title="No projects in this group"
                body="Add projects to it from the Groups list, with the Projects button on its card."
                action={{ label: "Back to groups", onPress: () => goBack("/groups") }}
              />
            ) : (
              detail.projects.map((project) => (
                <GroupProjectCard key={project.id} project={project} />
              ))
            )}
          </View>
        )}
      </Screen>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.xs,
        borderRadius: radius.md,
        backgroundColor: theme.colors.card,
        borderWidth: 1,
        borderColor: theme.colors.border,
        alignItems: "center",
      }}
    >
      <Text variant="heading" style={{ fontWeight: "700" }}>
        {value}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function locationOf(project: GroupProject): string | null {
  if (project.location?.trim()) return project.location.trim();
  const parts = [project.street, project.city, project.state].filter((part) => part?.trim());
  return parts.length > 0 ? parts.join(", ") : null;
}

function GroupProjectCard({ project }: { project: GroupProject }) {
  const theme = useTheme();
  const place = locationOf(project);
  const tasks = project.tasks;
  const openTasks = tasks.filter((task) => normaliseStatus(task.status) !== "done");

  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${project.name}`}
        onPress={() => router.push(`/project/${project.id}`)}
        style={({ pressed }) => ({
          flexDirection: "row",
          gap: spacing.md,
          padding: spacing.lg,
          opacity: pressed ? 0.8 : 1,
        })}
      >
        {project.cover_url ? (
          <Image
            source={{ uri: project.cover_url }}
            style={{ width: 72, height: 72, borderRadius: radius.md }}
            contentFit="cover"
          />
        ) : (
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: radius.md,
              backgroundColor: theme.colors.secondary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Icon icon={ImageOff} size="md" tone="muted" />
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="bodyStrong" numberOfLines={2} style={{ fontWeight: "700" }}>
            {project.name}
          </Text>
          {place ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Icon icon={MapPin} size="sm" tone="muted" />
              <Text variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>
                {place}
              </Text>
            </View>
          ) : null}
          <View
            style={{
              flexDirection: "row",
              flexWrap: "wrap",
              alignItems: "center",
              gap: spacing.sm,
            }}
          >
            {project.status ? <ProjectStatusPill status={project.status} /> : null}
            <Text variant="caption" tone="muted">
              {`${project.photo_count} photo${project.photo_count === 1 ? "" : "s"} · ${relativeTime(project.updated_at)}`}
            </Text>
          </View>
        </View>
      </Pressable>

      <RowDivider />

      <View
        style={{ padding: spacing.lg, gap: spacing.sm, backgroundColor: theme.colors.background }}
      >
        <SectionLabel
          icon={ClipboardCheck}
          title="Checklists"
          count={project.checklists.length}
          trailing={
            project.checklist_items_total > 0
              ? `${project.checklist_items_done}/${project.checklist_items_total} items`
              : null
          }
        />
        {project.checklists.length === 0 ? (
          <Text variant="caption" tone="muted">
            No checklists on this project.
          </Text>
        ) : (
          project.checklists.map((checklist) => (
            <Pressable
              key={checklist.id}
              accessibilityRole="button"
              accessibilityLabel={`${checklist.name}, ${checklist.done} of ${checklist.total} done`}
              onPress={() => router.push(`/checklist/${checklist.id}`)}
              style={({ pressed }) => ({ gap: 4, paddingVertical: 4, opacity: pressed ? 0.7 : 1 })}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                {checklist.total > 0 && checklist.done === checklist.total ? (
                  <Icon icon={CircleCheck} size="sm" tone="success" />
                ) : null}
                <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
                  {checklist.name}
                </Text>
                <Text variant="caption" tone="muted">
                  {`${checklist.done}/${checklist.total}`}
                </Text>
              </View>
              {checklist.total > 0 ? (
                <ProgressBar
                  value={checklist.done}
                  total={checklist.total}
                  tone={checklist.done === checklist.total ? "success" : "primary"}
                />
              ) : null}
            </Pressable>
          ))
        )}

        <View style={{ height: spacing.sm }} />

        <SectionLabel
          icon={ListTodo}
          title="Tasks"
          count={tasks.length}
          trailing={`${openTasks.length} open`}
        />
        {tasks.length === 0 ? (
          <Text variant="caption" tone="muted">
            No tasks on this project.
          </Text>
        ) : (
          <>
            {tasks.slice(0, TASK_PREVIEW).map((task) => {
              const status = normaliseStatus(task.status);
              return (
                <Pressable
                  key={task.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${task.title}, ${TASK_STATUS_LABELS[status]}`}
                  onPress={() => router.push(`/task/${task.id}`)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.sm,
                    minHeight: 40,
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Icon
                    icon={status === "done" ? CircleCheck : ListTodo}
                    size="sm"
                    tone={status === "done" ? "success" : "muted"}
                  />
                  <Text
                    variant="body"
                    numberOfLines={1}
                    tone={status === "done" ? "muted" : "default"}
                    style={{
                      flex: 1,
                      textDecorationLine: status === "done" ? "line-through" : "none",
                    }}
                  >
                    {task.title}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {task.due_date ? task.due_date.slice(0, 10) : TASK_STATUS_LABELS[status]}
                  </Text>
                </Pressable>
              );
            })}
            {tasks.length > TASK_PREVIEW ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/project/${project.id}/tasks`)}
                hitSlop={8}
              >
                <Text variant="caption" tone="primary" style={{ fontWeight: "700" }}>
                  {`View all ${tasks.length} tasks`}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/project/${project.id}/capture`)}
          hitSlop={8}
          style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm }}
        >
          <Icon icon={Camera} size="sm" tone="primary" />
          <Text variant="caption" tone="primary" style={{ fontWeight: "700" }}>
            Take photos on this job
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

function SectionLabel({
  icon,
  title,
  count,
  trailing,
}: {
  icon: typeof ListTodo;
  title: string;
  count: number;
  trailing?: string | null;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
      <Icon icon={icon} size="sm" tone="muted" />
      <Text variant="overline" tone="muted">
        {`${title.toUpperCase()} · ${count}`}
      </Text>
      {trailing ? (
        <Text variant="caption" tone="muted" style={{ marginLeft: "auto" }}>
          {trailing}
        </Text>
      ) : null}
    </View>
  );
}
