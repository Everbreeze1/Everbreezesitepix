import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  View,
} from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useVideoPlayer, VideoView } from "expo-video";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cleanWalkthroughMarkdown, relativeTime } from "@everlumen/shared";
import { signPhotoUrls } from "@/api/photos";
import { canOpenReport, reportRefusal, reportResultMessage } from "@/api/walkthrough-report-view";
import {
  generateWalkthroughReport,
  getWalkthroughDetail,
  setWalkthroughShare,
  signWalkthroughVideo,
  type WalkthroughShot,
  createReportFromWalkthrough,
} from "@/api/walkthroughs";
import {
  generateSummaryForWalkthrough,
  getSummary,
  listProjectSummaries,
  setSummaryShare,
  summaryShareUrl,
} from "@/api/summaries";
import { plainBody, REGENERATE_WARNING, stateMessage } from "@/api/summary-view";
import {
  aiSummaryLabel,
  aiSummaryStatus,
  aiSummaryTone,
  clockDuration,
} from "@/api/walkthrough-list-view";
import { openShareSheet } from "@/api/sharing";
import { SegmentTabs } from "@/components/walkthrough/SegmentTabs";
import { SummaryReport } from "@/components/walkthrough/SummaryReport";
import { radius, spacing, useTheme } from "@/theme";
import {
  FileText,
  Link2,
  RefreshCw,
  ScrollText,
  Share2,
  Sparkles,
  TriangleAlert,
  VideoOff,
} from "@/ui/icons";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  Icon,
  ListRow,
  PhotoThumb,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";

type Tab = "summary" | "transcript";

function timecode(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * One walkthrough: the recording on top, what it was written up as below.
 *
 * A walkthrough is two artefacts, and this screen used to show one of them.
 * The video played, and the AI Summary (a separate row the service writes from
 * the transcript, with each photo described from what was said near it) was
 * only reachable from a list on another screen. Now the player sits at the top
 * and two labelled segments sit under it: the Summary, and the raw Transcript
 * it was written from.
 */
export default function WalkthroughDetailScreen() {
  const { id, tab, play } = useLocalSearchParams<{ id: string; tab?: string; play?: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const [segment, setSegment] = useState<Tab>(tab === "transcript" ? "transcript" : "summary");
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

  /*
   * The AI Summary of this recording.
   *
   * Found through the project's list rather than a per-walkthrough op, the way
   * the web page does it: the list is one call and already carries the link.
   * The newest wins, because Regenerate writes a new one and keeps the old.
   */
  const summariesQuery = useQuery({
    queryKey: ["project-summaries", detail?.project_id],
    queryFn: () => listProjectSummaries(detail!.project_id),
    enabled: Boolean(detail?.project_id),
  });
  const ownSummaries = useMemo(
    () =>
      (summariesQuery.data ?? [])
        .filter((s) => s.walkthroughId === id)
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)),
    [summariesQuery.data, id],
  );
  const current = ownSummaries[0] ?? null;

  const summaryQuery = useQuery({
    queryKey: ["summary", current?.id],
    queryFn: () => getSummary(current!.id),
    enabled: Boolean(current?.id),
  });

  const status = detail ? aiSummaryStatus(detail, summaryQuery.data?.summary ?? current) : "none";

  // Poll while the write-up is on its way, and stop as soon as it lands.
  useEffect(() => {
    if (status !== "generating") return;
    const timer = setInterval(() => {
      void detailQuery.refetch();
      void summariesQuery.refetch();
      if (current?.id) void summaryQuery.refetch();
    }, 10_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, current?.id]);

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

  // "Watch video" on the list lands here playing, not on a still frame.
  const autoplayed = useRef(false);
  useEffect(() => {
    if (play !== "1" || autoplayed.current || !videoQuery.data) return;
    autoplayed.current = true;
    player.play();
  }, [play, player, videoQuery.data]);

  /**
   * Jump the recording to a moment and bring the player into view.
   *
   * This is the reason the offsets are stored at all: the photo answers "what",
   * and the narration around it answers "why", so a tap on a photo's time
   * should land on the sentence that goes with it.
   */
  const seekTo = useCallback(
    (seconds: number) => {
      if (!videoQuery.data) return;
      player.currentTime = Math.max(0, seconds);
      player.play();
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    },
    [player, videoQuery.data],
  );

  const legacyReport = useMemo(
    () => (detail?.summary_markdown ? cleanWalkthroughMarkdown(detail.summary_markdown) : null),
    [detail?.summary_markdown],
  );

  function refreshAll() {
    void detailQuery.refetch();
    void summariesQuery.refetch();
    if (current?.id) void summaryQuery.refetch();
  }

  /**
   * Write the AI Summary, or write it again.
   *
   * The op answers with the existing summary unless forced, so a first
   * "Generate" tapped twice cannot bill twice. "Regenerate" forces, and the
   * service writes a new row rather than overwriting, so edits to the old one
   * survive under Earlier summaries.
   */
  async function makeSummary(force: boolean) {
    if (!id) return;
    setBusy("summary");
    setNotice(null);
    try {
      const result = await generateSummaryForWalkthrough(id, force);
      await queryClient.invalidateQueries({ queryKey: ["project-summaries"] });
      if (result.summaryId) {
        await queryClient.invalidateQueries({ queryKey: ["summary", result.summaryId] });
      }
      setNotice(
        result.aiFailed
          ? "Saved without AI text. The AI service did not answer."
          : force
            ? "A new summary was written."
            : "Summary ready.",
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not write the summary");
    } finally {
      setBusy(null);
    }
  }

  function confirmRegenerate() {
    Alert.alert("Write a new summary?", REGENERATE_WARNING, [
      { text: "Keep this one", style: "cancel" },
      { text: "Write new", onPress: () => void makeSummary(true) },
    ]);
  }

  /**
   * Share the write-up on its own.
   *
   * The summary's link, not the video's: a client can be sent the report
   * without the footage of somebody narrating their building.
   */
  async function onShareSummary() {
    if (!current) return;
    setBusy("shareSummary");
    setNotice(null);
    try {
      const token = current.shareToken ?? (await setSummaryShare(current.id, true));
      const url = summaryShareUrl(token);
      void queryClient.invalidateQueries({ queryKey: ["project-summaries"] });
      if (!url) {
        setNotice("Sharing is not set up for this workspace, so there is no link to send.");
        return;
      }
      await openShareSheet(url, current.title);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not share the summary");
    } finally {
      setBusy(null);
    }
  }

  /**
   * Make the report a client actually receives.
   *
   * Nothing in `project_reports` exists until this runs. Idempotent on the
   * server by lookup rather than by key, so a second tap opens the same report
   * rather than making a second one, and the message says which happened.
   */
  async function onCreateClientReport() {
    if (!id) return;
    setBusy("clientReport");
    setNotice(null);
    try {
      const result = await createReportFromWalkthrough(id);
      setNotice(reportResultMessage(result));
      if (canOpenReport(result)) {
        router.push({
          pathname: "/report/[reportId]",
          params: { reportId: result.reportId! },
        });
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not create the report");
    } finally {
      setBusy(null);
    }
  }

  /*
   * Re-runs the transcription write-up over the recording. Named for what it
   * does, as the web's menu names it: the Summary above has its own
   * Regenerate.
   */
  async function onReprocess() {
    if (!id) return;
    setBusy("report");
    setNotice(null);
    try {
      await generateWalkthroughReport(id);
      await detailQuery.refetch();
      void summariesQuery.refetch();
      setNotice("Recording reprocessed");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not reprocess the recording");
    } finally {
      setBusy(null);
    }
  }

  async function onShareVideo() {
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
    borderRadius: radius.lg,
    overflow: "hidden" as const,
    backgroundColor: theme.colors.chrome,
  };

  const openSummary = (summaryId: string) =>
    router.push({ pathname: "/summary/[summaryId]", params: { summaryId } });

  return (
    <>
      <Stack.Screen options={{ title: "Walkthrough" }} />
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
            ref={scrollRef}
            contentContainerStyle={{
              padding: spacing.lg,
              paddingBottom: spacing.xxxl,
              gap: spacing.lg,
            }}
            refreshControl={
              <RefreshControl
                refreshing={detailQuery.isRefetching}
                onRefresh={refreshAll}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
              />
            }
          >
            {/* The recording. */}
            {detail.video_path ? (
              videoQuery.data ? (
                <VideoView player={player} style={videoBox} nativeControls contentFit="contain" />
              ) : (
                <View style={[videoBox, { alignItems: "center", justifyContent: "center" }]}>
                  <ActivityIndicator color={theme.colors.primaryGlow} />
                </View>
              )
            ) : (
              <View
                style={[
                  videoBox,
                  { alignItems: "center", justifyContent: "center", gap: spacing.sm },
                ]}
              >
                <Icon icon={VideoOff} size="xl" color={theme.colors.chromeForeground} />
                <Text variant="caption" style={{ color: theme.colors.chromeForeground }}>
                  No video on this walkthrough
                </Text>
              </View>
            )}

            <View style={{ gap: spacing.xs }}>
              <Text variant="title">{detail.title}</Text>
              <Text variant="caption" tone="muted">
                {[
                  relativeTime(detail.created_at),
                  clockDuration(detail.duration_seconds) || null,
                  detail.shots.length > 0
                    ? `${detail.shots.length} photo${detail.shots.length === 1 ? "" : "s"}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
            </View>

            <SegmentTabs<Tab>
              segments={[
                { id: "summary", label: "Summary", icon: Sparkles },
                { id: "transcript", label: "Transcript", icon: ScrollText },
              ]}
              value={segment}
              onChange={setSegment}
            />

            {notice ? (
              <Text variant="caption" tone="muted">
                {notice}
              </Text>
            ) : null}

            {segment === "summary" ? (
              <View style={{ gap: spacing.md }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Icon icon={Sparkles} size="md" tone="primary" />
                  <Text variant="heading" style={{ flex: 1 }}>
                    AI Summary
                  </Text>
                  <Badge label={aiSummaryLabel(status)} tone={aiSummaryTone(status)} />
                </View>

                {status === "ready" && summaryQuery.data ? (
                  <>
                    <Text variant="caption" tone="muted">
                      {`${summaryQuery.data.summary.title} · written ${relativeTime(
                        summaryQuery.data.summary.updatedAt,
                      )}`}
                    </Text>
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Share summary"
                          icon={Share2}
                          size="sm"
                          fullWidth
                          loading={busy === "shareSummary"}
                          disabled={Boolean(busy)}
                          onPress={() => void onShareSummary()}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Button
                          label="Open report"
                          icon={FileText}
                          variant="secondary"
                          size="sm"
                          fullWidth
                          accessibilityHint="Opens the write-up to edit, rename or delete it"
                          onPress={() => openSummary(summaryQuery.data!.summary.id)}
                        />
                      </View>
                    </View>
                    <SummaryReport
                      summary={summaryQuery.data.summary}
                      photos={summaryQuery.data.photos}
                      onSeek={videoQuery.data ? seekTo : undefined}
                    />
                    <Button
                      label="Regenerate summary"
                      icon={RefreshCw}
                      variant="outline"
                      fullWidth
                      loading={busy === "summary"}
                      disabled={Boolean(busy)}
                      onPress={confirmRegenerate}
                    />
                  </>
                ) : status === "ready" || (current && summaryQuery.isLoading) ? (
                  <SkeletonList rows={2} />
                ) : status === "generating" ? (
                  <Card>
                    <View style={{ flexDirection: "row", gap: spacing.md, alignItems: "center" }}>
                      <ActivityIndicator color={theme.colors.primary} />
                      <Text variant="body" tone="muted" style={{ flex: 1 }}>
                        {stateMessage("pending")}
                      </Text>
                    </View>
                  </Card>
                ) : (
                  <Card style={{ gap: spacing.md }}>
                    {status === "failed" ? (
                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        <Icon icon={TriangleAlert} size="md" tone="safety" />
                        <Text variant="body" tone="muted" style={{ flex: 1 }}>
                          {stateMessage("failed")}
                        </Text>
                      </View>
                    ) : (
                      <Text variant="body" tone="muted">
                        Write this walk up as a report: an overview, the findings, and every photo
                        you took with a note from what you said at that moment.
                      </Text>
                    )}
                    {!detail.transcript ? (
                      <Text variant="caption" tone="muted">
                        There is no transcript yet, so the summary will lean on the photos.
                      </Text>
                    ) : null}
                    <Button
                      label={status === "failed" ? "Try again" : "Generate summary"}
                      icon={Sparkles}
                      fullWidth
                      loading={busy === "summary"}
                      disabled={Boolean(busy)}
                      onPress={() => void makeSummary(false)}
                    />
                  </Card>
                )}

                {ownSummaries.length > 1 ? (
                  <>
                    <SectionHeader title="Earlier summaries" count={ownSummaries.length - 1} />
                    {ownSummaries.slice(1).map((earlier) => (
                      <ListRow
                        key={earlier.id}
                        icon={FileText}
                        title={earlier.title}
                        subtitle={`Written ${relativeTime(earlier.createdAt)}`}
                        onPress={() => openSummary(earlier.id)}
                      />
                    ))}
                  </>
                ) : null}

                {/*
                  A walkthrough from before summaries had their own table
                  carries its write-up on the row itself. Shown only when there
                  is no summary, so nothing old is lost and nothing is doubled.
                */}
                {!current && legacyReport ? (
                  <>
                    <SectionHeader title="Earlier report" />
                    <Card>
                      <Text variant="body">{plainBody(legacyReport)}</Text>
                    </Card>
                  </>
                ) : null}
              </View>
            ) : (
              <View style={{ gap: spacing.md }}>
                {detail.shots.length > 0 ? (
                  <View style={{ gap: spacing.sm }}>
                    <Text variant="overline" tone="muted">
                      {`PHOTOS ALONG THE WAY · ${detail.shots.length}`}
                    </Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <View style={{ flexDirection: "row", gap: spacing.sm }}>
                        {detail.shots.map((shot: WalkthroughShot) => (
                          <Pressable
                            key={shot.id}
                            accessibilityRole="button"
                            accessibilityLabel={`Photo at ${timecode(shot.offset_seconds)}`}
                            accessibilityHint="Jumps the recording to this moment"
                            onPress={() => seekTo(shot.offset_seconds)}
                            style={({ pressed }) => ({
                              width: 96,
                              gap: spacing.xs,
                              opacity: pressed ? 0.7 : 1,
                            })}
                          >
                            <PhotoThumb uri={shotUrls[shot.photo_id]} width={96} height={96} />
                            <Text variant="caption" tone="muted" align="center">
                              {timecode(shot.offset_seconds)}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                  </View>
                ) : null}

                <Card>
                  {detail.transcript ? (
                    <Text variant="body" selectable>
                      {detail.transcript}
                    </Text>
                  ) : (
                    <>
                      <Badge label="Not transcribed" tone="warning" />
                      <Text variant="body" tone="muted" style={{ marginTop: spacing.sm }}>
                        Recordings made on the phone are transcribed from the web app.
                      </Text>
                    </>
                  )}
                </Card>
              </View>
            )}

            <SectionHeader title="More" />
            <View style={{ gap: spacing.sm }}>
              <Button
                label={detail.share_token ? "Share video link" : "Get video link"}
                icon={Link2}
                variant="outline"
                fullWidth
                loading={busy === "share"}
                disabled={Boolean(busy)}
                onPress={() => void onShareVideo()}
              />

              {/*
                The end of the chain: this makes the `project_reports` row
                anybody outside the company ever sees.
              */}
              <Button
                label="Make a client report"
                icon={FileText}
                variant="outline"
                fullWidth
                loading={busy === "clientReport"}
                disabled={Boolean(busy) || Boolean(reportRefusal(Boolean(detail.transcript)))}
                onPress={() => void onCreateClientReport()}
              />
              <Button
                label="Reprocess recording"
                icon={RefreshCw}
                variant="ghost"
                fullWidth
                loading={busy === "report"}
                disabled={Boolean(busy) || !detail.transcript}
                onPress={() => void onReprocess()}
              />
              {reportRefusal(Boolean(detail.transcript)) ? (
                // Says why the buttons are dead rather than failing after the tap.
                <Text variant="caption" tone="muted">
                  {reportRefusal(Boolean(detail.transcript))}
                </Text>
              ) : null}
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}
