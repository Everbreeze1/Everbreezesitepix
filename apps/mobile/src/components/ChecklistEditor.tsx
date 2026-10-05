import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import {
  CHECKLIST_TYPE_LABELS,
  MAX_UNIT_LENGTH,
  MEASUREMENT_UNITS,
  normalizeUnit,
  type ChecklistItemType,
} from "@everlumen/shared";
import type { ChecklistItem, NewItemOptions } from "@/api/checklists";
import { MAX_PASTED_ITEMS, parsePastedItems } from "@/api/record-edit-rules";
import { ITEM_TYPES, labelError } from "@/api/template-edit";
import { spacing, useLayout } from "@/theme";
import { Camera, ChevronDown, ChevronUp, ClipboardPaste, Plus, Ruler, Trash2 } from "@/ui/icons";
import { Badge, Button, Card, Chip, EmptyState, Field, IconButton, Sheet, Text } from "@/ui";

/**
 * The Edit mode of the checklist runner.
 *
 * Kept out of the runner so the screen someone works through on site stays a
 * list of answers and nothing else. Everything here is what the web page offers
 * an author (`ChecklistDocumentPage`): add one item with an answer type, paste
 * many at once, reorder, mark required, ask for a photo, set a Number item's
 * unit, and remove.
 *
 * On a tablet or a phone on its side the add controls sit in a column on the
 * right, where the primary actions live on every other wide screen; upright
 * they sit above the list.
 */
export function ChecklistEditPanel({
  items,
  busy,
  error,
  onAdd,
  onDelete,
  onMove,
  onToggleRequired,
  onTogglePhotoRequired,
  onSetUnit,
}: {
  /** Already in display order. */
  items: ChecklistItem[];
  busy: boolean;
  error: string | null;
  onAdd: (
    labels: string[],
    itemType: ChecklistItemType,
    options?: NewItemOptions,
  ) => Promise<boolean>;
  onDelete: (item: ChecklistItem) => void;
  onMove: (item: ChecklistItem, by: -1 | 1) => void;
  onToggleRequired: (item: ChecklistItem) => void;
  onTogglePhotoRequired: (item: ChecklistItem) => void;
  /** Resolves true once the unit is saved, so the sheet can close. */
  onSetUnit: (item: ChecklistItem, unit: string | null) => Promise<boolean>;
}) {
  const layout = useLayout();
  const wide = layout.split();
  const [pasting, setPasting] = useState(false);
  const [unitFor, setUnitFor] = useState<ChecklistItem | null>(null);

  const addPanel = (
    <AddItemCard busy={busy} error={error} onAdd={onAdd} onPaste={() => setPasting(true)} />
  );

  const list =
    items.length === 0 ? (
      <EmptyState
        icon={Plus}
        title="No items yet"
        body="Type the first item, or paste a list you already have."
      />
    ) : (
      <View style={{ gap: spacing.sm }}>
        {items.map((item, index) => (
          <EditRow
            key={item.id}
            item={item}
            first={index === 0}
            last={index === items.length - 1}
            busy={busy}
            onDelete={onDelete}
            onMove={onMove}
            onToggleRequired={onToggleRequired}
            onTogglePhotoRequired={onTogglePhotoRequired}
            onEditUnit={setUnitFor}
          />
        ))}
      </View>
    );

  return (
    <>
      {wide ? (
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }}>
          <View style={{ flex: 1, minWidth: 0 }}>{list}</View>
          <View style={{ width: 340 }}>{addPanel}</View>
        </View>
      ) : (
        <View style={{ gap: spacing.md }}>
          {addPanel}
          {list}
        </View>
      )}

      <PasteItemsSheet
        visible={pasting}
        busy={busy}
        onClose={() => setPasting(false)}
        onAdd={async (labels, type, options) => {
          const ok = await onAdd(labels, type, options);
          if (ok) setPasting(false);
        }}
      />

      <UnitSheet
        visible={unitFor !== null}
        item={unitFor}
        busy={busy}
        onClose={() => setUnitFor(null)}
        onSave={async (unit) => {
          if (!unitFor) return;
          const ok = await onSetUnit(unitFor, unit);
          if (ok) setUnitFor(null);
        }}
      />
    </>
  );
}

function TypePicker({
  value,
  onChange,
}: {
  value: ChecklistItemType;
  onChange: (next: ChecklistItemType) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" tone="muted">
        Answer type
      </Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        {ITEM_TYPES.map((type) => (
          <Chip
            key={type}
            label={CHECKLIST_TYPE_LABELS[type]}
            selected={value === type}
            onPress={() => onChange(type)}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * What a Number item measures in: one of the common units, or the author's own.
 *
 * The presets scroll sideways rather than wrap, because eighteen chips wrapped
 * into a 340-wide column is a wall that pushes the Add button off the screen.
 * The custom field holds its own draft so typing "sq" on the way to "sq ft"
 * does not light up and then un-light a chip under the author's thumb.
 */
export function UnitPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (next: string | null) => void;
}) {
  const presets: readonly string[] = MEASUREMENT_UNITS;
  const [custom, setCustom] = useState(value && !presets.includes(value) ? value : "");

  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" tone="muted">
        Unit
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: spacing.sm }}
      >
        <Chip
          label="None"
          selected={!value}
          onPress={() => {
            setCustom("");
            onChange(null);
          }}
        />
        {presets.map((unit) => (
          <Chip
            key={unit}
            label={unit}
            selected={value === unit}
            onPress={() => {
              setCustom("");
              onChange(value === unit ? null : unit);
            }}
          />
        ))}
      </ScrollView>
      <Field
        value={custom}
        onChangeText={(next) => {
          const capped = next.slice(0, MAX_UNIT_LENGTH);
          setCustom(capped);
          onChange(normalizeUnit(capped));
        }}
        placeholder="Or type your own, like cfm"
        autoCapitalize="none"
        returnKeyType="done"
      />
    </View>
  );
}

/** The line under an item's label in an author's list: its type and unit. */
export function itemTypeLine(item: { item_type: string; unit?: string | null }): string {
  const label = CHECKLIST_TYPE_LABELS[item.item_type as ChecklistItemType] ?? item.item_type;
  const unit = item.item_type === "numeric" ? normalizeUnit(item.unit) : null;
  return unit ? `${label} (${unit})` : label;
}

function AddItemCard({
  busy,
  error,
  onAdd,
  onPaste,
}: {
  busy: boolean;
  error: string | null;
  onAdd: (
    labels: string[],
    itemType: ChecklistItemType,
    options?: NewItemOptions,
  ) => Promise<boolean>;
  onPaste: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ChecklistItemType>("checkbox");
  const [unit, setUnit] = useState<string | null>(null);
  const [photoRequired, setPhotoRequired] = useState(false);
  const [labelProblem, setLabelProblem] = useState<string | null>(null);

  async function add() {
    const problem = labelError(label);
    if (problem) {
      setLabelProblem(problem);
      return;
    }
    // The unit and the photo switch are kept for the next line too, for the
    // same reason as the type: a run of measurements shares a unit.
    const ok = await onAdd([label.trim()], type, { unit, photoRequired });
    // The answer type is kept for the next line, as on the web: a run of
    // Pass/Fail checks is typed as a run, not re-picked each time.
    if (ok) setLabel("");
  }

  return (
    <Card style={{ gap: spacing.md }}>
      <Field
        label="New item"
        value={label}
        onChangeText={(next) => {
          setLabel(next);
          if (labelProblem) setLabelProblem(null);
        }}
        placeholder="Verify breaker labeled"
        error={labelProblem ?? undefined}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={() => void add()}
      />
      <TypePicker value={type} onChange={setType} />
      {type === "numeric" ? <UnitPicker value={unit} onChange={setUnit} /> : null}
      <View style={{ flexDirection: "row" }}>
        <Chip
          label="Photo required"
          icon={Camera}
          selected={photoRequired}
          onPress={() => setPhotoRequired((current) => !current)}
        />
      </View>
      {error ? (
        <Text variant="caption" tone="destructive">
          {error}
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", gap: spacing.sm }}>
        <Button
          label="Add item"
          icon={Plus}
          loading={busy}
          onPress={() => void add()}
          style={{ flex: 1 }}
        />
        <Button
          label="Paste list"
          icon={ClipboardPaste}
          variant="outline"
          disabled={busy}
          onPress={onPaste}
          style={{ flex: 1 }}
        />
      </View>
    </Card>
  );
}

function EditRow({
  item,
  first,
  last,
  busy,
  onDelete,
  onMove,
  onToggleRequired,
  onTogglePhotoRequired,
  onEditUnit,
}: {
  item: ChecklistItem;
  first: boolean;
  last: boolean;
  busy: boolean;
  onDelete: (item: ChecklistItem) => void;
  onMove: (item: ChecklistItem, by: -1 | 1) => void;
  onToggleRequired: (item: ChecklistItem) => void;
  onTogglePhotoRequired: (item: ChecklistItem) => void;
  onEditUnit: (item: ChecklistItem) => void;
}) {
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="bodyStrong">{item.label}</Text>
          <Text variant="caption" tone="muted">
            {itemTypeLine(item)}
          </Text>
        </View>
        <IconButton
          icon={Trash2}
          accessibilityLabel={`Remove ${item.label}`}
          tone="destructive"
          surface={false}
          disabled={busy}
          onPress={() => onDelete(item)}
        />
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
        {/*
          The switches wrap on their own line rather than squeezing the arrows:
          three chips and two arrows do not fit across a 360dp phone.
        */}
        <View style={{ flex: 1, flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
          <Chip label="Required" selected={item.required} onPress={() => onToggleRequired(item)} />
          <Chip
            label="Photo required"
            icon={Camera}
            selected={item.photo_required}
            onPress={() => onTogglePhotoRequired(item)}
          />
          {item.item_type === "numeric" ? (
            <Chip
              label={item.unit ? `Unit: ${item.unit}` : "Add unit"}
              icon={Ruler}
              onPress={() => onEditUnit(item)}
            />
          ) : null}
        </View>
        <IconButton
          icon={ChevronUp}
          accessibilityLabel={`Move ${item.label} up`}
          disabled={busy || first}
          onPress={() => onMove(item, -1)}
        />
        <IconButton
          icon={ChevronDown}
          accessibilityLabel={`Move ${item.label} down`}
          disabled={busy || last}
          onPress={() => onMove(item, 1)}
        />
      </View>
    </Card>
  );
}

/** Many items at once, one per line, all of one answer type. */
function PasteItemsSheet({
  visible,
  busy,
  onClose,
  onAdd,
}: {
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  onAdd: (labels: string[], itemType: ChecklistItemType, options?: NewItemOptions) => Promise<void>;
}) {
  const [raw, setRaw] = useState("");
  const [type, setType] = useState<ChecklistItemType>("checkbox");
  const [unit, setUnit] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setRaw("");
  }, [visible]);

  const { labels, truncated } = parsePastedItems(raw);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Paste a list"
      subtitle="One item per line. Bullets and numbering are removed."
      footer={
        <Button
          label={
            labels.length === 0
              ? "Add items"
              : `Add ${labels.length} item${labels.length === 1 ? "" : "s"}`
          }
          icon={Plus}
          fullWidth
          loading={busy}
          disabled={labels.length === 0}
          onPress={() => void onAdd(labels, type, { unit })}
        />
      }
    >
      <Field
        label="Items"
        value={raw}
        onChangeText={setRaw}
        placeholder={"Verify breaker labeled\nFilter replaced\nCondensate drain clear"}
        multiline
        rows={8}
        autoCapitalize="sentences"
        hint={truncated ? `Only the first ${MAX_PASTED_ITEMS} lines are added.` : undefined}
      />
      <TypePicker value={type} onChange={setType} />
      {type === "numeric" ? <UnitPicker value={unit} onChange={setUnit} /> : null}
      {labels.length > 0 ? <Badge label={`${labels.length} ready to add`} tone="primary" /> : null}
    </Sheet>
  );
}

/** Change the unit of a Number item already on the checklist. */
function UnitSheet({
  visible,
  item,
  busy,
  onClose,
  onSave,
}: {
  visible: boolean;
  item: ChecklistItem | null;
  busy: boolean;
  onClose: () => void;
  onSave: (unit: string | null) => Promise<void>;
}) {
  const [unit, setUnit] = useState<string | null>(item?.unit ?? null);

  useEffect(() => {
    if (visible) setUnit(item?.unit ?? null);
  }, [visible, item]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Unit"
      subtitle={item ? `What "${item.label}" is measured in.` : undefined}
      footer={
        <Button label="Save unit" fullWidth loading={busy} onPress={() => void onSave(unit)} />
      }
    >
      {/* Keyed by item so the custom field starts from this item's unit. */}
      {visible && item ? <UnitPicker key={item.id} value={unit} onChange={setUnit} /> : null}
    </Sheet>
  );
}

/** A one-field name prompt, for renaming and for naming a template. */
export function NameSheet({
  visible,
  title,
  subtitle,
  label,
  initial,
  confirmLabel,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  title: string;
  subtitle?: string;
  label: string;
  initial: string;
  confirmLabel: string;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(initial);
      setProblem(null);
    }
  }, [visible, initial]);

  function submit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setProblem("Give it a name.");
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      footer={<Button label={confirmLabel} fullWidth loading={busy} onPress={submit} />}
    >
      <Field
        label={label}
        value={name}
        onChangeText={(next) => {
          setName(next);
          if (problem) setProblem(null);
        }}
        error={problem ?? error ?? undefined}
        autoCapitalize="sentences"
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </Sheet>
  );
}
