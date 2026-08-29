import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import { getProject } from "@/api/projects";
import { createReport, deleteReport, listProjectReports } from "@/api/reports";
import {
  defaultReportTitle,
  isReportShared,
  reportSummaryLine,
  type ReportRow,
} from "@/api/report-view";
import { spacing } from "@/theme";
import { FileText, Plus, Share2, Trash2 } from "@/ui/icons";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";

/**
 * A project's reports.
 *
 * The report is the product. Everything else the app does exists so this can be
 * produced, and it was the one artifact the phone could neither make nor read,
 * which is backwards for a crew who finish at four and would rather send the
 * write-up from the van than from a desk the next morning.
 *
 * A new report is created empty and opens straight into its editor, the same
 * way a site log does: making the row first means a crew interrupted halfway
 * through choosing photos still has something to come back to.
 */
export default function ProjectReportsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string | null>(null);

  const queryKey = useMemo(() => ["project-reports", id], [id]);

  const reportsQuery = useQuery({
    queryKey,
    queryFn: () => listProjectReports(id!),
    enabled: Boolean(id),
  });
  const projectQuery = useQuery({
    queryKey: ["project", id],
    queryFn: () => getProject(id!),
    enabled: Boolean(id),
  });

  const reports = reportsQuery.data ?? [];

  const create = useMutation({
    mutationFn: () =>
      createReport({
        projectId: id!,
        title: defaultReportTitle(projectQuery.data?.name ?? ""),
        summary: null,
        photoIds: [],
      }),
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey });
      router.push({
        pathname: "/report/[reportId]",
        params: { reportId: report.id, projectId: id! },
      });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not start a report."),
  });

  const remove = useMutation({
    mutationFn: (reportId: string) => deleteReport(reportId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not delete that report."),
  });

  const confirmDelete = useCallback(
    (report: ReportRow) => {
      Alert.alert(
        `Delete "${report.title}"?`,
        isReportShared(report)
          ? "The photos stay on the project. Anyone holding the public link will get a page saying the report is gone."
          : "The photos stay on the project. Only the write-up goes.",
        [
          { text: "Cancel", style: "cancel" },
          { text: "Delete", style: "destructive", onPress: () => remove.mutate(report.id) },
        ],
      );
    },
    [remove],
  );

  return (
    <>
      <Stack.Screen options={{ title: "Reports" }} />

      <Screen
        scroll
        padded={false}
        refreshing={reportsQuery.isRefetching}
        onRefresh={() => void reportsQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        {reportsQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : reportsQuery.error ? (
          <ErrorState
            title="Could not load reports"
            message={reportsQuery.error instanceof Error ? reportsQuery.error.message : undefined}
            onRetry={() => void reportsQuery.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {reports.length === 0 ? (
              <EmptyState
                icon={FileText}
                title="No reports yet"
                body="Pick the photos worth showing, let the model draft the write-up, edit it, and send a link. It is the thing the client actually receives."
                action={{ label: "Start a report", onPress: () => create.mutate(), icon: Plus }}
              />
            ) : (
              <>
                <ListGroup>
                  {reports.map((report, index) => (
                    <View key={report.id}>
                      {index > 0 ? <RowDivider /> : null}
                      <ListRow
                        icon={FileText}
                        title={report.title}
                        subtitle={`${reportSummaryLine(report)} · ${relativeTime(report.updated_at)}`}
                        right={
                          <View
                            style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                          >
                            {/*
                              Shared state on the row, because it is the one
                              thing about a report that is true outside this
                              workspace and the one thing somebody needs to know
                              before deleting it.
                            */}
                            {isReportShared(report) ? (
                              <Badge label="Shared" tone="success" icon={Share2} />
                            ) : null}
                            <IconButton
                              icon={Trash2}
                              tone="destructive"
                              surface={false}
                              accessibilityLabel={`Delete ${report.title}`}
                              onPress={() => confirmDelete(report)}
                            />
                          </View>
                        }
                        onPress={() =>
                          router.push({
                            pathname: "/report/[reportId]",
                            params: { reportId: report.id, projectId: id! },
                          })
                        }
                      />
                    </View>
                  ))}
                </ListGroup>

                <Button
                  label="Start a report"
                  icon={Plus}
                  variant="secondary"
                  fullWidth
                  disabled={create.isPending}
                  onPress={() => create.mutate()}
                />
              </>
            )}
          </View>
        )}
      </Screen>
    </>
  );
}
