import { useEffect, useState } from "react";
import { View } from "react-native";
import { CHECKLIST_TYPE_LABELS, type ChecklistItemType } from "@everlumen/shared";
import type { ChecklistItem } from "@/api/checklists";
import { MAX_PASTED_ITEMS, parsePastedItems } from "@/api/record-edit-rules";
import { ITEM_TYPES, labelError } from "@/api/template-edit";
import { spacing, useLayout } from "@/theme";
import { ChevronDown, ChevronUp, ClipboardPaste, Plus, Trash2 } from "@/ui/icons";
import { Badge, Button, Card, Chip, EmptyState, Field, IconButton, Sheet, Text } from "@/ui";

/**
 * The Edit mode of the checklist runner.
 *
 * Kept out of the runner so the screen someone works through on site stays a
 * list of answers and nothing else. Everything here is what the web page offers
 * an author (`ChecklistDocumentPage`): add one item with an answer type, paste
 * many at once, reorder, mark required, and remove.
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
}: {
  /** Already in display order. */
  items: ChecklistItem[];
  busy: boolean;
  error: string | null;
  onAdd: (labels: string[], itemType: ChecklistItemType) => Promise<boolean>;
  onDelete: (item: ChecklistItem) => void;
  onMove: (item: ChecklistItem, by: -1 | 1) => void;
  onToggleRequired: (item: ChecklistItem) => void;
}) {
  const layout = useLayout();
  const wide = layout.split();
  const [pasting, setPasting] = useState(false);

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
        onAdd={async (labels, type) => {
          const ok = await onAdd(labels, type);
          if (ok) setPasting(false);
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

function AddItemCard({
  busy,
  error,
  onAdd,
  onPaste,
}: {
  busy: boolean;
  error: string | null;
  onAdd: (labels: string[], itemType: ChecklistItemType) => Promise<boolean>;
  onPaste: () => void;
}) {
  const [label, setLabel] = useState("");
  const [type, setType] = useState<ChecklistItemType>("checkbox");
  const [labelProblem, setLabelProblem] = useState<string | null>(null);

  async function add() {
    const problem = labelError(label);
    if (problem) {
      setLabelProblem(problem);
      return;
    }
    const ok = await onAdd([label.trim()], type);
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
}: {
  item: ChecklistItem;
  first: boolean;
  last: boolean;
  busy: boolean;
  onDelete: (item: ChecklistItem) => void;
  onMove: (item: ChecklistItem, by: -1 | 1) => void;
  onToggleRequired: (item: ChecklistItem) => void;
}) {
  return (
    <Card style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
        <View style={{ flex: 1, gap: spacing.xs }}>
          <Text variant="bodyStrong">{item.label}</Text>
          <Text variant="caption" tone="muted">
            {CHECKLIST_TYPE_LABELS[item.item_type as ChecklistItemType] ?? item.item_type}
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
        <Chip label="Required" selected={item.required} onPress={() => onToggleRequired(item)} />
        <View style={{ flex: 1 }} />
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
  onAdd: (labels: string[], itemType: ChecklistItemType) => Promise<void>;
}) {
  const [raw, setRaw] = useState("");
  const [type, setType] = useState<ChecklistItemType>("checkbox");

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
          onPress={() => void onAdd(labels, type)}
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
      {labels.length > 0 ? <Badge label={`${labels.length} ready to add`} tone="primary" /> : null}
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
