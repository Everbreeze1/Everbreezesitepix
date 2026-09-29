import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, RefreshControl, ScrollView, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getProject } from "@/api/projects";
import {
  builtReportPdfUrl,
  getBuiltReport,
  getReportLetterhead,
  listReportSections,
  patchBuiltReport,
  signReportPhotos,
} from "@/api/report-builder";
import { buildReportDocument } from "@/api/report-document";
import { isReportShared, shareTogglePatch } from "@/api/report-view";
import { openShareSheet, publicUrl } from "@/api/sharing";
import { spacing, useLayout, useTheme } from "@/theme";
import { Download, EllipsisVertical, Link2, PenLine, Share2 } from "@/ui/icons";
import { Button, ErrorState, Icon, IconButton, SkeletonList, Text } from "@/ui";
import { useReportActions } from "./ReportActionsSheet";
import { ReportDocumentView } from "./ReportDocumentView";

/**
 * One hand-built report, ready to read.
 *
 * What opens when a report is tapped: the finished document as the client
 * receives it, full width, with the web's top bar over it (Share, PDF and a
 * clear Edit). Editing is its own screen, so the thing a crew lead flicks
 * through to check before sending is not also a form that can be changed by a
 * stray thumb. The kebab holds the rest: the public page, the link on or off,
 * and delete.
 *
 * Used full screen on a phone and as the right-hand pane on a tablet, so it
 * owns its scroll view and draws no navigation header of its own.
 */
export function ReportReader({
  reportId,
  projectId: projectIdParam,
  onEdit,
  onDeleted,
}: {
  reportId: string;
  projectId?: string | null;
  onEdit: () => void;
  onDeleted?: () => void;
}) {
  const theme = useTheme();
  // The side safe area: the notch of a phone on its side, zero upright.
  const { safeSide } = useLayout();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ["report", reportId], [reportId]);

  const query = useQuery({ queryKey, queryFn: () => getBuiltReport(reportId) });
  const report = query.data ?? null;
  const projectId = projectIdParam || report?.project_id || null;

  const sectionsQuery = useQuery({
    queryKey: ["report-sections", reportId],
    queryFn: () => listReportSections(reportId),
  });
  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId!),
    enabled: Boolean(projectId),
  });
  const letterheadQuery = useQuery({
    queryKey: ["report-letterhead", report?.created_by ?? null],
    queryFn: () => getReportLetterhead(report?.created_by ?? null),
    enabled: Boolean(report?.created_by),
    staleTime: 30 * 60 * 1000,
  });

  const photoIds = useMemo(() => {
    const ids = new Set<string>(report?.cover_photo_ids ?? []);
    for (const section of sectionsQuery.data ?? []) {
      for (const photo of section.photos) ids.add(photo.photo_id);
    }
    return Array.from(ids).sort();
  }, [report, sectionsQuery.data]);
  const urlsQuery = useQuery({
    queryKey: ["report-photo-urls", reportId, photoIds.join(",")],
    queryFn: () => signReportPhotos(photoIds),
    enabled: photoIds.length > 0,
    staleTime: 45 * 60 * 1000,
  });

  const doc = useMemo(() => {
    if (!report) return null;
    const project = projectQuery.data;
    return buildReportDocument({
      report,
      sections: sectionsQuery.data ?? [],
      urls: urlsQuery.data ?? {},
      project: project
        ? {
            name: project.name,
            street: project.street,
            city: project.city,
            state: project.state,
            zip: project.zip,
          }
        : null,
      company: letterheadQuery.data?.company ?? null,
      authorName: letterheadQuery.data?.authorName ?? null,
    });
  }, [report, projectQuery.data, sectionsQuery.data, urlsQuery.data, letterheadQuery.data]);

  /** Once only: a delete from the menu and the refetch that finds it gone both land here. */
  const closed = useRef(false);
  const onDeletedRef = useRef(onDeleted);
  onDeletedRef.current = onDeleted;
  const close = useCallback(() => {
    if (closed.current) return;
    closed.current = true;
    onDeletedRef.current?.();
  }, []);

  const menu = useReportActions({
    openLabel: "Edit report",
    onOpen: () => onEdit(),
    onDeleted: close,
  });

  const turnOn = useMutation({
    mutationFn: () => patchBuiltReport(reportId, shareTogglePatch(true)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
      if (projectId) {
        void queryClient.invalidateQueries({ queryKey: ["project-reports", projectId] });
      }
    },
  });

  /*
   * Gone: deleted from the editor or from another device. Close rather than
   * leave an error on screen for a report nobody can bring back.
   */
  const gone = query.isSuccess && query.data === null;
  useEffect(() => {
    if (gone) close();
  }, [gone, close]);

  if (query.isLoading || sectionsQuery.isLoading) return <SkeletonList rows={6} />;
  if (query.error || !report || !doc) {
    return (
      <ErrorState
        title="Could not load this report"
        message={query.error instanceof Error ? query.error.message : undefined}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const shared = isReportShared(report);
  const link = publicUrl("reports", report.share_token);
  const pdf = builtReportPdfUrl(report.share_token);

  /*
   * Share and PDF both need the public link. When it is off, say so and offer
   * to turn it on, rather than greying the buttons out with no reason given.
   */
  const withLink = (what: string, run: () => void) => {
    if (shared) {
      run();
      return;
    }
    Alert.alert(
      "The link is off",
      `${what} works only while the report's public link is on. Turn it on now?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Turn on",
          onPress: () =>
            turnOn.mutate(undefined, {
              onSuccess: run,
              onError: (error) =>
                Alert.alert(
                  "The link did not change",
                  error instanceof Error ? error.message : undefined,
                ),
            }),
        },
      ],
    );
  };

  const refetch = () => {
    void query.refetch();
    void sectionsQuery.refetch();
    void urlsQuery.refetch();
  };

  return (
    <>
      <View
        style={{
          flexDirection: "row",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg + safeSide,
          paddingVertical: spacing.sm,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        }}
      >
        <View
          accessibilityLabel={shared ? "Public link on" : "Public link off"}
          style={{ flexDirection: "row", alignItems: "center", gap: 4, marginRight: "auto" }}
        >
          <Icon icon={Link2} size="xs" tone={shared ? "success" : "muted"} />
          <Text variant="caption" tone={shared ? "success" : "muted"}>
            {shared ? "Link on" : "Link off"}
          </Text>
        </View>
        <Button
          label="Share"
          icon={Share2}
          variant="outline"
          size="sm"
          disabled={turnOn.isPending}
          onPress={() =>
            withLink("Sharing", () => {
              if (link) void openShareSheet(link, report.title);
              else Alert.alert("No link", "Sharing is not set up for this workspace.");
            })
          }
        />
        <Button
          label="PDF"
          icon={Download}
          variant="outline"
          size="sm"
          disabled={turnOn.isPending}
          onPress={() =>
            withLink("The PDF", () => {
              if (pdf) void WebBrowser.openBrowserAsync(pdf);
            })
          }
        />
        <Button label="Edit" icon={PenLine} size="sm" onPress={onEdit} />
        <IconButton
          icon={EllipsisVertical}
          size="sm"
          surface={false}
          accessibilityLabel="More report actions"
          onPress={() =>
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
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: theme.colors.background }}
        contentContainerStyle={{
          padding: spacing.lg,
          paddingHorizontal: spacing.lg + safeSide,
          paddingBottom: spacing.xxl * 2,
          width: "100%",
          maxWidth: 820,
          alignSelf: "center",
        }}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching || sectionsQuery.isRefetching}
            onRefresh={refetch}
            tintColor={theme.colors.mutedForeground}
            colors={[theme.colors.primary]}
          />
        }
      >
        <ReportDocumentView doc={doc} />
      </ScrollView>

      {menu.sheet}
    </>
  );
}
