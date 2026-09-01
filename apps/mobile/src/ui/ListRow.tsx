import type { ReactNode } from "react";
import { ChevronRight } from "@/ui/icons";
import { Pressable, View } from "react-native";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { Icon, type LucideIcon } from "./Icon";
import { Text } from "./Text";

/**
 * The navigation row: icon, label, optional value, chevron.
 *
 * The chevron can be turned off for a row that already carries its own trailing
 * controls, where it is a fourth thing competing with the title for the line.
 *
 * This is the single most repeated shape in the app. The project screen stacks
 * six of them (Checklists, Tasks, Workflows, Walkthroughs and the rest) and the
 * account screen has four more, and until now each screen drew its own at a
 * different height. On a list of six, an inconsistent row height is visible
 * even to someone who is not looking for it.
 *
 * The chevron is drawn here rather than passed in, because a row that navigates
 * and a row that toggles must not look the same, and the way to guarantee that
 * is to let the presence of `onPress` decide.
 */

export type ListRowProps = {
  icon?: LucideIcon;
  iconTone?: "primary" | "muted" | "safety" | "success" | "destructive";
  title: string;
  subtitle?: string;
  /** Right-hand text, for a count or a status word. */
  value?: string;
  /** Anything richer than `value`: a badge, a switch, a small avatar stack. */
  right?: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  /**
   * Not yet read: a dot and a tinted ground.
   *
   * Two signals rather than one because either alone is unreliable. A dot is
   * easy to miss on a scrolling list held at arm's length in daylight, and a
   * tint alone disappears entirely for anyone who cannot separate it from the
   * card behind it. Weight on the title is deliberately not the third, because
   * `bodyStrong` is already what a row title uses.
   */
  unread?: boolean;
  /**
   * Draw the trailing chevron. On by default, because a tappable row should
   * look tappable.
   *
   * Turned off where the row already carries its own explicit controls. The
   * checklist-template item row had three icon buttons plus this chevron, four
   * things competing with the title for one line, and the title lost: items
   * read "Overall structural c..." with no way to tell them apart. A chevron
   * next to three buttons is the least informative of the four.
   */
  chevron?: boolean;
  accessibilityHint?: string;
};

export function ListRow({
  icon,
  iconTone = "primary",
  title,
  subtitle,
  value,
  right,
  onPress,
  disabled = false,
  destructive = false,
  unread = false,
  chevron = true,
  accessibilityHint,
}: ListRowProps) {
  const theme = useTheme();

  const body = (
    <>
      {icon ? (
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: theme.colors.secondary,
          }}
        >
          <Icon icon={icon} size="md" tone={destructive ? "destructive" : iconTone} />
        </View>
      ) : null}
      {/*
        `minWidth: 0` is what actually lets the title truncate instead of
        shoving the row. A flex child defaults to its content width as its
        minimum, so a long title pushes the badge and chevron off the end rather
        than shortening itself, and the first fix people reach for
        (`numberOfLines={1}`) then bites far too early because the text block is
        still being measured against the width it wanted.
      */}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        {/*
          Two lines, not one. "Team and collaborators" next to a Web chip and a
          chevron came out as "Team and collabo..." on a 6 inch screen, which is
          the row failing at the one job it has.
        */}
        <Text variant="bodyStrong" tone={destructive ? "destructive" : "default"} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {/* Never shrinks: a badge that gets compressed to a sliver is worse than one that wraps the title. */}
      {right ? <View style={{ flexShrink: 0 }}>{right}</View> : null}
      {unread ? (
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            flexShrink: 0,
            backgroundColor: theme.colors.primary,
          }}
        />
      ) : null}
      {onPress && chevron ? <Icon icon={ChevronRight} size="md" tone="muted" /> : null}
    </>
  );

  const layout = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: spacing.md,
    minHeight: HIT_TARGET + spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    opacity: disabled ? 0.45 : 1,
    // `accent` and not `secondary`, which is what a pressed row uses. Sharing
    // one colour would make every unread row look permanently held down.
    backgroundColor: unread ? theme.colors.accent : "transparent",
  };

  if (!onPress) return <View style={layout}>{body}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      /*
        Unread is announced, not just drawn. A screen reader gets the dot as
        nothing at all otherwise, which is the one piece of information the row
        exists to carry.
      */
      accessibilityLabel={[unread ? "Unread." : null, title, subtitle].filter(Boolean).join(". ")}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        layout,
        pressed ? { backgroundColor: theme.colors.secondary } : null,
      ]}
    >
      {body}
    </Pressable>
  );
}

/**
 * Groups rows into one bordered block with hairlines between them.
 *
 * A separate card per row is the other common way to do this, and it costs
 * roughly 12pt of vertical space per row. On a settings screen with ten rows
 * that is a whole extra screenful of scrolling bought no information.
 */
export function ListGroup({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.colors.card,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        overflow: "hidden",
      }}
    >
      {children}
    </View>
  );
}

/** Hairline between rows in a `ListGroup`, inset to clear the icon column. */
export function RowDivider({ inset = true }: { inset?: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        height: 1,
        backgroundColor: theme.colors.border,
        marginLeft: inset ? spacing.lg + 36 + spacing.md : 0,
      }}
    />
  );
}
