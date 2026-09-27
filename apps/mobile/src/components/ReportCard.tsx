import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import type { ReportIndexStatus } from "@/api/report-index-view";
import { reportStatusLabel } from "@/api/report-index-view";
import { radius, spacing, useTheme } from "@/theme";
import { FileText } from "@/ui/icons";
import { Icon, Text } from "@/ui";

/**
 * One report, as the Reports design draws it: a tinted icon tile, the title in
 * bold, a "job · date" line, and a status pill in the top right.
 *
 * Shared by the workspace Reports screen and a project's own Reports list so
 * the two read as one list seen from two places.
 *
 * The title wraps to two lines rather than truncating. Reports are named after
 * the job and the date, so the distinguishing half of a title is its end, and
 * a one-line truncation cuts exactly that off.
 */
export function ReportCard({
  title,
  subtitle,
  status,
  onPress,
  accessory,
}: {
  title: string;
  subtitle: string;
  status: ReportIndexStatus;
  onPress: () => void;
  /** Row-scoped controls under the pill, such as delete. */
  accessory?: ReactNode;
}) {
  const theme = useTheme();
  const draft = status === "draft";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${reportStatusLabel(status)}`}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: spacing.md,
        padding: spacing.lg,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: radius.md,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: draft ? theme.colors.accent : theme.colors.secondary,
        }}
      >
        <Icon icon={FileText} size="md" tone={draft ? "primary" : "muted"} />
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      <View style={{ alignItems: "flex-end", gap: spacing.xs }}>
        <ReportStatusPill status={status} />
        {accessory}
      </View>
    </Pressable>
  );
}

/**
 * Draft amber, Shared green, Link off grey.
 *
 * Drawn here rather than with `Badge`: the design's amber pill carries dark
 * amber text, and `Badge`'s warning tone sets its label in the fill colour,
 * which on the cream canvas measures well under 2:1.
 */
export function ReportStatusPill({ status }: { status: ReportIndexStatus }) {
  const theme = useTheme();
  const dark = theme.scheme === "dark";
  const [background, color] =
    status === "draft"
      ? [withAlpha(theme.colors.safety, dark ? 0.22 : 0.3), theme.colors.accentForeground]
      : status === "shared"
        ? [withAlpha(theme.colors.success, dark ? 0.22 : 0.15), theme.colors.success]
        : [theme.colors.muted, theme.colors.mutedForeground];

  return (
    <View
      style={{
        paddingHorizontal: spacing.md,
        paddingVertical: 4,
        borderRadius: radius.pill,
        backgroundColor: background,
      }}
    >
      <Text variant="caption" numberOfLines={1} style={{ color, fontWeight: "700" }}>
        {reportStatusLabel(status)}
      </Text>
    </View>
  );
}

function withAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return hex;
  const value = parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
