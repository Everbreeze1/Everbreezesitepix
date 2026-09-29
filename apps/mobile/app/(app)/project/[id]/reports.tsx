import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { projectDisplayName, relativeTime, titleWithinProject } from "@everlumen/shared";
import { getProject } from "@/api/projects";
import { listProjectReports } from "@/api/reports";
import { listProjectReportPages, listReportCardExtras } from "@/api/report-index";
import { builtReportStatus, reportIndexSubtitle } from "@/api/report-index-view";
import { ambiguousReportIds, reportClockTime, reportSummaryLine } from "@/api/report-view";
import { GenerateReportSheet } from "@/components/GenerateReportSheet";
import { useReportActions, type ReportMenuTarget } from "@/components/ReportActionsSheet";
import { ReportCard } from "@/components/ReportCard";
import { ReportReader } from "@/components/ReportReader";
import { ReportsSplitView, useReportsTwoPane } from "@/components/ReportsSplitView";
import { radius, spacing, useTheme } from "@/theme";
import { FileText, Plus } from "@/ui/icons";
import { EmptyState, ErrorState, Icon, SkeletonList, Text } from "@/ui";

/**
 * A project's reports: every kind the web makes, and the ones already made.
 *
 * Two lists, as the web files them. Generated reports (the whole-job report,
 * reports from selected photos, documents from report templates) are report
 * pages; hand-built reports are the cover-and-sections kind. Both are here so a
 * report written on the web is never missing on the phone.
 *
 * The + opens the same menu the web's New report button does. Tapping a
 * hand-built report opens it ready to read; Edit on it opens the editor. On a
 * tablet the list stays on the left and the report reads beside it. Each row's
 * link, PDF and delete sit behind its kebab, as on the web's Reports list.
 */
export default function ProjectReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const twoPane = useReportsTwoPane();
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

  const openBuilt = (reportId: string) => {
    if (twoPane) setOpenReport(reportId);
    else router.push({ pathname: "/report/[reportId]", params: { reportId, projectId: id! } });
  };
  const editBuilt = (reportId: string) =>
    router.push({ pathname: "/report/edit/[reportId]", params: { reportId, projectId: id! } });

  const reportIds = useMemo(() => reports.map((report) => report.id), [reports]);
  // Photos and blueprint chips fill in after the words, and never block them.
  const extrasQuery = useQuery({
    queryKey: ["project-reports-extras", reportIds.join(",")],
    queryFn: () => listReportCardExtras(reportIds),
    enabled: reportIds.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const menu = useReportActions({
    onOpen: (item: ReportMenuTarget) =>
      item.kind === "page"
        ? router.push({ pathname: "/page/[pageId]", params: { pageId: item.id } })
        : openBuilt(item.id),
    onEdit: (item) => editBuilt(item.id),
    onDeleted: (item) => {
      if (openReport === item.id) setOpenReport(null);
    },
  });

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
    <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.sm }}>
      {empty ? (
        <EmptyState
          icon={FileText}
          title="No reports yet"
          body="Write a whole-job report, draft one from the photos you pick, start from a template, or build one by hand. It is the thing the client actually receives."
          action={{ label: "New report", onPress: () => setGenerating(true), icon: Plus }}
        />
      ) : null}

      {pages.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
          <Text variant="overline" tone="muted" style={{ marginTop: spacing.sm }}>
            GENERATED REPORTS
          </Text>
          {pages.map((page) => (
            <ReportCard
              key={page.id}
              title={titleWithinProject(page.title, projectName)}
              subtitle={reportIndexSubtitle({ ...page, projectName: null })}
              status={page.status}
              isPage
              onPress={() =>
                router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } })
              }
              onMenu={() => menu.open(page)}
            />
          ))}
        </View>
      ) : pagesQuery.error ? (
        <Text variant="caption" tone="muted">
          Generated reports could not be loaded just now. Pull to refresh.
        </Text>
      ) : null}

      {reports.length > 0 ? (
        <View style={{ gap: spacing.sm }}>
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
              selected={twoPane && openReport === report.id}
              thumbUri={extrasQuery.data?.thumbs[report.id]}
              blueprint={extrasQuery.data?.blueprints[report.id]}
              onPress={() => openBuilt(report.id)}
              onMenu={() =>
                menu.open({
                  kind: "report",
                  id: report.id,
                  projectId: report.project_id,
                  title: report.title,
                  shareToken: report.share_token,
                  revokedAt: report.revoked_at,
                })
              }
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
            <ReportReader
              key={openReport}
              reportId={openReport}
              projectId={id}
              onEdit={() => editBuilt(openReport)}
              onDeleted={() => setOpenReport(null)}
            />
          ) : null
        }
      />

      {menu.sheet}

      {generating && id ? (
        <GenerateReportSheet
          projectId={id}
          projectName={projectName}
          scope="all"
          onClose={() => setGenerating(false)}
          onOpenBuiltReport={(report) => {
            // A new report is empty: straight to the editor, with it open
            // beside the list on a tablet for when Done comes back.
            if (twoPane) setOpenReport(report.id);
            editBuilt(report.id);
          }}
        />
      ) : null}
    </>
  );
}
