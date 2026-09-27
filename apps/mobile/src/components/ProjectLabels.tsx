import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createLabel, listLabels, type LabelRow } from "@/api/labels";
import { cleanLabelName, fallbackLabelColor, labelColor, labelNameError } from "@/api/label-rules";
import { getMyTeam } from "@/api/team";
import { useAuth } from "@/lib/auth";
import { withAlpha } from "@/components/ProjectStatusPill";
import { radius, spacing, useTheme } from "@/theme";
import { Check, Plus, Search } from "@/ui/icons";
import { Button, Field, Icon, Sheet, Text } from "@/ui";

/**
 * Project labels: the chips, and the sheet that applies and removes them.
 *
 * The phone side of the web `LabelPicker` on the project page. A project stores
 * label NAMES (`projects.labels`); the colour comes from the workspace catalog
 * by name, with the same hashed fallback the web uses for a name the catalog
 * does not have, so a label is the same colour at a desk and on site.
 */

/** The workspace catalog, shared by every screen that draws a label. */
export function useLabelCatalog() {
  const query = useQuery({ queryKey: ["labels"], queryFn: listLabels, staleTime: 5 * 60_000 });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const colorOf = useMemo(() => {
    const byName = new Map(rows.map((row) => [row.name.trim().toLowerCase(), row]));
    return (name: string) => {
      const row = byName.get(name.trim().toLowerCase());
      return row ? labelColor(row) : fallbackLabelColor(name);
    };
  }, [rows]);
  return { rows, colorOf, loading: query.isLoading };
}

/** One label, as a small tinted pill. */
export function LabelChip({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: "sm" | "md";
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: size === "sm" ? spacing.sm : spacing.md,
        paddingVertical: size === "sm" ? 2 : spacing.xs,
        borderRadius: radius.pill,
        backgroundColor: withAlpha(color, theme.scheme === "dark" ? 0.28 : 0.14),
        maxWidth: 200,
      }}
    >
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{
          color: theme.scheme === "dark" ? theme.colors.foreground : color,
          fontWeight: "700",
          fontSize: size === "sm" ? 12 : 13,
          flexShrink: 1,
        }}
      >
        {name}
      </Text>
    </View>
  );
}

/**
 * The labels row on the project screen: the chips, then "Add label".
 *
 * Tapping anywhere on it opens the picker, which is where a label is removed as
 * well as added; a separate small remove target on each chip would be a mis-tap
 * waiting to happen on a phone.
 */
export function ProjectLabels({
  labels,
  onChange,
}: {
  labels: string[];
  onChange: (next: string[]) => void;
}) {
  const theme = useTheme();
  const { colorOf } = useLabelCatalog();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          labels.length > 0 ? `Labels: ${labels.join(", ")}. Change labels` : "Add a label"
        }
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.xs,
          opacity: pressed ? 0.75 : 1,
        })}
      >
        {labels.map((name) => (
          <LabelChip key={name} name={name} color={colorOf(name)} />
        ))}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
            borderRadius: radius.pill,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: theme.colors.border,
          }}
        >
          <Icon icon={Plus} size="sm" tone="muted" />
          <Text variant="caption" tone="muted" style={{ fontWeight: "600" }}>
            {labels.length > 0 ? "Edit" : "Add label"}
          </Text>
        </View>
      </Pressable>

      <LabelPickerSheet
        visible={open}
        onClose={() => setOpen(false)}
        value={labels}
        onChange={onChange}
      />
    </>
  );
}

/**
 * Search the catalog, tick labels on and off, or create one.
 *
 * Each tick writes straight away, like the web picker: there is no "save" to
 * forget on the way back to the van.
 */
function LabelPickerSheet({
  visible,
  onClose,
  value,
  onChange,
}: {
  visible: boolean;
  onClose: () => void;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { rows, colorOf, loading } = useLabelCatalog();
  const teamQuery = useQuery({ queryKey: ["my-team"], queryFn: getMyTeam, enabled: visible });
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = useMemo(() => new Set(value.map((name) => name.toLowerCase())), [value]);

  /*
   * Every catalog label, plus any name on the project the catalog does not
   * have (a label deleted from the library, or one made before it existed), so
   * it can still be taken off.
   */
  const options = useMemo(() => {
    const names = rows.map((row: LabelRow) => row.name);
    for (const name of value) {
      if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name);
    }
    const q = search.trim().toLowerCase();
    return q ? names.filter((name) => name.toLowerCase().includes(q)) : names;
  }, [rows, value, search]);

  const typed = cleanLabelName(search);
  const exact = rows.some((row) => row.name.trim().toLowerCase() === typed.toLowerCase());

  const toggle = (name: string) => {
    const on = chosen.has(name.toLowerCase());
    onChange(on ? value.filter((n) => n.toLowerCase() !== name.toLowerCase()) : [...value, name]);
  };

  const create = async () => {
    const problem = labelNameError(typed, rows);
    if (problem) {
      setError(problem);
      return;
    }
    if (!user) return;
    setCreating(true);
    setError(null);
    try {
      await createLabel({
        name: typed,
        color: fallbackLabelColor(typed),
        teamId: teamQuery.data?.team?.id ?? null,
        userId: user.id,
      });
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
      onChange([...value, typed]);
      setSearch("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create that label.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Labels"
      subtitle={value.length > 0 ? `${value.length} on this project` : "None on this project yet"}
    >
      <Field
        label="Search or create"
        value={search}
        onChangeText={(next) => {
          setSearch(next);
          if (error) setError(null);
        }}
        placeholder="Roofing, Warranty, Insurance"
        icon={Search}
        autoCapitalize="words"
        error={error ?? undefined}
      />

      {typed && !exact ? (
        <Button
          label={`Create "${typed}"`}
          icon={Plus}
          variant="secondary"
          loading={creating}
          onPress={() => void create()}
        />
      ) : null}

      {loading ? (
        <Text variant="caption" tone="muted">
          Loading labels
        </Text>
      ) : options.length === 0 && !typed ? (
        <Text variant="caption" tone="muted">
          No labels in this workspace yet. Type a name above to make the first one.
        </Text>
      ) : null}

      <View style={{ gap: spacing.xs }}>
        {options.map((name) => {
          const on = chosen.has(name.toLowerCase());
          return (
            <LabelOption
              key={name}
              name={name}
              color={colorOf(name)}
              selected={on}
              onPress={() => toggle(name)}
            />
          );
        })}
      </View>
    </Sheet>
  );
}

function LabelOption({
  name,
  color,
  selected,
  onPress,
}: {
  name: string;
  color: string;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={name}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        minHeight: 48,
        paddingHorizontal: spacing.md,
        borderRadius: radius.md,
        backgroundColor: pressed ? theme.colors.secondary : "transparent",
      })}
    >
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: color }} />
      <Text variant="body" numberOfLines={1} style={{ flex: 1 }}>
        {name}
      </Text>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.sm,
          borderWidth: 2,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          backgroundColor: selected ? theme.colors.primary : "transparent",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {selected ? <Icon icon={Check} size="sm" tone="inverse" /> : null}
      </View>
    </Pressable>
  );
}
