import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { getProjectContributors } from "@/api/task-comments";
import { memberLabel, type MentionMember } from "@/api/task-mentions";
import { TASK_PRIORITY_LABELS, type TaskPriority } from "@/api/task-status";
import { isIsoDate, isoDaysFromToday } from "@/api/task-dates";
import type { TaskDraft, TaskRow } from "@/api/tasks";
import { spacing } from "@/theme";
import { Calendar, Flag, UserX } from "@/ui/icons";
import { Avatar, Button, Chip, Field, ListGroup, ListRow, RowDivider, Sheet, Text } from "@/ui";

/**
 * Create or edit a task.
 *
 * One component for both, because the fields are identical and a separate
 * "edit" sheet is how the two drift until creating a task offers a priority the
 * editor cannot change.
 *
 * Everything here is optional except the title. A task with only a title is a
 * useful task, and a form that refuses to save without an assignee and a date
 * is a form people work around by not using it.
 */

export type TaskEditorSheetProps = {
  visible: boolean;
  onClose: () => void;
  projectId: string;
  /** Absent when creating. */
  task?: TaskRow | null;
  onSave: (draft: TaskDraft) => void;
  saving?: boolean;
};

const PRIORITIES: TaskPriority[] = ["low", "normal", "high", "urgent"];

export function TaskEditorSheet({
  visible,
  onClose,
  projectId,
  task,
  onSave,
  saving = false,
}: TaskEditorSheetProps) {
  const editing = Boolean(task);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [due, setDue] = useState<string | null>(null);
  const [assignee, setAssignee] = useState<MentionMember | null>(null);
  const [touched, setTouched] = useState(false);

  const membersQuery = useQuery({
    queryKey: ["project-contributors", projectId],
    queryFn: () => getProjectContributors(projectId),
    enabled: visible && Boolean(projectId),
    // Teammates change rarely and this only feeds a picker.
    staleTime: 10 * 60 * 1000,
  });

  const members = useMemo(() => membersQuery.data ?? [], [membersQuery.data]);

  /*
   * Reset when the sheet opens, not when it closes.
   *
   * Resetting on close means the fields visibly empty themselves during the
   * dismiss animation, which reads as the work being thrown away. Doing it on
   * open also guarantees an edit sheet shows the task as it is now rather than
   * as it was the last time this component was mounted.
   */
  useEffect(() => {
    if (!visible) return;
    setTitle(task?.title ?? "");
    setDescription(task?.description ?? "");
    setPriority(isPriority(task?.priority) ? task.priority : "normal");
    setDue(task?.due_date ?? null);
    setAssignee(
      task?.assignee_user_id
        ? {
            user_id: task.assignee_user_id,
            email: task.assignee_email,
            full_name: null,
          }
        : null,
    );
    setTouched(false);
  }, [visible, task]);

  const trimmed = title.trim();
  const titleError = touched && !trimmed ? "A task needs a title." : undefined;

  function save() {
    setTouched(true);
    if (!trimmed) return;
    onSave({
      title: trimmed,
      description: description.trim() || null,
      priority,
      due_date: due,
      assignee_user_id: assignee?.user_id ?? null,
      assignee_email: assignee?.email ?? null,
    });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={editing ? "Edit task" : "New task"}
      subtitle={editing ? undefined : "Only the title is required."}
      footer={
        <>
          <Button
            label={editing ? "Save changes" : "Add task"}
            fullWidth
            loading={saving}
            onPress={save}
          />
          <Button label="Cancel" variant="ghost" fullWidth disabled={saving} onPress={onClose} />
        </>
      }
    >
      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="What needs doing?"
        error={titleError}
        autoCapitalize="sentences"
      />

      <Field
        label="Details"
        value={description}
        onChangeText={setDescription}
        placeholder="Optional. Where on site, what to bring."
        multiline
        rows={3}
      />

      <View style={{ gap: spacing.sm }}>
        <Text variant="caption" tone="muted">
          Priority
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {PRIORITIES.map((option) => (
            <Chip
              key={option}
              label={TASK_PRIORITY_LABELS[option]}
              icon={option === "high" || option === "urgent" ? Flag : undefined}
              selected={priority === option}
              onPress={() => setPriority(option)}
            />
          ))}
        </View>
      </View>

      <DueDatePicker value={due} onChange={setDue} />

      <View style={{ gap: spacing.sm }}>
        <Text variant="caption" tone="muted">
          Assigned to
        </Text>
        <ListGroup>
          <ListRow
            icon={UserX}
            iconTone="muted"
            title="Nobody yet"
            right={assignee === null ? <Chip label="Selected" selected /> : undefined}
            onPress={() => setAssignee(null)}
          />
          {members.map((member) => (
            <View key={member.user_id}>
              <RowDivider />
              <ListRow
                title={memberLabel(member)}
                subtitle={member.email ?? undefined}
                right={
                  <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                    <Avatar name={memberLabel(member)} size="sm" />
                    {assignee?.user_id === member.user_id ? (
                      <Chip label="Selected" selected />
                    ) : null}
                  </View>
                }
                onPress={() => setAssignee(member)}
              />
            </View>
          ))}
        </ListGroup>
        {membersQuery.isLoading ? (
          <Text variant="caption" tone="muted">
            Loading teammates
          </Text>
        ) : null}
      </View>
    </Sheet>
  );
}

/**
 * Due date, without a native date picker.
 *
 * `@react-native-community/datetimepicker` is the obvious choice and is
 * deliberately not used: it is a native module, and the app is currently tested
 * in Expo Go, so adding one ends device testing until an EAS development build
 * exists. That is too high a price for one field.
 *
 * The chips are not a workaround so much as the better control for this case.
 * Field tasks are due today, tomorrow, or by the end of the week far more often
 * than they are due on a specific date three months out, and a spinner makes
 * the common case slower than the rare one. The text field is there for the
 * rare one.
 *
 * Swap this for a native picker once the app is on a development build. The
 * shape of the prop, an ISO date string or null, will not need to change.
 */
function DueDatePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setManual(value ?? "");
    setManualError(undefined);
  }, [value]);

  const options: { label: string; date: string | null }[] = [
    { label: "No date", date: null },
    { label: "Today", date: isoDaysFromToday(0) },
    { label: "Tomorrow", date: isoDaysFromToday(1) },
    { label: "In a week", date: isoDaysFromToday(7) },
  ];

  function commitManual() {
    const text = manual.trim();
    if (!text) {
      setManualError(undefined);
      onChange(null);
      return;
    }
    if (!isIsoDate(text)) {
      // Keep what was typed on screen rather than storing something the
      // database will reject at drain time, hours later and out of context.
      setManualError("Use YYYY-MM-DD, for example 2026-09-14.");
      return;
    }
    setManualError(undefined);
    onChange(text);
  }

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" tone="muted">
        Due
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {options.map((option) => (
          <Chip
            key={option.label}
            label={option.label}
            icon={option.date ? Calendar : undefined}
            selected={value === option.date}
            onPress={() => onChange(option.date)}
          />
        ))}
      </View>
      <Field
        value={manual}
        onChangeText={setManual}
        onBlur={commitManual}
        onSubmitEditing={commitManual}
        placeholder="Or a date, YYYY-MM-DD"
        keyboardType="numbers-and-punctuation"
        autoCapitalize="none"
        error={manualError}
      />
    </View>
  );
}

function isPriority(value: unknown): value is TaskPriority {
  return typeof value === "string" && value in TASK_PRIORITY_LABELS;
}
