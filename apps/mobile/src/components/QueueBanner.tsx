import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { useQueue } from "@/offline/use-queue";
import { radius, spacing, typography, useTheme } from "@/theme";

/**
 * Standing indicator that work is still on the phone.
 *
 * Deliberately not a toast. A toast is gone in three seconds, and the thing it
 * would be reporting can outlive a whole drive back from site. Until the queue
 * is empty the user should be able to look at any screen and see that their
 * photos have not been delivered yet, and tap through to find out why.
 */
export function QueueBanner() {
  const { pending, sending, failed, outstanding } = useQueue();
  const theme = useTheme();

  if (outstanding === 0) return null;

  const hasFailures = failed > 0;
  const waiting = pending + sending;

  return (
    <Pressable
      onPress={() => router.push("/queue")}
      style={[
        styles.root,
        {
          backgroundColor: hasFailures ? theme.colors.destructive : theme.colors.safety,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          style={[
            typography.bodyStrong,
            {
              color: hasFailures
                ? theme.colors.destructiveForeground
                : theme.colors.safetyForeground,
            },
          ]}
        >
          {hasFailures
            ? `${failed} upload${failed === 1 ? "" : "s"} need attention`
            : `${waiting} photo${waiting === 1 ? "" : "s"} waiting to upload`}
        </Text>
        <Text
          style={[
            typography.caption,
            {
              color: hasFailures
                ? theme.colors.destructiveForeground
                : theme.colors.safetyForeground,
              opacity: 0.85,
            },
          ]}
        >
          {hasFailures && waiting > 0
            ? `${waiting} still queued. Tap to review.`
            : hasFailures
              ? "Tap to retry or discard."
              : "Saved on this phone. They will send when you have signal."}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
