import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from "react-native";
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
import { HIT_TARGET, radius, spacing, typography, useTheme } from "@/theme";

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
    setBusy("Generating report");
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
    setBusy("Preparing link");
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

  return (
    <>
      <Stack.Screen options={{ title: detail?.title ?? "Walkthrough" }} />
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {detailQuery.isLoading ? (
          <ActivityIndicator style={{ marginTop: spacing.xxxl }} color={theme.colors.primary} />
        ) : detailQuery.error || !detail ? (
          <View style={styles.centered}>
            <Text style={[typography.body, { color: theme.colors.destructive }]}>
              {detailQuery.error instanceof Error
                ? detailQuery.error.message
                : "Walkthrough not found"}
            </Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxxl }}
            refreshControl={
              <RefreshControl
                refreshing={detailQuery.isRefetching}
                onRefresh={() => void detailQuery.refetch()}
                tintColor={theme.colors.primary}
              />
            }
          >
            {detail.video_path ? (
              videoQuery.data ? (
                <VideoView
                  player={player}
                  style={[styles.video, { backgroundColor: theme.colors.muted }]}
                  nativeControls
                  contentFit="contain"
                />
              ) : (
                <View
                  style={[
                    styles.video,
                    styles.videoPlaceholder,
                    { backgroundColor: theme.colors.muted },
                  ]}
                >
                  <ActivityIndicator color={theme.colors.primary} />
                </View>
              )
            ) : (
              <View
                style={[
                  styles.video,
                  styles.videoPlaceholder,
                  { backgroundColor: theme.colors.muted },
                ]}
              >
                <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                  No video on this walkthrough
                </Text>
              </View>
            )}

            <Text
              style={[
                typography.caption,
                { color: theme.colors.mutedForeground, marginTop: spacing.md },
              ]}
            >
              {relativeTime(detail.created_at)} · {timecode(detail.duration_seconds)}
            </Text>

            {detail.shots.length > 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <Text
                  style={[
                    typography.overline,
                    { color: theme.colors.mutedForeground, marginBottom: spacing.sm },
                  ]}
                >
                  PHOTOS ALONG THE WAY
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    {detail.shots.map((shot) => (
                      <Pressable key={shot.id} onPress={() => seekTo(shot)} style={styles.shot}>
                        <Image
                          source={
                            shotUrls[shot.photo_id] ? { uri: shotUrls[shot.photo_id] } : undefined
                          }
                          style={[styles.shotImage, { backgroundColor: theme.colors.muted }]}
                          contentFit="cover"
                        />
                        <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                          {timecode(shot.offset_seconds)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}

            <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
              <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
                TRANSCRIPT
              </Text>
              <Text
                style={[
                  typography.body,
                  { color: detail.transcript ? theme.colors.foreground : theme.colors.safety },
                ]}
              >
                {detail.transcript ??
                  "Not transcribed yet. Recordings made on the phone are transcribed from the web app."}
              </Text>
            </View>

            {summary ? (
              <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
                <Text style={[typography.overline, { color: theme.colors.mutedForeground }]}>
                  REPORT
                </Text>
                <Text style={[typography.body, { color: theme.colors.foreground }]}>{summary}</Text>
              </View>
            ) : null}

            {notice ? (
              <Text
                style={[
                  typography.caption,
                  { color: theme.colors.mutedForeground, marginTop: spacing.lg },
                ]}
              >
                {notice}
              </Text>
            ) : null}

            <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
              <Pressable
                disabled={Boolean(busy) || !detail.transcript}
                onPress={() => void onGenerateReport()}
                style={[
                  styles.button,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity: busy || !detail.transcript ? 0.5 : 1,
                  },
                ]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.primaryForeground }]}>
                  {busy === "Generating report" ? "Generating…" : "Generate report"}
                </Text>
              </Pressable>
              {!detail.transcript ? (
                <Text style={[typography.caption, { color: theme.colors.mutedForeground }]}>
                  A report needs a transcript first.
                </Text>
              ) : null}

              <Pressable
                disabled={Boolean(busy)}
                onPress={() => void onShare()}
                style={[styles.secondary, { borderColor: theme.colors.border }]}
              >
                <Text style={[typography.bodyStrong, { color: theme.colors.foreground }]}>
                  {detail.share_token ? "Share link" : "Create share link"}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  centered: { padding: spacing.xl, alignItems: "center", gap: spacing.md },
  video: { width: "100%", aspectRatio: 16 / 9, borderRadius: radius.md, overflow: "hidden" },
  videoPlaceholder: { alignItems: "center", justifyContent: "center" },
  shot: { width: 96, gap: 4 },
  shotImage: { width: 96, height: 96, borderRadius: radius.sm },
  button: {
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
  secondary: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    minHeight: HIT_TARGET,
  },
});
