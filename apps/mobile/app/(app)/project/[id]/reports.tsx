import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { projectDisplayName, relativeTime, titleWithinProject } from "@everlumen/shared";
import { getProject } from "@/api/projects";
import { deleteReport, listProjectReports } from "@/api/reports";
import { listProjectReportPages } from "@/api/report-index";
import { builtReportStatus, reportIndexSubtitle } from "@/api/report-index-view";
import {
  ambiguousReportIds,
  isReportShared,
  reportClockTime,
  reportSummaryLine,
  type ReportRow,
} from "@/api/report-view";
import { GenerateReportSheet } from "@/components/GenerateReportSheet";
import { ReportCard } from "@/components/ReportCard";
import { ReportEditor } from "@/components/ReportEditor";
import { ReportsSplitView, useReportsTwoPane } from "@/components/ReportsSplitView";
import { radius, spacing, useTheme } from "@/theme";
import { FileText, Plus, Trash2 } from "@/ui/icons";
import { EmptyState, ErrorState, Icon, IconButton, SkeletonList, Text } from "@/ui";

/**
 * A project's reports: every kind the web makes, and the ones already made.
 *
 * Two lists, as the web files them. Generated reports (the whole-job report,
 * reports from selected photos, documents from report templates) are report
 * pages; hand-built reports are the cover-and-sections kind. Both are here so a
 * report written on the web is never missing on the phone.
 *
 * The + opens the same menu the web's New report button does. On a tablet the
 * list stays on the left and a hand-built report opens beside it.
 */
export default function ProjectReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const queryClient = useQueryClient();
  const twoPane = useReportsTwoPane();
  const [failure, setFailure] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [openReport, setOpenReport] = useState<string | null>(null);

  const queryKey = useMemo(() => ["project-reports", id], [id]);

  const reportsQuery = useQuery({
    queryKey,
    queryFn: () => listProjectReports(id!),
    enabled: Boolean(id),
  });
  const pagesQuery = useQuery({
    queryKey: ["project-report-pages", id],
    queryFn: () => listProjectReportPages(id!),
    enabled: Boolean(id),
  });
  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });
  const projectName = projectQuery.data ? projectDisplayName(projectQuery.data) : "";

  const reports = useMemo(() => reportsQuery.data ?? [], [reportsQuery.data]);
  const pages = useMemo(() => pagesQuery.data ?? [], [pagesQuery.data]);
  const ambiguous = useMemo(() => ambiguousReportIds(reports), [reports]);

  const remove = useMutation({
    mutationFn: (reportId: string) => deleteReport(reportId),
    onSuccess: (_void, reportId) => {
      if (openReport === reportId) setOpenReport(null);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not delete that report."),
  });

  const confirmDelete = useCallback(
    (report: ReportRow) => {
      Alert.alert(
        `Delete "${report.title}"?`,
        isReportShared(report)
          ? "The photos stay on the project. Anyone holding the public link will get a page saying the report is gone."
          : "The photos stay on the project. Only the report goes.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => remove.mutate(report.id) },
        ],
      );
    },
    [remove],
  );

  const openBuilt = (reportId: string) => {
    if (twoPane) setOpenReport(reportId);
    else router.push({ pathname: "/report/[reportId]", params: { reportId, projectId: id! } });
  };

  const refetch = () => {
    void reportsQuery.refetch();
    void pagesQuery.refetch();
  };

  const loading = reportsQuery.isLoading && pagesQuery.isLoading;
  const empty = reports.length === 0 && pages.length === 0;

  const list = loading ? (
    <SkeletonList rows={4} />
  ) : reportsQuery.error ? (
    <ErrorState
      title="Could not load reports"
      message={reportsQuery.error instanceof Error ? reportsQuery.error.message : undefined}
      onRetry={refetch}
    />
  ) : (
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
      {failure ? (
        <Text variant="caption" tone="destructive">
          {failure}
        </Text>
      ) : null}

      {empty ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          body="Write a whole-job report, draft one from the photos you pick, start from a template, or build one by hand. It is the thing the client actually receives."
          action={{ label: "New report", onPress: () => setGenerating(true), icon: Plus }}
        />
      ) : null}

      {pages.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="overline" tone="muted" style={{ marginTop: spacing.sm }}>
            GENERATED REPORTS
          </Text>
          {pages.map((page) => (
            <ReportCard
              key={page.id}
              title={titleWithinProject(page.title, projectName)}
              subtitle={reportIndexSubtitle({ ...page, projectName: null })}
              status={page.status}
              onPress={() =>
                router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } })
              }
            />
          ))}
        </View>
      ) : pagesQuery.error ? (
        <Text variant="caption" tone="muted">
          Generated reports could not be loaded just now. Pull to refresh.
        </Text>
      ) : null}

      {reports.length > 0 ? (
        <View style={{ gap: spacing.md }}>
          <Text variant="overline" tone="muted" style={{ marginTop: spacing.sm }}>
            BUILT REPORTS
          </Text>
          {reports.map((report) => (
            <ReportCard
              key={report.id}
              title={titleWithinProject(report.title, projectQuery.data?.name)}
              subtitle={`${reportSummaryLine(report)} · ${
                ambiguous.has(report.id)
                  ? reportClockTime(report.created_at)
                  : relativeTime(report.updated_at)
              }`}
              status={builtReportStatus(report)}
              accessory={
                <IconButton
                  icon={Trash2}
                  tone="destructive"
                  surface={false}
                  size="sm"
                  accessibilityLabel={`Delete ${report.title}`}
                  onPress={() => confirmDelete(report)}
                />
              }
              onPress={() => openBuilt(report.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: "Reports",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New report"
              onPress={() => setGenerating(true)}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.accent,
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Icon icon={Plus} size="md" tone="primary" />
            </Pressable>
          ),
        }}
      />

      <ReportsSplitView
        list={list}
        refreshing={reportsQuery.isRefetching || pagesQuery.isRefetching}
        onRefresh={refetch}
        detail={
          openReport ? (
            <ReportEditor
              key={openReport}
              reportId={openReport}
              projectId={id}
              onDeleted={() => setOpenReport(null)}
            />
          ) : null
        }
      />

      {generating && id ? (
        <GenerateReportSheet
          projectId={id}
          projectName={projectName}
          scope="all"
          onClose={() => setGenerating(false)}
          onOpenBuiltReport={(report) => openBuilt(report.id)}
        />
      ) : null}
    </>
  );
}
