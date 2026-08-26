import { View } from "react-native";
import { radius, spacing, useTheme } from "@/theme";
import { Text } from "./Text";

/**
 * Progress along a known total.
 *
 * Checklists, workflow phases, and the upload queue all report "x of y", and
 * all three were printing it as text alone. A bar is worth adding because the
 * question a person actually has is "am I nearly done", and that is answered
 * faster by a length than by arithmetic on two numbers.
 */
export function ProgressBar({
  value,
  total,
  tone = "primary",
  showLabel = false,
  label,
}: {
  value: number;
  total: number;
  tone?: "primary" | "success" | "safety";
  showLabel?: boolean;
  /** Overrides the default "3 of 8" reading. */
  label?: string;
}) {
  const theme = useTheme();
  // A total of zero is a real state (an empty checklist), and dividing by it
  // gives NaN, which React Native renders as a zero-width bar with a warning.
  const ratio = total > 0 ? Math.min(1, Math.max(0, value / total)) : 0;
  const fill =
    tone === "success"
      ? theme.colors.success
      : tone === "safety"
        ? theme.colors.safety
        : theme.colors.primary;

  return (
    <View style={{ gap: spacing.xs }} accessible accessibilityRole="progressbar">
      {showLabel ? (
        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
          <Text variant="caption" tone="muted">
            {label ?? `${value} of ${total}`}
          </Text>
          <Text variant="caption" tone="muted">
            {Math.round(ratio * 100)}%
          </Text>
        </View>
      ) : null}
      <View
        style={{
          height: 6,
          borderRadius: radius.pill,
          backgroundColor: theme.colors.secondary,
          overflow: "hidden",
        }}
      >
        <View style={{ width: `${ratio * 100}%`, height: "100%", backgroundColor: fill }} />
      </View>
    </View>
  );
}

/**
 * One segment per step, for a workflow with a handful of named phases.
 *
 * A continuous bar hides how many steps there are. When the count is small and
 * the steps have names, showing them as separate blocks tells the person how
 * much is left in units they recognise.
 */
export function StepProgress({ steps, currentIndex }: { steps: string[]; currentIndex: number }) {
  const theme = useTheme();
  return (
    <View
      style={{ flexDirection: "row", gap: 3 }}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${currentIndex + 1} of ${steps.length}: ${steps[currentIndex] ?? ""}`}
    >
      {steps.map((step, i) => (
        <View
          key={`${step}-${i}`}
          style={{
            flex: 1,
            height: 5,
            borderRadius: radius.pill,
            backgroundColor:
              i < currentIndex
                ? theme.colors.success
                : i === currentIndex
                  ? theme.colors.primary
                  : theme.colors.secondary,
          }}
        />
      ))}
    </View>
  );
}
