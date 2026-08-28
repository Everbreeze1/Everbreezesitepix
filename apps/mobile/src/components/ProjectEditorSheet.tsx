import { useEffect, useState } from "react";
import { View } from "react-native";
import { PROJECT_STATUS_LABELS } from "@everlumen/shared";
import type { ProjectListItem } from "@/api/projects";
import { isSaveableDraft, type ProjectDraft, type ProjectStatusValue } from "@/api/project-patch";
import { spacing } from "@/theme";
import { Button, Chip, Field, Sheet, Text } from "@/ui";

/**
 * Edit a project.
 *
 * Name, address, client and status: the fields the web `EditProjectDialog`
 * offers, in the same order. Anything beyond that (labels, pipeline stage,
 * crew) belongs to a screen the phone does not have yet, and adding half of it
 * here would leave two places that disagree about what a project is.
 *
 * Only the name is required. Someone renaming a job on site should not be made
 * to fill in a postcode first.
 */

const STATUSES: ProjectStatusValue[] = ["active", "on_hold", "completed"];

export function ProjectEditorSheet({
  visible,
  onClose,
  project,
  onSave,
  saving = false,
}: {
  visible: boolean;
  onClose: () => void;
  project: ProjectListItem | null;
  onSave: (draft: ProjectDraft) => void;
  saving?: boolean;
}) {
  const [draft, setDraft] = useState<ProjectDraft>({
    name: "",
    street: null,
    city: null,
    state: null,
    zip: null,
    client_name: null,
    status: "active",
  });
  const [touched, setTouched] = useState(false);

  /*
   * Filled when the sheet opens, not when the project prop changes.
   *
   * A background refetch replaces the project object while the sheet is open,
   * and resetting on that would wipe out whatever the person had typed.
   */
  useEffect(() => {
    if (!visible || !project) return;
    setDraft({
      name: project.name ?? "",
      street: project.street,
      city: project.city,
      state: project.state,
      zip: project.zip,
      client_name: project.client_name,
      status: isStatus(project.status) ? project.status : "active",
    });
    setTouched(false);
  }, [visible, project]);

  const nameError = touched && !draft.name.trim() ? "A project needs a name." : undefined;

  function set<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Edit project"
      footer={
        <>
          <Button
            label="Save changes"
            fullWidth
            loading={saving}
            onPress={() => {
              setTouched(true);
              if (!isSaveableDraft(draft)) return;
              onSave(draft);
            }}
          />
          <Button label="Cancel" variant="ghost" fullWidth disabled={saving} onPress={onClose} />
        </>
      }
    >
      <Field
        label="Name"
        value={draft.name}
        onChangeText={(v) => set("name", v)}
        placeholder="What this job is called"
        error={nameError}
      />

      <Field
        label="Client"
        value={draft.client_name ?? ""}
        onChangeText={(v) => set("client_name", v)}
        placeholder="Optional"
        autoCapitalize="words"
      />

      <Field
        label="Street"
        value={draft.street ?? ""}
        onChangeText={(v) => set("street", v)}
        placeholder="Optional"
        autoComplete="street-address"
        autoCapitalize="words"
      />

      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Field
          label="City"
          value={draft.city ?? ""}
          onChangeText={(v) => set("city", v)}
          placeholder="Optional"
          autoCapitalize="words"
          style={{ flex: 2 }}
        />
        <Field
          label="State"
          value={draft.state ?? ""}
          onChangeText={(v) => set("state", v)}
          placeholder=""
          autoCapitalize="characters"
          style={{ flex: 1 }}
        />
      </View>

      <Field
        label="Postcode"
        value={draft.zip ?? ""}
        onChangeText={(v) => set("zip", v)}
        placeholder="Optional"
        autoCapitalize="characters"
      />

      <View style={{ gap: spacing.sm }}>
        <Text variant="caption" tone="muted">
          Status
        </Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          {STATUSES.map((option) => (
            <Chip
              key={option}
              label={PROJECT_STATUS_LABELS[option]}
              selected={draft.status === option}
              onPress={() => set("status", option)}
            />
          ))}
        </View>
      </View>
    </Sheet>
  );
}

function isStatus(value: unknown): value is ProjectStatusValue {
  return value === "active" || value === "on_hold" || value === "completed";
}
