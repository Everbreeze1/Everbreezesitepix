import { Children, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cardColumns, cardPageInset, radius, spacing, useTheme } from "@/theme";
import { ChevronLeft, EllipsisVertical } from "./icons";
import { Card } from "./Card";
import { IconButton } from "./Button";
import { Icon, type LucideIcon } from "./Icon";
import { ProgressBar } from "./Progress";
import { Text } from "./Text";

/**
 * The furniture every page inside a project shares.
 *
 * Checklists, Workflows, Tasks, Site logs, Documents and Trash each grew their
 * own header, their own card and their own idea of where "New" goes: one had a
 * plus in the nav bar, one a button under the list, one both on a tablet and
 * neither on a phone. Opened one after another from the project's tab row they
 * read as six different apps. These pieces are the one shape they now share:
 *
 * - `SubPageHeader`: Back, the project's name as context, the page's title and
 *   a one-line summary (counts, progress), with the page's secondary actions
 *   in a kebab at the right. The primary "New ..." is not here: it is the
 *   `ActionRail` button at the lower right, where the thumb already is.
 * - `ItemCard`: icon tile, title, meta line, status chip, optional progress.
 * - `StatusChip`: the one status pill, sentence case, soft tint.
 * - `CardGrid` and `useCardPage`: one column on a phone, two on a tablet,
 *   centred and capped so nothing stretches edge to edge.
 */

/** Page gutter and column count for the current window. Re-read on rotation. */
export function useCardPage(): { inset: number; columns: number; width: number } {
  const { width } = useWindowDimensions();
  return { inset: cardPageInset(width, spacing.lg), columns: cardColumns(width), width };
}

export function SubPageHeader({
  context,
  title,
  summary,
  progress,
  onBack,
  backLabel = "Back",
  actions,
  children,
}: {
  /** What this page belongs to, set small above the title: the project's name. */
  context?: string | null;
  title: string;
  /** One line under the title: counts, progress, what needs doing. */
  summary?: string | null;
  /** Overall progress, drawn as a slim bar under the summary. */
  progress?: { value: number; total: number; tone?: "primary" | "success" } | null;
  onBack: () => void;
  backLabel?: string;
  /** Icon buttons at the right of the back row, usually one `KebabButton`. */
  actions?: ReactNode;
  /** Pinned under the title: a filter chip row. Laid out edge to edge. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { inset } = useCardPage();

  return (
    <View
      style={{
        paddingTop: insets.top + spacing.xs,
        paddingBottom: spacing.md,
        backgroundColor: theme.colors.background,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
        gap: spacing.md,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.xs,
          paddingHorizontal: inset - spacing.xs,
        }}
      >
        <IconButton icon={ChevronLeft} accessibilityLabel={backLabel} onPress={onBack} />
        <View style={{ flex: 1 }} />
        {actions}
      </View>

      <View style={{ paddingHorizontal: inset, gap: 2 }}>
        {context ? (
          <Text variant="overline" tone="primary" numberOfLines={1}>
            {context.toUpperCase()}
          </Text>
        ) : null}
        <Text variant="title" numberOfLines={2} accessibilityRole="header">
          {title}
        </Text>
        {summary ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {summary}
          </Text>
        ) : null}
        {progress && progress.total > 0 ? (
          <View style={{ marginTop: spacing.sm }}>
            <ProgressBar
              value={progress.value}
              total={progress.total}
              tone={progress.tone ?? "primary"}
            />
          </View>
        ) : null}
      </View>

      {/*
        `ChipGroup` pads itself by `spacing.lg`, so the wrapper supplies only
        the difference: on a tablet the chips line up under the title rather
        than starting at the screen edge.
      */}
      {children ? <View style={{ paddingHorizontal: inset - spacing.lg }}>{children}</View> : null}
    </View>
  );
}

/** The kebab: a page's or a card's secondary actions, behind one tap. */
export function KebabButton({
  accessibilityLabel = "More actions",
  onPress,
  surface = true,
}: {
  accessibilityLabel?: string;
  onPress: () => void;
  surface?: boolean;
}) {
  return (
    <IconButton
      icon={EllipsisVertical}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      surface={surface}
      tone={surface ? "default" : "muted"}
    />
  );
}

export type StatusTone = "neutral" | "primary" | "success" | "warning" | "danger";

/**
 * A state, read at a glance: Active, Done, 3 open, Overdue.
 *
 * Sentence case in a soft tint, where `Badge` is an uppercase overline. The
 * project list and the designer's mockups set status this way, and a chip
 * that shouts in capitals on every card of a list is noise by the third card.
 */
export function StatusChip({
  label,
  tone = "neutral",
  icon,
}: {
  label: string;
  tone?: StatusTone;
  icon?: LucideIcon;
}) {
  const theme = useTheme();
  const ink = {
    neutral: theme.colors.mutedForeground,
    primary: theme.colors.primary,
    success: theme.colors.success,
    // The safety amber is too light to read as text on a light card.
    warning: theme.scheme === "dark" ? theme.colors.safety : "#9a6412",
    danger: theme.colors.destructive,
  }[tone];
  const fill = {
    neutral: theme.colors.secondary,
    primary: tint(theme.colors.primary, theme.scheme === "dark" ? 0.22 : 0.12),
    success: tint(theme.colors.success, theme.scheme === "dark" ? 0.22 : 0.12),
    warning: tint(theme.colors.safety, theme.scheme === "dark" ? 0.22 : 0.2),
    danger: tint(theme.colors.destructive, theme.scheme === "dark" ? 0.22 : 0.1),
  }[tone];

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        alignSelf: "flex-start",
        height: 26,
        paddingHorizontal: 10,
        borderRadius: radius.pill,
        backgroundColor: fill,
      }}
    >
      {icon ? <Icon icon={icon} size="xs" color={ink} /> : null}
      <Text variant="caption" numberOfLines={1} style={{ color: ink, fontWeight: "700" }}>
        {label}
      </Text>
    </View>
  );
}

/**
 * One thing on a project page: a checklist, a workflow, a task, a site log.
 *
 * The whole card opens it. `onMenu` adds a kebab for the card's own secondary
 * actions (delete, move, copy), which is where the rows of three icon buttons
 * that used to crowd the title went.
 */
export function ItemCard({
  icon,
  iconTone = "primary",
  title,
  titleDone = false,
  meta,
  status,
  progress,
  onPress,
  accessibilityLabel,
  onMenu,
  menuLabel,
  children,
}: {
  icon: LucideIcon;
  iconTone?: "primary" | "success" | "muted";
  title: string;
  /** Strikes the title through, for a finished task. */
  titleDone?: boolean;
  meta?: string | null;
  /** Usually a `StatusChip`, top right. */
  status?: ReactNode;
  progress?: {
    value: number;
    total: number;
    label?: string;
    tone?: "primary" | "success";
  } | null;
  onPress?: () => void;
  accessibilityLabel?: string;
  onMenu?: () => void;
  menuLabel?: string;
  /** Anything below the meta line: assignee, badges. */
  children?: ReactNode;
}) {
  const theme = useTheme();
  const tileFill =
    iconTone === "success"
      ? tint(theme.colors.success, theme.scheme === "dark" ? 0.22 : 0.12)
      : iconTone === "muted"
        ? theme.colors.secondary
        : theme.colors.accent;
  const tileInk =
    iconTone === "success"
      ? theme.colors.success
      : iconTone === "muted"
        ? theme.colors.mutedForeground
        : theme.colors.primary;

  return (
    <Card onPress={onPress} accessibilityLabel={accessibilityLabel ?? title}>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: radius.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: tileFill,
          }}
        >
          <Icon icon={icon} size="md" color={tileInk} />
        </View>

        <View style={{ flex: 1, gap: 2, minHeight: 44, justifyContent: "center" }}>
          <Text
            variant="bodyStrong"
            numberOfLines={2}
            tone={titleDone ? "muted" : "default"}
            style={titleDone ? { textDecorationLine: "line-through" } : undefined}
          >
            {title}
          </Text>
          {meta ? (
            <Text variant="caption" tone="muted" numberOfLines={2}>
              {meta}
            </Text>
          ) : null}
        </View>

        {status || onMenu ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            {status}
            {onMenu ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={menuLabel ?? `More actions for ${title}`}
                onPress={onMenu}
                hitSlop={10}
                style={({ pressed }) => ({
                  width: 32,
                  height: 32,
                  marginRight: -spacing.sm,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? theme.colors.secondary : "transparent",
                })}
              >
                <Icon icon={EllipsisVertical} size="md" tone="muted" />
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>

      {children ? <View style={{ marginTop: spacing.md, gap: spacing.sm }}>{children}</View> : null}

      {progress ? (
        <View style={{ marginTop: spacing.md }}>
          <ProgressBar
            value={progress.value}
            total={progress.total}
            tone={progress.tone ?? "primary"}
            showLabel
            label={progress.label}
          />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Cards one across on a phone and two across on a tablet, with equal gutters.
 *
 * Widths are computed rather than set as percentages: a percentage plus a
 * `gap` overflows the row by the gap, and the second card wraps under the
 * first, which is a one-column layout that only looks broken on an iPad.
 */
export function CardGrid({ children }: { children: ReactNode }) {
  const { inset, columns, width } = useCardPage();
  const items = Children.toArray(children);
  const gap = spacing.md;
  const cell = columns === 1 ? undefined : (width - inset * 2 - gap * (columns - 1)) / columns;

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap }}>
      {items.map((child, index) => (
        <View
          key={isValidElement(child) && child.key != null ? child.key : index}
          style={{ width: cell ?? "100%" }}
        >
          {child}
        </View>
      ))}
    </View>
  );
}

function tint(hex: string, alpha: number): string {
  if (!hex.startsWith("#") || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
