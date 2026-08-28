import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useQueue } from "@/offline/use-queue";
import { radius, spacing, useTheme } from "@/theme";
import { ChevronRight, CloudUpload, TriangleAlert } from "@/ui/icons";
import { Icon, Text } from "@/ui";

/**
 * Standing indicator that work is still on the phone.
 *
 * Deliberately not a toast. A toast is gone in three seconds, and the thing it
 * would be reporting can outlive a whole drive back from site. Until the queue
 * is empty the user should be able to look at any screen and see that their
 * photos have not been delivered yet, and tap through to find out why.
 *
 * The icon and chevron are the part that changed. This was two lines of text on
 * a coloured block, which reads as a notice rather than a control, so nobody
 * tapped it. A cloud on the left says what it is about and a chevron on the
 * right says it goes somewhere.
 *
 * The wording says "change", not "photo". The outbox began as a photo queue and
 * the copy was written for that, but it now also carries task creates and
 * edits, checklist and workflow answers, and bulk photo edits. Adding a task on
 * site made the banner announce "1 photo waiting to upload", which is a lie
 * about work the person can see they did not do. Nothing in the type system
 * catches copy drifting away from what the code does; this was found by adding
 * a task on a device and reading the banner.
 */
export function QueueBanner() {
  const { pending, sending, failed, outstanding } = useQueue();
  const theme = useTheme();

  if (outstanding === 0) return null;

  const hasFailures = failed > 0;
  const waiting = pending + sending;

  /*
   * Both fills are palette colours with a matching foreground token, so the
   * text colour is not a judgement call: amber takes the dark ink, red takes
   * the light one, and dark mode does not change either.
   */
  const ink = hasFailures ? theme.colors.destructiveForeground : theme.colors.safetyForeground;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        hasFailures
          ? `${failed} changes need attention. Opens the upload queue.`
          : `${waiting} changes waiting to send. Opens the upload queue.`
      }
      onPress={() => router.push("/queue")}
      style={({ pressed }) => [
        styles.root,
        {
          backgroundColor: hasFailures ? theme.colors.destructive : theme.colors.safety,
          borderColor: theme.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <Icon icon={hasFailures ? TriangleAlert : CloudUpload} size="md" color={ink} />

      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" style={{ color: ink }}>
          {hasFailures
            ? `${failed} change${failed === 1 ? "" : "s"} need attention`
            : `${waiting} change${waiting === 1 ? "" : "s"} waiting to send`}
        </Text>
        <Text variant="caption" style={{ color: ink, opacity: 0.85 }}>
          {hasFailures && waiting > 0
            ? `${waiting} still queued. Tap to review.`
            : hasFailures
              ? "Tap to retry or discard."
              : "Saved on this phone. They will send when you have signal."}
        </Text>
      </View>

      <Icon icon={ChevronRight} size="md" color={ink} />
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
