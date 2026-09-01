import { useCallback, useMemo, useState } from "react";
import { Alert, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime, titleWithinProject } from "@everlumen/shared";
import { getProject } from "@/api/projects";
import { randomUUID } from "expo-crypto";
import {
  createReport,
  deleteReport,
  generateComprehensiveReport,
  listProjectReports,
} from "@/api/reports";
import {
  defaultReportTitle,
  emptyJobWarning,
  isReportShared,
  reportAiWarning,
  reportBuiltSummary,
  reportSummaryLine,
  type ReportRow,
  ambiguousReportIds,
  reportClockTime,
} from "@/api/report-view";
import { spacing } from "@/theme";
import { FileText, Plus, Sparkles, Trash2 } from "@/ui/icons";
import {
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

  /**
   * The whole-job report, written rather than built.
   *
   * A different artefact from the rows above: the service reads every photo on
   * the job and every walkthrough write-up and files the result as a page under
   * the Reports tab, not as a `project_reports` row. So this list will not show
   * it, and the screen opens the page directly instead.
   *
   * A fresh idempotency key per tap. Asking for a second whole-job report is
   * legitimate - the job has moved on - but a retry after a dropped response
   * must not bill for several LLM calls twice.
   */
  const generate = useMutation({
    mutationFn: () =>
      generateComprehensiveReport({
        projectId: id!,
        idempotencyKey: randomUUID(),
      }),
    onSuccess: (result) => {
      setFailure(null);
      /*
       * Both warnings come from the RESULT, not from a guess beforehand.
       *
       * An earlier version of this tried to warn about an empty job before the
       * call, by passing the number of existing reports as if it were a photo
       * count. Two different things, and this screen has no photo count to
       * hand. The result carries a real one, so it says so afterwards instead.
       */
      const warning = reportAiWarning(result);
      const empty = emptyJobWarning(result.photoCount);
      // Blank lines between: the counts are reassurance, the warnings are the
      // thing to read, and running them together buries the second.
      const detail = [reportBuiltSummary(result), empty, warning].filter(Boolean).join("\n\n");
      Alert.alert(result.page?.title ?? "Report written", detail, [
        { text: "Later", style: "cancel" },
        {
          text: "Open it",
          onPress: () => {
            if (result.page) {
              router.push({
                pathname: "/page/[pageId]",
                params: { pageId: result.page.id },
              });
            }
          },
        },
      ]);
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not write the report."),
  });

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

  /*
   * Which rows would otherwise be indistinguishable. Computed over the loaded
   * list rather than per row, because ambiguity is a property of the list.
   */
  const ambiguous = useMemo(() => ambiguousReportIds(reports), [reports]);

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
                        /*
                          The job's own name is the screen heading already, and
                          every report is auto-named after it, so repeating it
                          per row pushed the only distinguishing part - the date
                          - past the two-line truncation. Five reports rendered
                          as five identical "20 Charlcote Crescent - Site visit
                          ..." rows. The stored title is untouched; this is the
                          in-project reading of it.
                        */
                        title={titleWithinProject(report.title, projectQuery.data?.name)}
                        /*
                          The clock time joins the line only when another
                          report shares this one's title. Reports are named
                          from their date, so two written on the same day are
                          called the same thing - and with the same photo
                          count and the same "2w ago" the two rows become
                          identical, each with its own delete button.
                        */
                        subtitle={`${reportSummaryLine(report)} · ${
                          ambiguous.has(report.id)
                            ? reportClockTime(report.created_at)
                            : relativeTime(report.updated_at)
                        }`}
                        /*
                          Shared state reads on the subtitle line only.
                          `reportSummaryLine` already appends "shared" from the
                          same predicate, so the badge said it twice - and it
                          cost about 150px of a 360dp row, on top of the leading
                          glyph, the delete button and the chevron. Every title
                          truncated to "20 Charlco...", which on a list of site
                          reports named after the address left five rows that
                          looked identical and no way to tell which was which.
                        */
                        right={
                          <View
                            style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}
                          >
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

                {/*
                  The other kind: written for you rather than by you. Second,
                  because building one by hand is the deliberate act and this is
                  the shortcut - and because it spends several LLM calls.
                */}
                <Button
                  label={generate.isPending ? "Writing the report" : "Write a whole-job report"}
                  icon={Sparkles}
                  variant="secondary"
                  fullWidth
                  disabled={generate.isPending}
                  onPress={() => generate.mutate()}
                />
              </>
            )}
          </View>
        )}
      </Screen>
    </>
  );
}
