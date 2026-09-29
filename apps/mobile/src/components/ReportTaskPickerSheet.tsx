import { useEffect, useState } from "react";
import { Pressable, Switch, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { listReportableTasks } from "@/api/report-builder";
import { radius, spacing, useTheme } from "@/theme";
import { CircleCheck, ListTodo } from "@/ui/icons";
import { Button, EmptyState, Icon, Sheet, SkeletonList, Text } from "@/ui";
import type { TaskForReport, TaskPhotoStateForReport } from "@everlumen/shared";

/**
 * Put the field record of a task into a report: the web's "Add work from
 * tasks". Each task picked becomes one section, and each of its photos is
 * captioned with the note written about it, so whoever receives the report
 * reads what was done rather than a row of unexplained pictures.
 *
 * Finished tasks start ticked, as on the web; outstanding photos are included
 * by default, because what still needs doing is half of what a client asked
 * for.
 */
export function ReportTaskPickerSheet({
  visible,
  projectId,
  busy,
  onClose,
  onAdd,
}: {
  visible: boolean;
  projectId: string;
  busy: boolean;
  onClose: () => void;
  onAdd: (args: {
    tasks: TaskForReport[];
    states: Record<string, TaskPhotoStateForReport[]>;
    includeOutstanding: boolean;
  }) => void;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [includeOutstanding, setIncludeOutstanding] = useState(true);

  const query = useQuery({
    queryKey: ["reportable-tasks", projectId],
    queryFn: () => listReportableTasks(projectId),
    enabled: visible,
  });
  const tasks = query.data?.tasks ?? [];

  // Finished work pre-ticked each time a fresh list arrives.
  useEffect(() => {
    if (!query.data) return;
    setPicked(new Set(query.data.tasks.filter((t) => t.status === "done").map((t) => t.id)));
  }, [query.data]);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = picked.size;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Add work from tasks"
      subtitle="One section per task. Each photo is captioned with what was done to it."
      footer={
        tasks.length > 0 ? (
          <Button
            label={count === 0 ? "Add sections" : `Add ${count} section${count === 1 ? "" : "s"}`}
            fullWidth
            loading={busy}
            disabled={busy || count === 0}
            onPress={() =>
              onAdd({
                tasks: tasks.filter((task) => picked.has(task.id)),
                states: query.data?.states ?? {},
                includeOutstanding,
              })
            }
          />
        ) : undefined
      }
    >
      {query.isLoading ? (
        <SkeletonList rows={3} />
      ) : query.error ? (
        <Text variant="body" tone="muted">
          {query.error instanceof Error ? query.error.message : "Could not load the tasks."}
        </Text>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title="No tasks carry photos yet"
          body="Attach photos to a task and it can be reported here."
        />
      ) : (
        <>
          {tasks.map((task) => {
            const on = picked.has(task.id);
            return (
              <Pressable
                key={task.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={task.title}
                onPress={() => toggle(task.id)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: spacing.md,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: on ? 2 : 1,
                  borderColor: on ? theme.colors.primary : theme.colors.border,
                  backgroundColor: pressed ? theme.colors.secondary : theme.colors.card,
                })}
              >
                <Icon
                  icon={on ? CircleCheck : ListTodo}
                  size="md"
                  tone={on ? "primary" : "muted"}
                />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text variant="bodyStrong" numberOfLines={2}>
                    {task.title}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {[
                      task.status === "done"
                        ? "Done"
                        : task.status === "in_progress"
                          ? "In progress"
                          : "Open",
                      task.progressLabel ? `${task.progressLabel} photos done` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </View>
              </Pressable>
            );
          })}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              paddingTop: spacing.sm,
            }}
          >
            <Text variant="body" style={{ flex: 1 }}>
              Include photos still outstanding
            </Text>
            <Switch
              accessibilityLabel="Include photos still outstanding"
              value={includeOutstanding}
              onValueChange={setIncludeOutstanding}
              trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
            />
          </View>
        </>
      )}
    </Sheet>
  );
}
