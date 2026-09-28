import { Pressable, View } from "react-native";
import type { ReportIndexStatus } from "@/api/report-index-view";
import { reportStatusLabel } from "@/api/report-index-view";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { EllipsisVertical, FileText, Images, LayoutTemplate } from "@/ui/icons";
import { Icon, PhotoThumb, Text } from "@/ui";

/**
 * One report, as the web's Reports list draws it: a photo on the left, then
 * the title, the blueprint that made it, "job · date", and one line of the
 * write-up. Everything else (the link, the PDF, turning sharing off, delete)
 * sits behind the kebab, which is what keeps a list of twenty reports a list
 * rather than a control panel.
 *
 * Shared by the workspace Reports screen and a project's own Reports list so
 * the two read as one list seen from two places.
 *
 * The title wraps to two lines rather than truncating. Reports are named after
 * the job and the date, so the distinguishing half of a title is its end, and
 * a one-line truncation cuts exactly that off.
 *
 * The status pill only appears when it says something worth stopping for: a
 * draft, or a link that is off. "Shared" is the normal state of a finished
 * report and a pill on every row saying so was noise.
 */
export function ReportCard({
  title,
  subtitle,
  status,
  onPress,
  onMenu,
  excerpt,
  thumbUri,
  blueprint,
  isPage = false,
}: {
  title: string;
  subtitle: string;
  /** The first line or two of the write-up, already stripped of markup. */
  excerpt?: string | null;
  status: ReportIndexStatus;
  onPress: () => void;
  /** Opens the row's actions. No kebab is drawn without it. */
  onMenu?: () => void;
  /** The report's cover or first section photo, signed. */
  thumbUri?: string | null;
  /** The blueprint that produced it, for the chip beside the title. */
  blueprint?: string | null;
  /** A report page rather than a built report: drawn with a document glyph. */
  isPage?: boolean;
}) {
  const theme = useTheme();
  const flagged = status !== "shared";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={flagged ? `${title}, ${reportStatusLabel(status)}` : title}
      accessibilityHint={subtitle}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "stretch",
        minHeight: 96,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
        overflow: "hidden",
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 96,
          backgroundColor: theme.colors.secondary,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {thumbUri ? (
          <PhotoThumb uri={thumbUri} width={96} height="100%" rounded={0} />
        ) : (
          <Icon icon={isPage ? FileText : Images} size="lg" tone="muted" />
        )}
      </View>

      <View
        style={{
          flex: 1,
          minWidth: 0,
          paddingVertical: spacing.md,
          paddingLeft: spacing.md,
          gap: 4,
        }}
      >
        <Text variant="bodyStrong" numberOfLines={2}>
          {title}
        </Text>
        {blueprint || flagged ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
            {blueprint ? <BlueprintChip name={blueprint} /> : null}
            {flagged ? <ReportStatusPill status={status} /> : null}
          </View>
        ) : null}
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {excerpt ? (
          <Text
            variant="caption"
            numberOfLines={1}
            style={{ color: theme.colors.secondaryForeground }}
          >
            {excerpt}
          </Text>
        ) : null}
      </View>

      {onMenu ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`More actions for ${title}`}
          hitSlop={4}
          onPress={onMenu}
          style={({ pressed }) => ({
            width: HIT_TARGET - 8,
            minHeight: HIT_TARGET,
            alignItems: "center",
            paddingTop: spacing.md,
            opacity: pressed ? 0.5 : 1,
          })}
        >
          <Icon icon={EllipsisVertical} size="sm" tone="muted" />
        </Pressable>
      ) : (
        <View style={{ width: spacing.md }} />
      )}
    </Pressable>
  );
}

/** The web's blueprint badge: a small outlined chip with the template glyph. */
function BlueprintChip({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        maxWidth: "100%",
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.background,
      }}
    >
      <Icon icon={LayoutTemplate} size="xs" tone="muted" />
      <Text variant="caption" numberOfLines={1} style={{ fontSize: 11, fontWeight: "600" }}>
        {name}
      </Text>
    </View>
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
        paddingHorizontal: spacing.sm,
        paddingVertical: 2,
        borderRadius: radius.pill,
        backgroundColor: background,
      }}
    >
      <Text variant="caption" numberOfLines={1} style={{ color, fontWeight: "700", fontSize: 11 }}>
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
