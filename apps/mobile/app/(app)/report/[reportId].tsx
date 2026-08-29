import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { displayCaption } from "@everlumen/shared";
import { listProjectPhotoPage, signPhotoUrls, type PhotoListItem } from "@/api/photos";
import { draftReportSummary, getReport, saveReport } from "@/api/reports";
import {
  isReportEmpty,
  isReportShared,
  reportPhotoIds,
  shareStatusLabel,
  shareTogglePatch,
} from "@/api/report-view";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { radius, spacing, useTheme } from "@/theme";
import { Images, Send, Share2, Sparkles } from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  EmptyState,
  ErrorState,
  Field,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SectionHeader,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * One report: choose the photos, write the summary, share the link.
 *
 * The AI draft goes into the **box**, not into the record. The person reads it,
 * edits it, and it is their report that reaches the client: a draft written
 * straight to the row would be the model signing off work it did not do. The
 * button says "Draft" for the same reason.
 *
 * Sharing turns on `revoked_at = null` rather than minting a token, because
 * every report has a token from creation. That means un-revoking restores a
 * link somebody sent last month, which is usually what people want and is
 * occasionally not: revoking is not a permanent kill, and the screen says so
 * where somebody is deciding.
 */
export default function ReportScreen() {
  const { reportId, projectId } = useLocalSearchParams<{
    reportId: string;
    projectId?: string;
  }>();
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [photoIds, setPhotoIds] = useState<string[]>([]);
  const [picking, setPicking] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["report", reportId], [reportId]);

  const query = useQuery({
    queryKey,
    queryFn: () => getReport(reportId!),
    enabled: Boolean(reportId),
  });
  const report = query.data ?? null;

  /*
   * Seed local state once. Re-seeding on every refetch would discard a
   * half-written summary the moment a background refresh lands, which on a
   * phone is whenever the app returns to the foreground.
   */
  useEffect(() => {
    if (loaded || !report) return;
    setTitle(report.title);
    setSummary(report.summary ?? "");
    setPhotoIds(reportPhotoIds(report));
    setLoaded(true);
  }, [report, loaded]);

  const photosQuery = useQuery({
    queryKey: ["report-photos", projectId],
    queryFn: () => listProjectPhotoPage(projectId!, null),
    enabled: Boolean(projectId),
  });

  const allPhotos: PhotoListItem[] = useMemo(
    () => photosQuery.data?.photos ?? [],
    [photosQuery.data],
  );
  const chosen = useMemo(
    () =>
      photoIds
        .map((id) => allPhotos.find((photo) => photo.id === id))
        .filter((photo): photo is PhotoListItem => Boolean(photo)),
    [photoIds, allPhotos],
  );

  const urlsQuery = useQuery({
    queryKey: ["report-urls", reportId, photoIds.join(",")],
    queryFn: () => signPhotoUrls(chosen),
    enabled: chosen.length > 0,
    staleTime: 45 * 60 * 1000,
  });
  const urls = { ...(photosQuery.data?.urls ?? {}), ...(urlsQuery.data ?? {}) };

  const save = useMutation({
    mutationFn: (patch: Parameters<typeof saveReport>[1]) => saveReport(reportId!, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["project-reports", projectId] });
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "That did not save."),
  });

  const draft = useMutation({
    mutationFn: () => draftReportSummary(photoIds, title.trim() || undefined),
    onSuccess: (text) => {
      if (!text) {
        setFailure("The model did not return anything. Try again in a moment.");
        return;
      }
      // Into the box, not the record. Saved only when the person leaves the
      // field, having had the chance to change it.
      setSummary(text);
      setFailure(null);
    },
    onError: (error: unknown) =>
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not draft the summary. The model may be unreachable from this network.",
      ),
  });

  const share = useCallback(async () => {
    if (!report) return;
    const url = publicUrl("reports", report.share_token);
    if (!url) {
      setFailure("No public link yet. Turn sharing on first.");
      return;
    }
    await openShareSheet(url, report.title);
  }, [report]);

  if (query.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: "Report" }} />
        <SkeletonList rows={5} />
      </>
    );
  }

  if (query.error || !report) {
    return (
      <>
        <Stack.Screen options={{ title: "Report" }} />
        <ErrorState
          title="Could not load this report"
          message={query.error instanceof Error ? query.error.message : undefined}
          onRetry={() => void query.refetch()}
        />
      </>
    );
  }

  const shared = isReportShared(report);

  return (
    <>
      <Stack.Screen options={{ title: title || "Report" }} />

      <Screen scroll padded={false} bottomInset={spacing.xxl}>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
          <Field
            label="Title"
            value={title}
            onChangeText={setTitle}
            // On blur, like every other long-lived field in this app. A write
            // per keystroke is a write per keystroke on one bar of signal.
            onBlur={() => {
              const trimmed = title.trim();
              if (!trimmed || trimmed === report.title) return;
              save.mutate({ title: trimmed });
            }}
            returnKeyType="done"
          />

          <ButtonRow>
            <Button
              label={chosen.length ? `${chosen.length} photos` : "Choose photos"}
              icon={Images}
              variant="secondary"
              onPress={() => setPicking(true)}
            />
            <Button
              label={draft.isPending ? "Writing" : "Draft"}
              icon={Sparkles}
              disabled={draft.isPending || photoIds.length === 0}
              onPress={() => draft.mutate()}
            />
          </ButtonRow>

          {failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null}

          <Field
            label="Write-up"
            value={summary}
            onChangeText={setSummary}
            onBlur={() => {
              const next = summary.trim() || null;
              if (next === (report.summary ?? null)) return;
              save.mutate({ summary: next });
            }}
            placeholder="What was done, what was found, what happens next"
            hint={
              photoIds.length === 0
                ? "Choose photos first and Draft will write a first pass from them"
                : "Draft writes a first pass. Edit it before you send it."
            }
            multiline
            rows={8}
          />
        </View>

        <SectionHeader title={`Photos (${chosen.length})`} />
        <View style={{ paddingHorizontal: spacing.lg }}>
          {chosen.length === 0 ? (
            <EmptyState
              icon={Images}
              title="No photos on this report"
              body="A report is mostly pictures. Choose the ones that show what was done."
              action={{ label: "Choose photos", onPress: () => setPicking(true), icon: Images }}
            />
          ) : (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
              {chosen.map((photo) => (
                <Image
                  key={photo.id}
                  source={urls[photo.id] ? { uri: urls[photo.id] } : undefined}
                  style={{
                    width: "31.5%",
                    aspectRatio: 1,
                    borderRadius: radius.sm,
                    backgroundColor: theme.colors.secondary,
                  }}
                  contentFit="cover"
                />
              ))}
            </View>
          )}
        </View>

        <SectionHeader title="Sharing" />
        <View style={{ paddingHorizontal: spacing.lg, gap: spacing.sm }}>
          <ListGroup>
            <ListRow
              icon={Share2}
              iconTone={shared ? "success" : "muted"}
              title={shared ? "Sharing is on" : "Sharing is off"}
              subtitle={shareStatusLabel(report)}
              right={
                <Badge
                  label={shared ? "On" : "Off"}
                  tone={shared ? "success" : "neutral"}
                  variant={shared ? "soft" : "outline"}
                />
              }
              onPress={() => save.mutate(shareTogglePatch(!shared))}
            />
            {shared ? (
              <>
                <RowDivider />
                <ListRow
                  icon={Send}
                  title="Send the link"
                  subtitle="Opens your phone's share sheet"
                  onPress={() => void share()}
                />
                <RowDivider />
                <ListRow
                  title="Allow downloading"
                  subtitle="Lets the reader save a copy of the report"
                  right={
                    <Badge
                      label={report.allow_download ? "Yes" : "No"}
                      tone={report.allow_download ? "primary" : "neutral"}
                      variant={report.allow_download ? "soft" : "outline"}
                    />
                  }
                  onPress={() => save.mutate({ allow_download: !report.allow_download })}
                />
              </>
            ) : null}
          </ListGroup>

          {/*
            Said where the decision is made. Revoking looks like a kill switch
            and is not one: the token survives, so turning sharing back on
            restores the link somebody was sent last month. Deleting the report
            is the permanent option.
          */}
          <Text variant="caption" tone="muted">
            Turning sharing off breaks the link. Turning it back on restores the same link rather
            than making a new one, so it is not a way to permanently kill a link that leaked. Delete
            the report for that.
          </Text>

          {isReportEmpty(report) ? (
            <Text variant="caption" tone="muted">
              This report has no photos and no write-up yet. You can still share it, but the reader
              will get an almost empty page.
            </Text>
          ) : null}
        </View>
      </Screen>

      <PhotoPicker
        visible={picking}
        photos={allPhotos}
        urls={urls}
        chosen={photoIds}
        loading={photosQuery.isLoading}
        onClose={() => setPicking(false)}
        onDone={(next) => {
          setPicking(false);
          setPhotoIds(next);
          save.mutate({ photo_ids: next });
        }}
      />
    </>
  );
}

/** Choosing which photos the report shows. A grid, because the picture is the answer. */
function PhotoPicker({
  visible,
  photos,
  urls,
  chosen,
  loading,
  onClose,
  onDone,
}: {
  visible: boolean;
  photos: PhotoListItem[];
  urls: Record<string, string>;
  chosen: string[];
  loading: boolean;
  onClose: () => void;
  onDone: (next: string[]) => void;
}) {
  const theme = useTheme();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(chosen));

  // Re-seed on open, so a cancelled selection does not persist into the next.
  const [seenFor, setSeenFor] = useState("");
  const key = chosen.join(",");
  if (visible && seenFor !== key) {
    setSeenFor(key);
    setSelected(new Set(chosen));
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Photos on this report"
      subtitle={`${selected.size} chosen`}
      footer={
        <Button
          label="Use these"
          fullWidth
          // Filtered through the project's own order, so the report reads
          // chronologically rather than in the order somebody tapped.
          onPress={() => onDone(photos.filter((p) => selected.has(p.id)).map((p) => p.id))}
        />
      }
    >
      {loading ? (
        <SkeletonList rows={3} />
      ) : photos.length === 0 ? (
        <EmptyState icon={Images} title="No photos on this project yet" />
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {photos.map((photo) => {
            const on = selected.has(photo.id);
            return (
              <Pressable
                key={photo.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={displayCaption(photo.caption, "Photo")}
                onPress={() =>
                  setSelected((current) => {
                    const next = new Set(current);
                    if (next.has(photo.id)) next.delete(photo.id);
                    else next.add(photo.id);
                    return next;
                  })
                }
                style={{ width: "31.5%", aspectRatio: 1 }}
              >
                <Image
                  source={urls[photo.id] ? { uri: urls[photo.id] } : undefined}
                  style={{
                    width: "100%",
                    height: "100%",
                    borderRadius: radius.sm,
                    backgroundColor: theme.colors.secondary,
                    // A ring, not a tint. A tint over a photograph is invisible
                    // against roughly half of them.
                    borderWidth: on ? 3 : 0,
                    borderColor: theme.colors.primary,
                  }}
                  contentFit="cover"
                />
                {on ? (
                  <View style={{ position: "absolute", right: 4, bottom: 4 }}>
                    <Badge label="On" tone="primary" />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </Sheet>
  );
}
