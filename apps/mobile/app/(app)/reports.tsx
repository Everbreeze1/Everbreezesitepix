import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listDocumentTemplates, type DocumentTemplate } from "@/api/pages";
import type { ProjectListItem } from "@/api/projects";
import { listAllReports } from "@/api/report-index";
import { groupReportIndex, reportIndexSubtitle } from "@/api/report-index-view";
import { createReport } from "@/api/reports";
import { defaultReportTitle } from "@/api/report-view";
import { groupTemplates } from "@/api/template-picker-view";
import { ReportCard } from "@/components/ReportCard";
import { ReportProjectPickerSheet } from "@/components/ReportProjectPickerSheet";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { FileText, LayoutTemplate, Plus } from "@/ui/icons";
import {
  EmptyState,
  ErrorState,
  Icon,
  ListGroup,
  ListRow,
  RowDivider,
  Screen,
  SkeletonList,
  Text,
} from "@/ui";
import { TemplatePickerSheet } from "@/ui/TemplatePickerSheet";

/**
 * Every report in the workspace, across every job.
 *
 * The web has had `/reports` for as long as it has had reports; on the phone the
 * only way to one was Projects, the right project, then Reports. That is the
 * wrong order for "the write-up I still owe on the Fisher job", which is how
 * people actually look for them.
 *
 * Two tabs, as the design has them. The first lists both kinds of report (built
 * ones and report pages, the same split the web lists) grouped by what the data
 * can honestly say: a built report with no write-up is a draft, and the rest are
 * this week's or earlier. The second lists the document templates a report can
 * be started from.
 */

type Tab = "reports" | "templates";

export default function ReportsScreen() {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("reports");
  const [failure, setFailure] = useState<string | null>(null);
  /** What the project picker is choosing a job for. */
  const [picking, setPicking] = useState<"report" | "template" | null>(null);
  const [templateProject, setTemplateProject] = useState<string | null>(null);

  const reportsQuery = useQuery({ queryKey: ["all-reports"], queryFn: listAllReports });
  const templatesQuery = useQuery({
    queryKey: ["document-templates"],
    queryFn: listDocumentTemplates,
    enabled: tab === "templates",
    staleTime: 5 * 60 * 1000,
  });

  const sections = useMemo(() => groupReportIndex(reportsQuery.data ?? []), [reportsQuery.data]);
  const templateGroups = useMemo(
    () => groupTemplates(templatesQuery.data ?? []),
    [templatesQuery.data],
  );

  /*
   * Created empty and opened straight into the editor, as a project's own
   * Reports screen does: a crew interrupted halfway through choosing photos
   * still has the row to come back to.
   */
  const create = useMutation({
    mutationFn: (project: ProjectListItem) =>
      createReport({
        projectId: project.id,
        title: defaultReportTitle(project.name ?? ""),
        summary: null,
        photoIds: [],
      }),
    onSuccess: (report) => {
      setFailure(null);
      void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
      void queryClient.invalidateQueries({ queryKey: ["project-reports", report.project_id] });
      router.push({
        pathname: "/report/[reportId]",
        params: { reportId: report.id, projectId: report.project_id },
      });
    },
    onError: (error: unknown) =>
      setFailure(error instanceof Error ? error.message : "Could not start a report."),
  });

  const activeQuery = tab === "reports" ? reportsQuery : templatesQuery;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Reports",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Start a report"
              disabled={create.isPending}
              onPress={() => setPicking("report")}
              style={({ pressed }) => ({
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: theme.colors.accent,
                opacity: pressed || create.isPending ? 0.6 : 1,
              })}
            >
              <Icon icon={Plus} size="md" tone="primary" />
            </Pressable>
          ),
        }}
      />

      <View
        accessibilityRole="tablist"
        style={{
          flexDirection: "row",
          paddingHorizontal: spacing.lg,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.border,
          backgroundColor: theme.colors.background,
        }}
      >
        {(
          [
            ["reports", "All reports"],
            ["templates", "Templates"],
          ] as const
        ).map(([id, label]) => {
          const active = tab === id;
          return (
            <Pressable
              key={id}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(id)}
              style={{
                flex: 1,
                minHeight: HIT_TARGET,
                alignItems: "center",
                justifyContent: "center",
                borderBottomWidth: 3,
                borderBottomColor: active ? theme.colors.primary : "transparent",
                marginBottom: -1,
              }}
            >
              <Text variant="bodyStrong" tone={active ? "primary" : "muted"}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Screen
        scroll
        padded={false}
        refreshing={activeQuery.isRefetching}
        onRefresh={() => void activeQuery.refetch()}
        bottomInset={spacing.xxl}
      >
        {activeQuery.isLoading ? (
          <SkeletonList rows={4} />
        ) : activeQuery.error ? (
          <ErrorState
            title={tab === "reports" ? "Could not load reports" : "Could not load templates"}
            message={activeQuery.error instanceof Error ? activeQuery.error.message : undefined}
            onRetry={() => void activeQuery.refetch()}
          />
        ) : (
          <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}>
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}

            {tab === "reports" ? (
              sections.length === 0 ? (
                <EmptyState
                  icon={FileText}
                  title="No reports yet"
                  body="A report is the photos worth showing and a write-up the client actually receives. Tap + to start one on any job."
                />
              ) : (
                sections.map((section) => (
                  <View key={section.key} style={{ gap: spacing.md, marginBottom: spacing.sm }}>
                    <Text
                      variant="overline"
                      tone="muted"
                      style={{ fontSize: 13, letterSpacing: 1, marginTop: spacing.sm }}
                    >
                      {section.title.toUpperCase()}
                    </Text>
                    {section.items.map((item) => (
                      <ReportCard
                        key={`${item.kind}:${item.id}`}
                        title={item.title}
                        subtitle={reportIndexSubtitle(item)}
                        status={item.status}
                        onPress={() =>
                          item.kind === "page"
                            ? router.push({
                                pathname: "/page/[pageId]",
                                params: { pageId: item.id },
                              })
                            : router.push({
                                pathname: "/report/[reportId]",
                                params: { reportId: item.id, projectId: item.projectId },
                              })
                        }
                      />
                    ))}
                  </View>
                ))
              )
            ) : templateGroups.length === 0 ? (
              <EmptyState
                icon={LayoutTemplate}
                title="No templates yet"
                body="Report templates are written on the web. Once your team has one, it shows up here to start from."
              />
            ) : (
              <>
                <Text variant="caption" tone="muted">
                  Pick a template, then the job it is for. Fields the job already knows are filled
                  in for you.
                </Text>
                {templateGroups.map((group) => (
                  <View key={group.category} style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
                    <Text
                      variant="overline"
                      tone="muted"
                      style={{ fontSize: 13, letterSpacing: 1, marginTop: spacing.sm }}
                    >
                      {group.category.toUpperCase()}
                    </Text>
                    <ListGroup>
                      {group.templates.map((template: DocumentTemplate, index: number) => (
                        <View key={template.id}>
                          {index > 0 ? <RowDivider /> : null}
                          <ListRow
                            icon={LayoutTemplate}
                            title={template.name}
                            subtitle={template.description ?? undefined}
                            onPress={() => setPicking("template")}
                          />
                        </View>
                      ))}
                    </ListGroup>
                  </View>
                ))}
              </>
            )}
          </View>
        )}
      </Screen>

      <ReportProjectPickerSheet
        visible={picking !== null}
        title={picking === "template" ? "Which job is it for?" : "Start a report on"}
        onClose={() => setPicking(null)}
        onPick={(project) => {
          const mode = picking;
          setPicking(null);
          /*
           * The template sheet opens after this one has gone. iOS will not
           * present a second modal while the first is still animating out, and
           * drops it without a word.
           */
          if (mode === "template") setTimeout(() => setTemplateProject(project.id), 350);
          else create.mutate(project);
        }}
      />

      {templateProject ? (
        <TemplatePickerSheet
          visible
          projectId={templateProject}
          onClose={() => setTemplateProject(null)}
          onCreated={(page) => {
            setTemplateProject(null);
            void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
            router.push({ pathname: "/page/[pageId]", params: { pageId: page.id } });
          }}
        />
      ) : null}
    </>
  );
}
