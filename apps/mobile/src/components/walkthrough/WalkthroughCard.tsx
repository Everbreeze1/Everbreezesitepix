import { Pressable, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { relativeTime } from "@everlumen/shared";
import type { WalkthroughSummary } from "@/api/walkthroughs";
import {
  aiSummaryLabel,
  aiSummaryTone,
  clockDuration,
  type AiSummaryStatus,
} from "@/api/walkthrough-list-view";
import { radius, spacing, useTheme } from "@/theme";
import { FileText, Play, Sparkles, Video, VideoOff } from "@/ui/icons";
import { Badge, Button, Icon, Text } from "@/ui";

/**
 * One walkthrough, as the two things it is.
 *
 * The top half is the recording: a poster frame with a play badge and its
 * length, so it reads as a video before anything is read. The bottom half is
 * the AI Summary: its state in one word and, once written, its first line.
 * Two buttons at the foot say the same thing a third time in verbs, one per
 * half, so neither part is hidden behind the other.
 */
export function WalkthroughCard({
  walkthrough,
  status,
  firstLine,
  author,
  onWatch,
  onRead,
}: {
  walkthrough: WalkthroughSummary;
  status: AiSummaryStatus;
  firstLine: string;
  author: string | null;
  onWatch: () => void;
  onRead: () => void;
}) {
  const theme = useTheme();
  const hasVideo = Boolean(walkthrough.video_path);
  const duration = clockDuration(walkthrough.duration_seconds);
  const photos = walkthrough.photo_count ?? 0;

  const meta = [
    relativeTime(walkthrough.created_at),
    author ? `by ${author}` : null,
    photos > 0 ? `${photos} photo${photos === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const summaryLine =
    status === "ready"
      ? firstLine || "Written up and ready to read."
      : status === "generating"
        ? "Being written from what was said on the walk."
        : status === "failed"
          ? "The last attempt failed. Open it to try again."
          : "Not written yet. Generate it from the recording.";

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
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          hasVideo
            ? `Watch ${walkthrough.title}${duration ? `, ${duration}` : ""}`
            : `${walkthrough.title}, no video`
        }
        onPress={onWatch}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <View
          style={{
            width: "100%",
            aspectRatio: 16 / 9,
            backgroundColor: theme.colors.chrome,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {walkthrough.thumb_url ? (
            <Image
              source={{ uri: walkthrough.thumb_url }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              transition={150}
            />
          ) : null}
          {walkthrough.thumb_url ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(24, 19, 13, 0.28)" }]}
            />
          ) : null}

          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: hasVideo ? theme.colors.primary : "rgba(0,0,0,0.55)",
            }}
          >
            <Icon
              icon={hasVideo ? Play : VideoOff}
              size="lg"
              color="#ffffff"
              fill={hasVideo ? "#ffffff" : undefined}
            />
          </View>

          <View
            style={{
              position: "absolute",
              left: spacing.sm,
              top: spacing.sm,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              paddingHorizontal: spacing.sm,
              paddingVertical: 2,
              borderRadius: radius.sm,
              backgroundColor: "rgba(0,0,0,0.6)",
            }}
          >
            <Icon icon={Video} size="sm" color="#ffffff" />
            <Text variant="caption" style={{ color: "#ffffff", fontWeight: "600" }}>
              {hasVideo ? "Video" : "No video"}
            </Text>
          </View>

          {duration ? (
            <View
              style={{
                position: "absolute",
                right: spacing.sm,
                bottom: spacing.sm,
                paddingHorizontal: spacing.sm,
                paddingVertical: 2,
                borderRadius: radius.sm,
                backgroundColor: "rgba(0,0,0,0.6)",
              }}
            >
              <Text variant="caption" style={{ color: "#ffffff", fontWeight: "600" }}>
                {duration}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      <View style={{ padding: spacing.lg, gap: spacing.md }}>
        <View style={{ gap: spacing.xs }}>
          <Text variant="bodyStrong" numberOfLines={2}>
            {walkthrough.title}
          </Text>
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {meta}
          </Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`AI Summary, ${aiSummaryLabel(status)}`}
          onPress={onRead}
          style={({ pressed }) => ({
            gap: spacing.xs,
            padding: spacing.md,
            borderRadius: radius.md,
            backgroundColor: theme.colors.muted,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
            <Icon icon={Sparkles} size="sm" tone="primary" />
            <Text variant="bodyStrong" style={{ flex: 1 }}>
              AI Summary
            </Text>
            <Badge label={aiSummaryLabel(status)} tone={aiSummaryTone(status)} />
          </View>
          <Text variant="caption" tone="muted" numberOfLines={2}>
            {summaryLine}
          </Text>
        </Pressable>

        <View style={{ flexDirection: "row", gap: spacing.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label="Watch video"
              icon={Play}
              variant="outline"
              size="sm"
              fullWidth
              disabled={!hasVideo}
              onPress={onWatch}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={status === "ready" ? "Read summary" : "Open summary"}
              icon={FileText}
              variant={status === "ready" ? "primary" : "secondary"}
              size="sm"
              fullWidth
              onPress={onRead}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
