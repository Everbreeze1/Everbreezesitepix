import { useCallback, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Pressable,
  ScrollView,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import {
  hasMark,
  inheritedMarks,
  insertAfter,
  isTextBlock,
  linkAt,
  linkMark,
  moveDocBlock,
  normaliseHref,
  normaliseRuns,
  PAGE_BREAK_HTML,
  rawBlock,
  rawLabel,
  rawPreview,
  removeDocBlock,
  replaceBlock,
  replaceRange,
  runsText,
  setKind,
  setLink,
  setRuns,
  splitTypedLines,
  applyTextEdit,
  textBlock,
  toggleMark,
  type DocBlock,
  type Mark,
  type Run,
  type TextBlock,
  type TextKind,
} from "@/api/rich-doc";
import { radius, spacing, typography, useLayout, useTheme } from "@/theme";
import {
  Bold,
  ChevronDown,
  ChevronUp,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link,
  List,
  ListOrdered,
  Lock,
  Pilcrow,
  Plus,
  SeparatorHorizontal,
  Trash2,
  Unlink,
} from "@/ui/icons";
import { Button, ButtonRow, Field, Icon, Sheet, Text, type LucideIcon } from "@/ui";

/**
 * Formatted text, edited the way a phone edits text.
 *
 * The document is the web's own HTML (see `rich-doc.ts`), shown as a column of
 * blocks. Each paragraph, heading or list item is one ordinary text field that
 * draws its bold, italic and links in place, so typing, the caret, selection
 * handles, autocorrect and dictation are all the OS's own.
 *
 * A toolbar sits on the block being edited: the block's kind (paragraph,
 * three heading sizes, bullets, numbers), bold, italic and link for the
 * selected text, and move and remove. Enter starts the next block, as it does
 * on the web; Backspace at the start of a block joins it to the one above.
 *
 * Anything the phone cannot edit - a table, a photo, a checklist - is a
 * locked card that keeps its HTML untouched. It can be moved or removed
 * (with a confirmation), never half-edited.
 */

type Selection = { start: number; end: number };

type Pending = { id: string; at: number; marks: Mark[] };

type LinkDraft = {
  id: string;
  start: number;
  end: number;
  href: string;
  /** No text selected and no link under the caret: ask for the words too. */
  needsText: boolean;
  existing: boolean;
};

export function FormattedTextEditor({
  blocks,
  onChange,
  onCommit,
  pageBreaks = false,
  placeholder = "Write here",
  editable = true,
}: {
  blocks: DocBlock[];
  onChange: (next: DocBlock[]) => void;
  /** A block lost focus: the moment to save, as every long field in the app does. */
  onCommit?: () => void;
  /** Offer a page break, which is what an `<hr>` means in a report section. */
  pageBreaks?: boolean;
  placeholder?: string;
  editable?: boolean;
}) {
  const theme = useTheme();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [pending, setPending] = useState<Pending | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState<LinkDraft | null>(null);
  const selections = useRef(new Map<string, Selection>());
  const inputs = useRef(new Map<string, TextInput>());

  /*
   * An empty document still offers somewhere to type. The seed is not part of
   * the document until something is typed into it, and an empty paragraph
   * saves as "", so opening and leaving an empty section writes nothing.
   */
  const seed = useRef<TextBlock>(textBlock("paragraph"));
  const shown = useMemo(() => (blocks.length ? blocks : [seed.current]), [blocks]);

  const numbers = useMemo(() => listNumbers(shown), [shown]);
  const active = shown.find((b) => b.id === activeId) ?? null;

  const selectionOf = useCallback(
    (id: string): Selection => selections.current.get(id) ?? { start: 0, end: 0 },
    [],
  );

  const handleText = useCallback(
    (block: TextBlock, next: string) => {
      const sel = selectionOf(block.id);
      const usePending =
        pending && pending.id === block.id && sel.start === sel.end && pending.at === sel.start
          ? pending.marks
          : null;
      const { runs, change } = applyTextEdit(block.runs, next, { hint: sel, pending: usePending });
      const parts = splitTypedLines(block, runs, change);
      onChange(replaceBlock(shown, block.id, parts));
      const caret = change.start + change.inserted.length;
      selections.current.set(block.id, { start: caret, end: caret });
      if (usePending) setPending(null);
      if (parts.length > 1) {
        const last = parts[parts.length - 1];
        selections.current.set(last.id, { start: 0, end: 0 });
        setFocusId(last.id);
        setActiveId(last.id);
      }
    },
    [onChange, pending, selectionOf, shown],
  );

  /** Backspace at the very start: lift a list item, or join the block to the one above. */
  const handleBackspaceAtStart = useCallback(
    (block: TextBlock) => {
      if (block.kind === "bullet" || block.kind === "number") {
        onChange(setKind(shown, block.id, "paragraph"));
        return;
      }
      const at = shown.findIndex((b) => b.id === block.id);
      const prev = at > 0 ? shown[at - 1] : null;
      if (!prev || !isTextBlock(prev)) return;
      const joinAt = runsText(prev.runs).length;
      const merged: TextBlock = { ...prev, runs: normaliseRuns([...prev.runs, ...block.runs]) };
      onChange(removeDocBlock(replaceBlock(shown, prev.id, [merged]), block.id));
      selections.current.set(prev.id, { start: joinAt, end: joinAt });
      setActiveId(prev.id);
      inputs.current.get(prev.id)?.focus();
    },
    [onChange, shown],
  );

  const activeText = active && isTextBlock(active) ? active : null;

  /** Marks at the caret or over the selection, for the toolbar's pressed state. */
  const isOn = (type: "bold" | "italic"): boolean => {
    if (!activeText) return false;
    if (selection.start === selection.end) {
      const marks =
        pending && pending.id === activeText.id && pending.at === selection.start
          ? pending.marks
          : inheritedMarks(activeText.runs, selection.start);
      return marks.some((m) => m.type === type);
    }
    return hasMark(activeText.runs, selection.start, selection.end, type);
  };

  const toggle = (type: "bold" | "italic") => {
    if (!activeText) return;
    const sel = selectionOf(activeText.id);
    if (sel.start === sel.end) {
      // Nothing selected: the choice applies to what is typed next, here.
      const current =
        pending && pending.id === activeText.id && pending.at === sel.start
          ? pending.marks
          : inheritedMarks(activeText.runs, sel.start);
      const on = current.some((m) => m.type === type);
      setPending({
        id: activeText.id,
        at: sel.start,
        marks: on ? current.filter((m) => m.type !== type) : [...current, { type }],
      });
      return;
    }
    onChange(
      setRuns(shown, activeText.id, toggleMark(activeText.runs, sel.start, sel.end, { type })),
    );
  };

  const openLink = () => {
    if (!activeText) return;
    const sel = selectionOf(activeText.id);
    const existing = linkAt(activeText.runs, sel.start, sel.end);
    setLinkDraft({
      id: activeText.id,
      start: existing ? existing.start : sel.start,
      end: existing ? existing.end : sel.end,
      href: existing?.href ?? "",
      needsText: !existing && sel.start === sel.end,
      existing: Boolean(existing),
    });
  };

  const applyLink = (href: string | null, words: string) => {
    if (!linkDraft) return;
    const block = shown.find((b) => b.id === linkDraft.id);
    if (!block || !isTextBlock(block)) return;
    let runs: Run[];
    if (href && linkDraft.needsText) {
      const base = inheritedMarks(block.runs, linkDraft.start).filter((m) => m.type !== "link");
      runs = replaceRange(block.runs, linkDraft.start, linkDraft.start, words || href, [
        ...base,
        linkMark(href),
      ]);
    } else {
      runs = setLink(block.runs, linkDraft.start, linkDraft.end, href);
    }
    onChange(setRuns(shown, block.id, runs));
    setLinkDraft(null);
  };

  const setActiveKind = (kind: TextKind, level?: number) => {
    if (!activeText) return;
    onChange(setKind(shown, activeText.id, kind, level));
  };

  const removeActive = () => {
    if (!active) return;
    const drop = () => {
      onChange(removeDocBlock(shown, active.id));
      setActiveId(null);
    };
    const empty = isTextBlock(active) && runsText(active.runs).trim() === "";
    if (empty) {
      drop();
      return;
    }
    Alert.alert(
      isTextBlock(active)
        ? "Remove this text?"
        : `Remove this ${rawLabel(active.html).toLowerCase()}?`,
      isTextBlock(active)
        ? "The words in this block are removed from the document when it is saved."
        : "It was made on the web and cannot be rebuilt on the phone once it is gone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: drop },
      ],
    );
  };

  const addText = () => {
    const last = shown[shown.length - 1] ?? null;
    const block = textBlock("paragraph");
    onChange(insertAfter(shown, last?.id ?? null, block));
    setFocusId(block.id);
    setActiveId(block.id);
  };

  const addPageBreak = () => {
    const after = activeId ?? shown[shown.length - 1]?.id ?? null;
    const brk = rawBlock(PAGE_BREAK_HTML);
    const next = textBlock("paragraph");
    onChange(insertAfter(insertAfter(shown, after, brk), brk.id, next));
    setFocusId(next.id);
    setActiveId(next.id);
  };

  const toolbar = (block: DocBlock) => {
    const index = shown.findIndex((b) => b.id === block.id);
    const text = isTextBlock(block) ? block : null;
    const kindIs = (kind: TextKind, level?: number) =>
      text !== null && text.kind === kind && (level === undefined || text.level === level);
    return (
      <Toolbar>
        {text ? (
          <>
            <Tool
              icon={Pilcrow}
              label="Paragraph"
              on={kindIs("paragraph")}
              onPress={() => setActiveKind("paragraph")}
            />
            <Tool
              icon={Heading1}
              label="Large heading"
              on={kindIs("heading", 1)}
              onPress={() => setActiveKind("heading", 1)}
            />
            <Tool
              icon={Heading2}
              label="Heading"
              on={kindIs("heading", 2)}
              onPress={() => setActiveKind("heading", 2)}
            />
            <Tool
              icon={Heading3}
              label="Small heading"
              on={kindIs("heading", 3)}
              onPress={() => setActiveKind("heading", 3)}
            />
            <Tool
              icon={List}
              label="Bulleted list"
              on={kindIs("bullet")}
              onPress={() => setActiveKind("bullet")}
            />
            <Tool
              icon={ListOrdered}
              label="Numbered list"
              on={kindIs("number")}
              onPress={() => setActiveKind("number")}
            />
            <ToolDivider />
            <Tool icon={Bold} label="Bold" on={isOn("bold")} onPress={() => toggle("bold")} />
            <Tool
              icon={Italic}
              label="Italic"
              on={isOn("italic")}
              onPress={() => toggle("italic")}
            />
            <Tool
              icon={Link}
              label="Link"
              on={Boolean(linkAt(text.runs, selection.start, selection.end))}
              onPress={openLink}
            />
            {pageBreaks ? (
              <Tool icon={SeparatorHorizontal} label="Insert a page break" onPress={addPageBreak} />
            ) : null}
            <ToolDivider />
          </>
        ) : null}
        <Tool
          icon={ChevronUp}
          label="Move up"
          disabled={index <= 0}
          onPress={() => onChange(moveDocBlock(shown, block.id, -1))}
        />
        <Tool
          icon={ChevronDown}
          label="Move down"
          disabled={index >= shown.length - 1}
          onPress={() => onChange(moveDocBlock(shown, block.id, 1))}
        />
        <Tool icon={Trash2} label="Remove" tone="destructive" onPress={removeActive} />
      </Toolbar>
    );
  };

  return (
    <View style={{ gap: spacing.sm }}>
      {shown.map((block, index) => {
        const isActive = editable && block.id === activeId;
        if (!isTextBlock(block)) {
          return (
            <View key={block.id} style={{ gap: spacing.xs }}>
              {isActive ? toolbar(block) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${rawLabel(block.html)}, made on the web, read-only here`}
                disabled={!editable}
                onPress={() => {
                  Keyboard.dismiss();
                  setActiveId(block.id);
                }}
                style={{
                  gap: spacing.xs,
                  padding: spacing.md,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderStyle: "dashed",
                  borderColor: isActive ? theme.colors.ring : theme.colors.border,
                  backgroundColor: theme.colors.secondary,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
                  <Icon icon={Lock} size="xs" tone="muted" />
                  <Text variant="overline" tone="muted">
                    {rawLabel(block.html).toUpperCase()}
                  </Text>
                </View>
                {rawPreview(block.html) ? (
                  <Text variant="caption" numberOfLines={3}>
                    {rawPreview(block.html)}
                  </Text>
                ) : null}
                <Text variant="caption" tone="muted">
                  Kept exactly as it is. Change it on the web.
                </Text>
              </Pressable>
            </View>
          );
        }
        const marker =
          block.kind === "bullet"
            ? "\u2022"
            : block.kind === "number"
              ? `${numbers.get(block.id) ?? 1}.`
              : null;
        return (
          <View key={block.id} style={{ gap: spacing.xs }}>
            {isActive ? toolbar(block) : null}
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.sm }}>
              {marker ? (
                <Text variant="body" tone="muted" style={{ minWidth: 22, paddingTop: 1 }}>
                  {marker}
                </Text>
              ) : null}
              <TextInput
                ref={(ref) => {
                  if (ref) inputs.current.set(block.id, ref);
                  else inputs.current.delete(block.id);
                }}
                accessibilityLabel={blockLabel(block)}
                multiline
                scrollEnabled={false}
                editable={editable}
                autoFocus={block.id === focusId}
                placeholder={index === 0 && shown.length === 1 ? placeholder : undefined}
                placeholderTextColor={theme.colors.mutedForeground}
                onFocus={() => {
                  setActiveId(block.id);
                  setSelection(selectionOf(block.id));
                }}
                onBlur={() => onCommit?.()}
                onChangeText={(next) => handleText(block, next)}
                onSelectionChange={(event) => {
                  const sel = event.nativeEvent.selection;
                  selections.current.set(block.id, sel);
                  if (block.id === activeId) setSelection(sel);
                }}
                onKeyPress={(event) => {
                  if (event.nativeEvent.key !== "Backspace") return;
                  const sel = selectionOf(block.id);
                  if (sel.start === 0 && sel.end === 0) handleBackspaceAtStart(block);
                }}
                style={[
                  blockStyle(block),
                  {
                    flex: 1,
                    color: theme.colors.foreground,
                    paddingVertical: spacing.xs,
                    paddingHorizontal: 0,
                    borderBottomWidth: isActive ? 1 : 0,
                    borderBottomColor: theme.colors.ring,
                    textAlignVertical: "top",
                  },
                ]}
              >
                {block.runs.map((run, i) => (
                  <RNText key={i} style={markStyle(run.marks, theme.colors.primary)}>
                    {run.text}
                  </RNText>
                ))}
              </TextInput>
            </View>
          </View>
        );
      })}

      {editable ? (
        <ButtonRow>
          <Button label="Add text" icon={Plus} variant="secondary" size="sm" onPress={addText} />
          {pageBreaks ? (
            <Button
              label="Page break"
              icon={SeparatorHorizontal}
              variant="secondary"
              size="sm"
              onPress={addPageBreak}
            />
          ) : null}
        </ButtonRow>
      ) : null}

      <LinkSheet draft={linkDraft} onClose={() => setLinkDraft(null)} onApply={applyLink} />
    </View>
  );
}

/** The number each numbered-list item shows, honouring `start` on the list. */
function listNumbers(blocks: readonly DocBlock[]): Map<string, number> {
  const out = new Map<string, number>();
  let listId: string | null = null;
  let n = 0;
  for (const block of blocks) {
    if (!isTextBlock(block) || block.kind !== "number") {
      listId = null;
      continue;
    }
    if (block.listId !== listId) {
      listId = block.listId;
      const start = /\sstart\s*=\s*"?(\d+)/i.exec(block.listAttrs);
      n = start ? Number(start[1]) : 1;
    } else {
      n += 1;
    }
    out.set(block.id, n);
  }
  return out;
}

function blockLabel(block: TextBlock): string {
  switch (block.kind) {
    case "heading":
      return `Heading ${block.level}`;
    case "bullet":
      return "Bulleted item";
    case "number":
      return "Numbered item";
    default:
      return "Paragraph";
  }
}

function blockStyle(block: TextBlock): StyleProp<TextStyle> {
  if (block.kind !== "heading") return typography.body;
  if (block.level <= 1) return typography.title;
  if (block.level === 2) return typography.heading;
  return { ...typography.bodyStrong, fontSize: 17 };
}

function markStyle(marks: readonly Mark[], linkColor: string): StyleProp<TextStyle> {
  const style: TextStyle = {};
  const lines: string[] = [];
  for (const mark of marks) {
    if (mark.type === "bold") style.fontWeight = "700";
    if (mark.type === "italic") style.fontStyle = "italic";
    if (mark.type === "code") style.fontFamily = "monospace";
    if (mark.type === "underline") lines.push("underline");
    if (mark.type === "strike") lines.push("line-through");
    if (mark.type === "link") {
      style.color = linkColor;
      lines.push("underline");
    }
  }
  if (lines.length) {
    style.textDecorationLine =
      lines.includes("underline") && lines.includes("line-through")
        ? "underline line-through"
        : (lines[0] as TextStyle["textDecorationLine"]);
  }
  return style;
}

/** The toolbar row. Scrolls sideways on a narrow phone rather than wrapping. */
function Toolbar({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const layout = useLayout();
  return (
    <View
      style={{
        borderRadius: radius.md,
        backgroundColor: theme.colors.secondary,
        // A tablet has the room to keep the block actions at the right edge.
        alignSelf: layout.tablet ? "stretch" : undefined,
      }}
    >
      <ScrollView
        horizontal
        // Taps on a tool must not dismiss the keyboard or move focus away from
        // the text, or the selection they act on is gone before they run.
        keyboardShouldPersistTaps="always"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          flexGrow: 1,
          alignItems: "center",
          paddingHorizontal: spacing.xs,
          gap: 2,
        }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

function ToolDivider() {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 1,
        height: 24,
        marginHorizontal: spacing.xs,
        backgroundColor: theme.colors.border,
      }}
    />
  );
}

function Tool({
  icon,
  label,
  on = false,
  disabled = false,
  tone,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  on?: boolean;
  disabled?: boolean;
  tone?: "destructive";
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: radius.sm,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: on ? theme.colors.accent : "transparent",
        opacity: disabled ? 0.35 : pressed ? 0.6 : 1,
      })}
    >
      <Icon icon={icon} size="md" tone={tone ?? (on ? "primary" : "default")} />
    </Pressable>
  );
}

/** Add, change or remove a link. */
function LinkSheet({
  draft,
  onClose,
  onApply,
}: {
  draft: LinkDraft | null;
  onClose: () => void;
  onApply: (href: string | null, words: string) => void;
}) {
  const [href, setHref] = useState("");
  const [words, setWords] = useState("");
  const [seenFor, setSeenFor] = useState<LinkDraft | null>(null);
  // Re-seed each time it opens, so a cancelled edit does not carry over.
  if (draft !== seenFor) {
    setSeenFor(draft);
    setHref(draft?.href ?? "");
    setWords("");
  }
  const target = normaliseHref(href);
  return (
    <Sheet
      visible={draft !== null}
      onClose={onClose}
      title={draft?.existing ? "Edit link" : "Add a link"}
      subtitle="A web address, an email or a phone number."
    >
      <View style={{ gap: spacing.lg }}>
        {draft?.needsText ? (
          <Field
            label="Text to show"
            value={words}
            onChangeText={setWords}
            placeholder="Our website"
          />
        ) : null}
        <Field
          label="Link to"
          value={href}
          onChangeText={setHref}
          placeholder="example.com"
          keyboardType="url"
          autoCapitalize="none"
          returnKeyType="done"
          onSubmitEditing={() => target && onApply(target, words.trim())}
        />
        <ButtonRow>
          {draft?.existing ? (
            <Button
              label="Remove link"
              icon={Unlink}
              variant="destructive"
              onPress={() => onApply(null, "")}
            />
          ) : null}
          <Button
            label="Save link"
            icon={Link}
            disabled={!target}
            onPress={() => onApply(target, words.trim())}
          />
        </ButtonRow>
      </View>
    </Sheet>
  );
}
