import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, useWindowDimensions, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addReportSection,
  builtReportPdfUrl,
  deleteReportSection,
  getBuiltReport,
  listReportSections,
  patchBuiltReport,
  patchReportSection,
  saveSectionOrder,
  signReportPhotos,
  type BuiltReport,
  type BuiltReportPatch,
} from "@/api/report-builder";
import {
  addPhotos,
  moveItem,
  nextSectionPosition,
  removePhoto,
  renumberSections,
  sectionBodyToText,
  setPhotoCaption,
  textToSectionBody,
  type CoverOptions,
  type ReportSection,
  type SectionPhoto,
} from "@/api/report-builder-view";
import { deleteReport, draftReportSummary } from "@/api/reports";
import {
  isReportEmpty,
  isReportShared,
  reportPhotoIds,
  reportTitleError,
  shareStatusLabel,
  shareTogglePatch,
} from "@/api/report-view";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { radius, spacing, useTheme } from "@/theme";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Images,
  Plus,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "@/ui/icons";
import {
  Badge,
  Button,
  ButtonRow,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Icon,
  IconButton,
  ListGroup,
  ListRow,
  PhotoThumb,
  RowDivider,
  SectionHeader,
  SkeletonList,
  Text,
} from "@/ui";
import { PhotosPerPagePicker, ToggleRow } from "./ReportControls";
import { ReportPhotoPickerSheet, useReportPhotos } from "./ReportPhotoPickerSheet";

type PickerTarget =
  | { kind: "cover" }
  | { kind: "section"; sectionId: string }
  | { kind: "loose" }
  | null;

/**
 * One hand-built report, edited the way the web's report builder edits it.
 *
 * Title, subtitle and photos per page; the cover page and its photos; the
 * sections with their text and captioned photos, in order; the write-up the
 * model can draft; and the share link and PDF. The PDF and the public page are
 * rendered server-side from exactly these rows, so there is no separate
 * "publish" step: what is saved here is what the client gets.
 *
 * Text fields save when the person leaves them, as everywhere else in the app:
 * a write per keystroke is a write per keystroke on one bar of signal. Photo
 * and toggle changes save at once.
 *
 * Used full screen on a phone and as the right-hand pane on a tablet, so it
 * owns its scroll view and draws no navigation header of its own.
 */
export function ReportEditor({
  reportId,
  projectId: projectIdParam,
  onDeleted,
}: {
  reportId: string;
  projectId?: string | null;
  onDeleted?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { width } = useWindowDimensions();
  const queryKey = useMemo(() => ["report", reportId], [reportId]);

  const query = useQuery({ queryKey, queryFn: () => getBuiltReport(reportId) });
  const report = query.data ?? null;
  const projectId = projectIdParam || report?.project_id || null;

  const sectionsQuery = useQuery({
    queryKey: ["report-sections", reportId],
    queryFn: () => listReportSections(reportId),
  });

  const [title, setTitle] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [subtitle, setSubtitle] = useState("");
  const [summary, setSummary] = useState("");
  const [sections, setSections] = useState<ReportSection[]>([]);
  const [seeded, setSeeded] = useState(false);
  const [sectionsSeeded, setSectionsSeeded] = useState(false);
  const [picker, setPicker] = useState<PickerTarget>(null);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * Seed once. Re-seeding on every refetch would throw away a half-written
   * field whenever a background refresh lands, which on a phone is every time
   * the app returns to the foreground.
   */
  useEffect(() => {
    if (seeded || !report) return;
    setTitle(report.title);
    setSubtitle(report.subtitle ?? "");
    setSummary(report.summary ?? "");
    setSeeded(true);
  }, [report, seeded]);
  useEffect(() => {
    if (sectionsSeeded || !sectionsQuery.data) return;
    setSections(sectionsQuery.data);
    setSectionsSeeded(true);
  }, [sectionsQuery.data, sectionsSeeded]);

  const photosQuery = useReportPhotos(projectId);
  const placedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const id of report?.cover_photo_ids ?? []) ids.add(id);
    for (const id of report ? reportPhotoIds(report) : []) ids.add(id);
    for (const section of sections) for (const p of section.photos) ids.add(p.photo_id);
    return Array.from(ids);
  }, [report, sections]);
  const loadedUrls = photosQuery.data?.urls;
  const missing = useMemo(
    () => placedIds.filter((id) => !loadedUrls?.[id]),
    [placedIds, loadedUrls],
  );
  const extraUrls = useQuery({
    queryKey: ["report-photo-urls", reportId, missing.join(",")],
    queryFn: () => signReportPhotos(missing),
    enabled: missing.length > 0 && !photosQuery.isLoading,
    staleTime: 45 * 60 * 1000,
  });
  const urls: Record<string, string> = { ...(loadedUrls ?? {}), ...(extraUrls.data ?? {}) };

  const onError = (fallback: string) => (error: unknown) =>
    setFailure(error instanceof Error ? error.message : fallback);

  const refreshLists = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
    if (projectId) void queryClient.invalidateQueries({ queryKey: ["project-reports", projectId] });
  }, [queryClient, projectId]);

  /** Report row writes, applied to the cache first so toggles feel instant. */
  const save = useMutation({
    mutationFn: (patch: BuiltReportPatch) => patchBuiltReport(reportId, patch),
    onMutate: (patch) => {
      const before = queryClient.getQueryData<BuiltReport | null>(queryKey);
      if (before) queryClient.setQueryData(queryKey, { ...before, ...patch });
      return { before };
    },
    onSuccess: () => {
      setFailure(null);
      refreshLists();
    },
    onError: (error: unknown, _patch, context) => {
      if (context?.before) queryClient.setQueryData(queryKey, context.before);
      onError("That did not save.")(error);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  });

  const sectionSave = useMutation({
    mutationFn: (args: { id: string; patch: Parameters<typeof patchReportSection>[1] }) =>
      patchReportSection(args.id, args.patch),
    onSuccess: () => setFailure(null),
    onError: onError("That section did not save."),
  });

  const patchSectionLocal = (id: string, patch: Partial<ReportSection>) =>
    setSections((rows) => rows.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const setSectionPhotos = (id: string, photos: SectionPhoto[]) => {
    patchSectionLocal(id, { photos });
    sectionSave.mutate({ id, patch: { photos } });
  };

  const addSection = useMutation({
    mutationFn: () => addReportSection({ reportId, position: nextSectionPosition(sections) }),
    onSuccess: (section) => {
      setFailure(null);
      setSections((rows) => [...rows, section]);
    },
    onError: onError("Could not add a section."),
  });

  const removeSection = useMutation({
    mutationFn: (id: string) => deleteReportSection(id),
    onMutate: (id) => {
      const before = sections;
      setSections((rows) => rows.filter((s) => s.id !== id));
      return { before };
    },
    onError: (error: unknown, _id, context) => {
      if (context?.before) setSections(context.before);
      onError("Could not delete that section.")(error);
    },
  });

  const reorder = useMutation({
    mutationFn: (next: ReportSection[]) => saveSectionOrder(next),
    onMutate: (next) => {
      const before = sections;
      setSections(next);
      return { before };
    },
    onError: (error: unknown, _next, context) => {
      /*
       * Put the old ORDER back, keyed by id, without discarding text typed
       * during the round trip: that text has its own save in flight.
       */
      if (context?.before) {
        const order = new Map(context.before.map((s, i) => [s.id, { i, position: s.position }]));
        setSections((rows) =>
          [...rows]
            .sort((a, b) => (order.get(a.id)?.i ?? 0) - (order.get(b.id)?.i ?? 0))
            .map((s) => ({ ...s, position: order.get(s.id)?.position ?? s.position })),
        );
      }
      onError("Could not save the section order.")(error);
    },
  });

  const draft = useMutation({
    mutationFn: () => draftReportSummary(placedIds.slice(0, 50), title.trim() || undefined),
    onSuccess: (text) => {
      if (!text) {
        setFailure("The model did not return anything. Try again in a moment.");
        return;
      }
      // Into the box, not the record: saved when the person leaves the field.
      setSummary(text);
      setFailure(null);
    },
    onError: onError(
      "Could not draft the write-up. The model may be unreachable from this network.",
    ),
  });

  const remove = useMutation({
    mutationFn: () => deleteReport(reportId),
    onSuccess: () => {
      refreshLists();
      queryClient.removeQueries({ queryKey });
      onDeleted?.();
    },
    onError: onError("Could not delete this report."),
  });

  if (query.isLoading || (sectionsQuery.isLoading && !sectionsSeeded)) {
    return <SkeletonList rows={6} />;
  }
  if (query.error || !report) {
    return (
      <ErrorState
        title="Could not load this report"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const shared = isReportShared(report);
  const pdfUrl = shared ? builtReportPdfUrl(report.share_token) : null;
  const loose = reportPhotoIds(report);
  const setCover = (patch: Partial<CoverOptions>) => save.mutate(patch);
  const narrowColumn = width >= 1100 ? 820 : undefined;

  const pickerExclude =
    picker?.kind === "cover"
      ? new Set(report.cover_photo_ids)
      : picker?.kind === "section"
        ? new Set(sections.find((s) => s.id === picker.sectionId)?.photos.map((p) => p.photo_id))
        : undefined;

  const confirmDelete = () =>
    Alert.alert(
      `Delete "${report.title}"?`,
      shared
        ? "The photos stay on the project. Anyone holding the public link will get a page saying the report is gone."
        : "The photos stay on the project. Only the report goes.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove.mutate() },
      ],
    );

  return (
    <>
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingBottom: spacing.xxl * 2,
          gap: spacing.md,
          width: "100%",
          maxWidth: narrowColumn,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {failure ? (
          <Text variant="caption" tone="destructive">
            {failure}
          </Text>
        ) : null}

        <Field
          label="Report title"
          value={title}
          onChangeText={(next) => {
            setTitle(next);
            if (titleError) setTitleError(null);
          }}
          error={titleError ?? undefined}
          onBlur={() => {
            const bad = reportTitleError(title);
            if (bad) {
              setTitleError(bad);
              return;
            }
            const trimmed = title.trim();
            if (trimmed !== report.title) save.mutate({ title: trimmed });
          }}
          returnKeyType="done"
        />

        <PhotosPerPagePicker
          value={report.photos_per_page}
          onChange={(n) => save.mutate({ photos_per_page: n })}
        />

        {/* ------------------------------------------------ share and PDF */}
        <SectionHeader title="Share and PDF" />
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
                subtitle="Opens the share sheet, including Copy"
                onPress={() => {
                  const url = publicUrl("reports", report.share_token);
                  if (!url) {
                    setFailure("Sharing is not set up for this workspace, so there is no link.");
                    return;
                  }
                  void openShareSheet(url, report.title);
                }}
              />
              <RowDivider />
              <ListRow
                icon={FileText}
                title="Open the PDF"
                subtitle="View, save or print it from the browser"
                right={<Icon icon={ExternalLink} size="sm" tone="muted" />}
                onPress={() => {
                  if (pdfUrl) void WebBrowser.openBrowserAsync(pdfUrl);
                }}
              />
              <RowDivider />
              <ListRow
                icon={Send}
                title="Send the PDF"
                subtitle="Shares a link that downloads the PDF"
                onPress={() => {
                  if (pdfUrl) void openShareSheet(pdfUrl, `${report.title} (PDF)`);
                }}
              />
              <RowDivider />
              <ToggleRow
                title="Allow downloading"
                subtitle="Lets the reader save a copy from the public page"
                value={report.allow_download}
                onChange={(v) => save.mutate({ allow_download: v })}
              />
            </>
          ) : null}
        </ListGroup>
        <Text variant="caption" tone="muted">
          The PDF and the link work only while sharing is on. Turning sharing back on restores the
          same link rather than making a new one; delete the report to kill a link for good.
        </Text>
        {isReportEmpty(report) && sections.length === 0 ? (
          <Text variant="caption" tone="muted">
            This report has no sections, photos or write-up yet. The reader would get an almost
            empty page.
          </Text>
        ) : null}

        {/* ------------------------------------------------ cover page */}
        <SectionHeader title="Cover page" />
        <ListGroup>
          <ToggleRow
            title="Cover page"
            value={report.cover_enabled}
            onChange={(v) => setCover({ cover_enabled: v })}
          />
          {report.cover_enabled ? (
            <>
              <RowDivider />
              <ToggleRow
                title="Project name"
                value={report.cover_show_project_name}
                onChange={(v) => setCover({ cover_show_project_name: v })}
              />
              <RowDivider />
              <ToggleRow
                title="Address"
                value={report.cover_show_address}
                onChange={(v) => setCover({ cover_show_address: v })}
              />
              <RowDivider />
              <ToggleRow
                title="Date"
                value={report.cover_show_date}
                onChange={(v) => setCover({ cover_show_date: v })}
              />
              <RowDivider />
              <ToggleRow
                title="Author name"
                value={report.cover_show_author}
                onChange={(v) => setCover({ cover_show_author: v })}
              />
            </>
          ) : null}
        </ListGroup>
        {report.cover_enabled ? (
          <>
            <Field
              label="Subtitle (optional)"
              value={subtitle}
              onChangeText={setSubtitle}
              placeholder="A short line under the title"
              onBlur={() => {
                const next = subtitle.trim() || null;
                if (next !== (report.subtitle ?? null)) save.mutate({ subtitle: next });
              }}
            />
            <PhotoStrip
              label="Cover photos"
              ids={report.cover_photo_ids}
              urls={urls}
              emptyText="No cover photos yet. Add a hero shot or two."
              onAdd={() => setPicker({ kind: "cover" })}
              onRemove={(id) =>
                save.mutate({ cover_photo_ids: report.cover_photo_ids.filter((x) => x !== id) })
              }
            />
          </>
        ) : null}

        {/* ------------------------------------------------ write-up */}
        <SectionHeader title="Write-up" />
        <Field
          value={summary}
          onChangeText={setSummary}
          onBlur={() => {
            const next = summary.trim() || null;
            if (next !== (report.summary ?? null)) save.mutate({ summary: next });
          }}
          placeholder="What was done, what was found, what happens next"
          hint={
            placedIds.length === 0
              ? "Add photos to the report and Draft will write a first pass from them."
              : "Draft writes a first pass from the report's photos. Edit it before you send it."
          }
          multiline
          rows={6}
        />
        <ButtonRow>
          <Button
            label={draft.isPending ? "Writing" : "Draft with AI"}
            icon={Sparkles}
            variant="secondary"
            loading={draft.isPending}
            disabled={draft.isPending || placedIds.length === 0}
            onPress={() => draft.mutate()}
          />
        </ButtonRow>

        {loose.length > 0 ? (
          <PhotoStrip
            label="Report photos"
            ids={loose}
            urls={urls}
            emptyText=""
            onAdd={() => setPicker({ kind: "loose" })}
            onRemove={(id) => save.mutate({ photo_ids: loose.filter((x) => x !== id) })}
          />
        ) : null}

        {/* ------------------------------------------------ sections */}
        <SectionHeader title="Sections" count={sections.length} />
        <Text variant="caption" tone="muted">
          Each section starts a new page. Photo order decides which photos share a page.
        </Text>
        {sections.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No sections yet"
            body="Sections are the pages of the report: a heading, some text and the photos that go with it."
          />
        ) : null}
        {sections.map((section, index) => (
          <SectionCard
            key={section.id}
            section={section}
            index={index}
            total={sections.length}
            urls={urls}
            onTitle={(next) => sectionSave.mutate({ id: section.id, patch: { title: next } })}
            onBody={(html) => {
              if (html === (section.body ?? "")) return;
              patchSectionLocal(section.id, { body: html });
              sectionSave.mutate({ id: section.id, patch: { body: html } });
            }}
            onLocalTitle={(next) => patchSectionLocal(section.id, { title: next })}
            onMove={(by) => {
              const next = moveItem(sections, index, index + by);
              if (next !== sections) reorder.mutate(renumberSections(next));
            }}
            onDelete={() =>
              Alert.alert("Delete this section?", "Its text and photo captions go with it.", [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete",
                  style: "destructive",
                  onPress: () => removeSection.mutate(section.id),
                },
              ])
            }
            onAddPhotos={() => setPicker({ kind: "section", sectionId: section.id })}
            onPhotos={(photos) => setSectionPhotos(section.id, photos)}
          />
        ))}
        <Button
          label={addSection.isPending ? "Adding" : "Add section"}
          icon={Plus}
          variant="outline"
          fullWidth
          disabled={addSection.isPending}
          onPress={() => addSection.mutate()}
        />

        <View style={{ height: spacing.lg }} />
        <Button
          label={remove.isPending ? "Deleting" : "Delete report"}
          icon={Trash2}
          variant="destructive"
          fullWidth
          disabled={remove.isPending}
          onPress={confirmDelete}
        />
      </ScrollView>

      <ReportPhotoPickerSheet
        visible={picker !== null}
        projectId={projectId}
        title={
          picker?.kind === "cover"
            ? "Cover photos"
            : picker?.kind === "loose"
              ? "Photos on this report"
              : "Photos for this section"
        }
        initial={picker?.kind === "loose" ? loose : []}
        exclude={pickerExclude}
        confirmLabel={picker?.kind === "loose" ? "Use these" : "Add photos"}
        onClose={() => setPicker(null)}
        onDone={(ids) => {
          const target = picker;
          setPicker(null);
          if (!target) return;
          if (target.kind === "cover") {
            const merged = [...report.cover_photo_ids];
            for (const id of ids) if (!merged.includes(id)) merged.push(id);
            save.mutate({ cover_photo_ids: merged });
          } else if (target.kind === "loose") {
            save.mutate({ photo_ids: ids });
          } else {
            const section = sections.find((s) => s.id === target.sectionId);
            if (section) setSectionPhotos(section.id, addPhotos(section.photos, ids));
          }
        }}
      />
    </>
  );
}

/** A row of photos with remove buttons and an Add button. */
function PhotoStrip({
  label,
  ids,
  urls,
  emptyText,
  onAdd,
  onRemove,
}: {
  label: string;
  ids: string[];
  urls: Record<string, string>;
  emptyText: string;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text variant="caption" tone="muted">
          {label}
        </Text>
        <Button label="Add photos" icon={Images} size="sm" variant="outline" onPress={onAdd} />
      </View>
      {ids.length === 0 ? (
        emptyText ? (
          <Text variant="caption" tone="muted">
            {emptyText}
          </Text>
        ) : null
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs }}>
          {ids.map((id) => (
            <View key={id} style={{ width: "23.5%", aspectRatio: 4 / 3 }}>
              <PhotoThumb uri={urls[id]} width="100%" height="100%" />
              <View style={{ position: "absolute", top: 2, right: 2 }}>
                <IconButton
                  icon={X}
                  size="sm"
                  accessibilityLabel="Remove photo"
                  onPress={() => onRemove(id)}
                />
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

/** One section: heading, text, and captioned photos in order. */
function SectionCard({
  section,
  index,
  total,
  urls,
  onTitle,
  onLocalTitle,
  onBody,
  onMove,
  onDelete,
  onAddPhotos,
  onPhotos,
}: {
  section: ReportSection;
  index: number;
  total: number;
  urls: Record<string, string>;
  onTitle: (next: string) => void;
  onLocalTitle: (next: string) => void;
  onBody: (html: string) => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
  onAddPhotos: () => void;
  onPhotos: (photos: SectionPhoto[]) => void;
}) {
  const theme = useTheme();
  const body = useMemo(() => sectionBodyToText(section.body), [section.body]);
  const [text, setText] = useState(body.editable ? body.text : "");
  const [captions, setCaptions] = useState<Record<string, string>>({});
  const [savedTitle, setSavedTitle] = useState(section.title);

  return (
    <Card>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
          <Text variant="overline" tone="muted" style={{ flex: 1 }}>
            SECTION {index + 1}
          </Text>
          <IconButton
            icon={ChevronUp}
            size="sm"
            surface={false}
            accessibilityLabel="Move section up"
            disabled={index === 0}
            onPress={() => onMove(-1)}
          />
          <IconButton
            icon={ChevronDown}
            size="sm"
            surface={false}
            accessibilityLabel="Move section down"
            disabled={index === total - 1}
            onPress={() => onMove(1)}
          />
          <IconButton
            icon={Trash2}
            size="sm"
            surface={false}
            tone="destructive"
            accessibilityLabel={`Delete section ${section.title}`}
            onPress={onDelete}
          />
        </View>

        <Field
          label="Heading"
          value={section.title}
          onChangeText={onLocalTitle}
          onBlur={() => {
            const next = section.title.trim() || "Untitled section";
            if (next !== section.title) onLocalTitle(next);
            if (next !== savedTitle) {
              setSavedTitle(next);
              onTitle(next);
            }
          }}
          placeholder="e.g. Before work, Issues found"
        />

        {body.editable ? (
          <Field
            label="Text"
            value={text}
            onChangeText={setText}
            onBlur={() => onBody(textToSectionBody(text))}
            placeholder="Describe what is in this section"
            hint="Start a line with ## for a heading or - for a bullet."
            multiline
            rows={5}
          />
        ) : (
          <View
            style={{
              gap: spacing.xs,
              padding: spacing.md,
              borderRadius: radius.md,
              backgroundColor: theme.colors.secondary,
            }}
          >
            <Text variant="body">{body.preview || "(formatted text)"}</Text>
            <Text variant="caption" tone="muted">
              This text has formatting the phone cannot rebuild, such as bold, links or tables, so
              it is read-only here. Edit it on the web.
            </Text>
          </View>
        )}

        {section.photos.map((photo, i) => (
          <View
            key={photo.photo_id}
            style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}
          >
            <PhotoThumb uri={urls[photo.photo_id]} width={84} height={84} />
            <View style={{ flex: 1 }}>
              <Field
                value={captions[photo.photo_id] ?? photo.caption}
                onChangeText={(next) =>
                  setCaptions((current) => ({ ...current, [photo.photo_id]: next }))
                }
                onBlur={() => {
                  const next = captions[photo.photo_id];
                  if (next === undefined || next === photo.caption) return;
                  onPhotos(setPhotoCaption(section.photos, photo.photo_id, next));
                }}
                placeholder="Caption"
                multiline
                rows={2}
              />
            </View>
            <View>
              <IconButton
                icon={ChevronUp}
                size="sm"
                surface={false}
                accessibilityLabel="Move photo up"
                disabled={i === 0}
                onPress={() => onPhotos(moveItem(section.photos, i, i - 1))}
              />
              <IconButton
                icon={ChevronDown}
                size="sm"
                surface={false}
                accessibilityLabel="Move photo down"
                disabled={i === section.photos.length - 1}
                onPress={() => onPhotos(moveItem(section.photos, i, i + 1))}
              />
              <IconButton
                icon={X}
                size="sm"
                surface={false}
                tone="destructive"
                accessibilityLabel="Remove photo"
                onPress={() => {
                  const removed = photo;
                  if (!removed.caption.trim()) {
                    onPhotos(removePhoto(section.photos, photo.photo_id));
                    return;
                  }
                  Alert.alert("Remove this photo?", "Its caption is removed with it.", [
                    { text: "Cancel", style: "cancel" },
                    {
                      text: "Remove",
                      style: "destructive",
                      onPress: () => onPhotos(removePhoto(section.photos, photo.photo_id)),
                    },
                  ]);
                }}
              />
            </View>
          </View>
        ))}

        <Button
          label={section.photos.length ? "Add more photos" : "Add photos"}
          icon={Images}
          size="sm"
          variant="secondary"
          onPress={onAddPhotos}
        />
      </View>
    </Card>
  );
}
