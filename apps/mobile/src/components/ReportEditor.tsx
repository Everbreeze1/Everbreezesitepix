import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, useWindowDimensions, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addReportSection,
  addTaskSections,
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
  setPhotoCaption,
  type CoverOptions,
  type ReportSection,
  type SectionPhoto,
} from "@/api/report-builder-view";
import { deleteReport, draftReportSummary } from "@/api/reports";
import { docHtml, parseDoc, type DocBlock } from "@/api/rich-doc";
import { FormattedTextEditor } from "@/components/FormattedTextEditor";
import {
  isReportEmpty,
  isReportShared,
  reportPhotoIds,
  reportTitleError,
  shareStatusLabel,
  shareTogglePatch,
} from "@/api/report-view";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { spacing, useLayout, useTheme } from "@/theme";
import {
  Check,
  ChevronDown,
  ChevronUp,
  CloudUpload,
  Copy,
  Download,
  EllipsisVertical,
  ExternalLink,
  Eye,
  FileText,
  Images,
  ListTodo,
  Plus,
  Send,
  Share2,
  Sparkles,
  Trash2,
  X,
} from "@/ui/icons";
import {
  ActionSheet,
  Button,
  ButtonRow,
  Card,
  Chip,
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
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";
import { PhotosPerPagePicker, ToggleRow } from "./ReportControls";
import { ReportPhotoPickerSheet, useReportPhotos } from "./ReportPhotoPickerSheet";
import { ReportTaskPickerSheet } from "./ReportTaskPickerSheet";

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
  // The side safe area: the notch of a phone on its side, zero upright.
  const { safeSide } = useLayout();
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
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

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

  /*
   * The web's "Add work from tasks": one section per task, after the ones
   * already here, then the list is read back so the new sections carry ids.
   */
  const addTasks = useMutation({
    mutationFn: async (
      args: Omit<Parameters<typeof addTaskSections>[0], "reportId" | "afterPosition">,
    ) => {
      const afterPosition = sections.reduce((max, s) => Math.max(max, s.position), -1);
      const added = await addTaskSections({ ...args, reportId, afterPosition });
      return { added, fresh: await listReportSections(reportId) };
    },
    onSuccess: ({ fresh }) => {
      setFailure(null);
      setSections(fresh);
      setTaskPickerOpen(false);
    },
    onError: onError("Could not add the task sections."),
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
          paddingHorizontal: spacing.lg + safeSide,
          paddingBottom: spacing.xxl * 2,
          gap: spacing.md,
          width: "100%",
          maxWidth: narrowColumn,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {/*
          The web editor's top bar, and nothing else above the title: whether
          it saved, Preview, PDF, and Copy link. The link's settings (on or
          off, downloads, sending the PDF) open from Copy link rather than
          sitting on the page as a stack of switches.
        */}
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            alignItems: "center",
            gap: spacing.sm,
          }}
        >
          <View
            accessibilityLabel={save.isPending ? "Saving" : "Auto-save on"}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, marginRight: "auto" }}
          >
            <Icon icon={save.isPending ? CloudUpload : Check} size="xs" tone="muted" />
            <Text variant="caption" tone="muted">
              {save.isPending ? "Saving" : "Auto-save on"}
            </Text>
          </View>
          <Button
            label="Preview"
            icon={Eye}
            variant="outline"
            size="sm"
            onPress={() => {
              const url = shared ? publicUrl("reports", report.share_token) : null;
              if (url) void WebBrowser.openBrowserAsync(url);
              else setShareOpen(true);
            }}
          />
          <Button
            label="PDF"
            icon={Download}
            variant="outline"
            size="sm"
            onPress={() => {
              if (pdfUrl) void WebBrowser.openBrowserAsync(pdfUrl);
              else setShareOpen(true);
            }}
          />
          <Button label="Copy link" icon={Copy} size="sm" onPress={() => setShareOpen(true)} />
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            surface={false}
            accessibilityLabel="More report actions"
            onPress={() => setMoreOpen(true)}
          />
        </View>

        {failure ? (
          <Text variant="caption" tone="destructive">
            {failure}
          </Text>
        ) : null}

        <Card>
          <View style={{ gap: spacing.md }}>
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
          </View>
        </Card>
        {isReportEmpty(report) && sections.length === 0 ? (
          <Text variant="caption" tone="muted">
            This report has no sections, photos or write-up yet. The reader would get an almost
            empty page.
          </Text>
        ) : null}

        {/* ------------------------------------------------ cover page */}
        <Card>
          <View style={{ gap: spacing.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Text variant="overline" tone="muted" style={{ flex: 1 }}>
                COVER PAGE
              </Text>
              <Chip
                label={report.cover_enabled ? "Enabled" : "Off"}
                icon={report.cover_enabled ? Check : undefined}
                selected={report.cover_enabled}
                onPress={() => setCover({ cover_enabled: !report.cover_enabled })}
              />
            </View>
            {report.cover_enabled ? (
              <>
                <Text variant="caption" tone="muted">
                  Show on cover
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
                  {(
                    [
                      ["cover_show_project_name", "Project name"],
                      ["cover_show_address", "Address"],
                      ["cover_show_date", "Date"],
                      ["cover_show_author", "Author name"],
                    ] as const
                  ).map(([key, label]) => (
                    <Chip
                      key={key}
                      label={label}
                      icon={report[key] ? Check : undefined}
                      selected={report[key]}
                      onPress={() => setCover({ [key]: !report[key] })}
                    />
                  ))}
                </View>
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
                    save.mutate({
                      cover_photo_ids: report.cover_photo_ids.filter((x) => x !== id),
                    })
                  }
                />
              </>
            ) : null}
          </View>
        </Card>

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
        <Button
          label="Add work from tasks"
          icon={ListTodo}
          variant="outline"
          fullWidth
          onPress={() => setTaskPickerOpen(true)}
        />
      </ScrollView>

      <Sheet
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        title="Share this report"
        subtitle={shareStatusLabel(report)}
      >
        <View style={{ gap: spacing.md }}>
          <ListGroup>
            <ToggleRow
              icon={Share2}
              title="Public link"
              subtitle={
                shared
                  ? "Anyone with the link can read it. Your customer sees a review button at the bottom."
                  : "Off. Preview, the PDF and the link work only while it is on."
              }
              value={shared}
              onChange={(on) => save.mutate(shareTogglePatch(on))}
            />
            {shared ? (
              <>
                <RowDivider />
                <ListRow
                  icon={Send}
                  title="Copy or send the link"
                  onPress={() => {
                    const url = publicUrl("reports", report.share_token);
                    if (!url) {
                      setFailure("Sharing is not set up for this workspace, so there is no link.");
                      setShareOpen(false);
                      return;
                    }
                    setShareOpen(false);
                    setTimeout(() => void openShareSheet(url, report.title), 350);
                  }}
                />
                <RowDivider />
                <ListRow
                  icon={FileText}
                  title="Send the PDF"
                  subtitle="Shares a link that downloads the PDF"
                  onPress={() => {
                    if (!pdfUrl) return;
                    setShareOpen(false);
                    setTimeout(() => void openShareSheet(pdfUrl, `${report.title} (PDF)`), 350);
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
            Turning the link back on restores the same link rather than making a new one. Delete the
            report to kill a link for good.
          </Text>
        </View>
      </Sheet>

      <ActionSheet
        visible={moreOpen}
        onClose={() => setMoreOpen(false)}
        title={report.title}
        actions={[
          {
            label: "Open the PDF in the browser",
            icon: ExternalLink,
            disabled: !pdfUrl,
            onPress: () => {
              if (pdfUrl) setTimeout(() => void WebBrowser.openBrowserAsync(pdfUrl), 350);
            },
          },
          {
            label: remove.isPending ? "Deleting" : "Delete report",
            icon: Trash2,
            destructive: true,
            disabled: remove.isPending,
            onPress: () => setTimeout(confirmDelete, 350),
          },
        ]}
      />

      <ReportTaskPickerSheet
        visible={taskPickerOpen}
        projectId={report.project_id}
        busy={addTasks.isPending}
        onClose={() => setTaskPickerOpen(false)}
        onAdd={(args) => addTasks.mutate(args)}
      />

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
  /*
   * The body in the web's format (the HTML its RichTextEditor writes), seeded
   * once per section. What the phone cannot edit stays a locked block and is
   * written back untouched; an `<hr>` is the web's page break and is offered
   * from the toolbar here too.
   */
  const [blocks, setBlocks] = useState<DocBlock[]>(() => parseDoc(section.body));
  // Compared in the phone's own serialisation, so an untouched body is never re-sent.
  const savedBody = useRef(docHtml(parseDoc(section.body)));
  const commitBody = useCallback(() => {
    const html = docHtml(blocks);
    if (html === savedBody.current) return;
    savedBody.current = html;
    onBody(html);
  }, [blocks, onBody]);
  // A change made only with the toolbar never blurs a field; leaving saves it.
  const commitRef = useRef(commitBody);
  commitRef.current = commitBody;
  useEffect(() => () => commitRef.current(), []);
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

        <View style={{ gap: spacing.xs }}>
          <Text variant="caption" tone="muted">
            Text
          </Text>
          <FormattedTextEditor
            blocks={blocks}
            onChange={setBlocks}
            onCommit={commitBody}
            pageBreaks
            placeholder="Describe what is in this section"
          />
        </View>

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
