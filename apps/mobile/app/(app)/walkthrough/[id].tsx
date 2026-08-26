import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useQuery } from "@tanstack/react-query";
import { cleanWalkthroughMarkdown, relativeTime } from "@everlumen/shared";
import { signPhotoUrls } from "@/api/photos";
import {
  generateWalkthroughReport,
  getWalkthroughDetail,
  setWalkthroughShare,
  signWalkthroughVideo,
  type WalkthroughShot,
} from "@/api/walkthroughs";
import { radius, spacing, useTheme } from "@/theme";
import { FileText, Share2, VideoOff } from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

function timecode(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

export default function WalkthroughDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ["walkthrough", id],
    queryFn: () => getWalkthroughDetail(id!),
    enabled: Boolean(id),
  });

  const detail = detailQuery.data;

  const videoQuery = useQuery({
    queryKey: ["walkthrough-video", detail?.video_path],
    queryFn: () => signWalkthroughVideo(detail!.video_path!),
    enabled: Boolean(detail?.video_path),
    // Signed URLs last an hour. Re-signing sooner just spends requests.
    staleTime: 45 * 60 * 1000,
  });

  const shotUrlsQuery = useQuery({
    queryKey: ["walkthrough-shots", id, detail?.shots.length ?? 0],
    queryFn: () =>
      signPhotoUrls(
        (detail?.shots ?? [])
          .filter((shot) => shot.storage_path)
          .map((shot) => ({
            id: shot.photo_id,
            caption: null,
            storage_path: shot.storage_path!,
            thumb_path: shot.thumb_path,
            image_url: null,
            created_at: "",
            taken_at: null,
            phase: null,
            tags: null,
          })),
      ),
    enabled: Boolean(detail?.shots.some((shot) => shot.storage_path)),
    staleTime: 45 * 60 * 1000,
  });

  const shotUrls = shotUrlsQuery.data ?? {};

  const player = useVideoPlayer(videoQuery.data ?? null, (instance) => {
    instance.loop = false;
  });

  /**
   * Jump the recording to the moment a photo was taken.
   *
   * This is the reason the offsets are stored at all: the photo answers "what",
   * and the narration around it answers "why", so a tap on a thumbnail should
   * land on the sentence that goes with it.
   */
  const seekTo = useCallback(
    (shot: WalkthroughShot) => {
      if (!videoQuery.data) return;
      player.currentTime = Math.max(0, shot.offset_seconds);
      player.play();
    },
    [player, videoQuery.data],
  );

  const summary = useMemo(
    () => (detail?.summary_markdown ? cleanWalkthroughMarkdown(detail.summary_markdown) : null),
    [detail?.summary_markdown],
  );

  async function onGenerateReport() {
    if (!id) return;
    setBusy("report");
    setNotice(null);
    try {
      await generateWalkthroughReport(id);
      await detailQuery.refetch();
      setNotice("Report generated");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not generate the report");
    } finally {
      setBusy(null);
    }
  }

  async function onShare() {
    if (!id) return;
    setBusy("share");
    setNotice(null);
    try {
      const token = detail?.share_token ?? (await setWalkthroughShare(id, true)).shareToken;
      if (!token) {
        setNotice("Sharing is not available for this walkthrough");
        return;
      }
      await detailQuery.refetch();
      // The system sheet, so the link can go wherever the crew already talks.
      await Share.share({
        message: `https://everlumen.co/share/walkthroughs/${token}`,
      });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not create the link");
    } finally {
      setBusy(null);
    }
  }

  const videoBox = {
    width: "100%" as const,
    aspectRatio: 16 / 9,
    borderRadius: radius.md,
    overflow: "hidden" as const,
    backgroundColor: theme.colors.muted,
  };

  return (
    <>
      <Stack.Screen options={{ title: detail?.title ?? "Walkthrough" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {detailQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : detailQuery.error || !detail ? (
          <ErrorState
            message={
              detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Walkthrough not found"
            }
            onRetry={() => void detailQuery.refetch()}
          />
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
            refreshControl={
              <RefreshControl
                refreshing={detailQuery.isRefetching}
                onRefresh={() => void detailQuery.refetch()}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
          >
            {detail.video_path ? (
              videoQuery.data ? (
                <VideoView player={player} style={videoBox} nativeControls contentFit="contain" />
              ) : (
                <View style={[videoBox, { alignItems: "center", justifyContent: "center" }]}>
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              )
            ) : (
              <View
                style={[
                  videoBox,
                  { alignItems: "center", justifyContent: "center", gap: spacing.sm },
                ]}
              >
                <Icon icon={VideoOff} size="xl" tone="muted" />
                <Text variant="caption" tone="muted">
                  No video on this walkthrough
                </Text>
              </View>
            )}

            <Text variant="caption" tone="muted" style={{ marginTop: spacing.md }}>
              {`${relativeTime(detail.created_at)} · ${timecode(detail.duration_seconds)}`}
            </Text>

            {detail.shots.length > 0 ? (
              <>
                <SectionHeader title="Photos along the way" count={detail.shots.length} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    {detail.shots.map((shot) => (
                      <Pressable
                        key={shot.id}
                        accessibilityRole="button"
                        accessibilityLabel={`Photo at ${timecode(shot.offset_seconds)}`}
                        accessibilityHint="Jumps the recording to this moment"
                        onPress={() => seekTo(shot)}
                        style={({ pressed }) => ({
                          width: 96,
                          gap: spacing.xs,
                          opacity: pressed ? 0.7 : 1,
                        })}
                      >
                        <Image
                          source={
                            shotUrls[shot.photo_id] ? { uri: shotUrls[shot.photo_id] } : undefined
                          }
                          style={{
                            width: 96,
                            height: 96,
                            borderRadius: radius.sm,
                            backgroundColor: theme.colors.muted,
                          }}
                          contentFit="cover"
                        />
                        <Text variant="caption" tone="muted" align="center">
                          {timecode(shot.offset_seconds)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </>
            ) : null}

            <SectionHeader title="Transcript" />
            <Card>
              {detail.transcript ? (
                <Text variant="body">{detail.transcript}</Text>
              ) : (
                <>
                  <Badge label="Not transcribed" tone="warning" />
                  <Text variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
                    Recordings made on the phone are transcribed from the web app.
                  </Text>
                </>
              )}
            </Card>

            {summary ? (
              <>
                <SectionHeader title="Report" />
                <Card>
                  <Text variant="body">{summary}</Text>
                </Card>
              </>
            ) : null}

            {notice ? (
              <Text variant="caption" tone="muted" style={{ marginTop: spacing.lg }}>
                {notice}
              </Text>
            ) : null}

            <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
              <Button
                label="Generate report"
                icon={FileText}
                fullWidth
                loading={busy === "report"}
                disabled={Boolean(busy) || !detail.transcript}
                onPress={() => void onGenerateReport()}
              />
              {!detail.transcript ? (
                // Says why the button is dead rather than failing after the tap.
                <Text variant="caption" tone="muted">
                  A report needs a transcript first.
                </Text>
              ) : null}

              <Button
                label={detail.share_token ? "Share link" : "Create share link"}
                icon={Share2}
                variant="outline"
                fullWidth
                loading={busy === "share"}
                disabled={Boolean(busy)}
                onPress={() => void onShare()}
              />
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}
