import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { router, Stack } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { projectDisplayName } from "@everlumen/shared";
import { listDocumentTemplates, type DocumentTemplate } from "@/api/pages";
import type { ProjectListItem } from "@/api/projects";
import { listAllReports, listReportCardExtras } from "@/api/report-index";
import { groupReportIndex, reportIndexSubtitle, searchReportIndex } from "@/api/report-index-view";
import { groupTemplates } from "@/api/template-picker-view";
import { GenerateReportSheet } from "@/components/GenerateReportSheet";
import { useReportActions, type ReportMenuTarget } from "@/components/ReportActionsSheet";
import { ReportCard } from "@/components/ReportCard";
import { ReportReader } from "@/components/ReportReader";
import { ReportProjectPickerSheet } from "@/components/ReportProjectPickerSheet";
import { ReportsSplitView, useReportsTwoPane } from "@/components/ReportsSplitView";
import { HIT_TARGET, radius, spacing, useTheme } from "@/theme";
import { FileText, LayoutTemplate, Plus } from "@/ui/icons";
import {
  EmptyState,
  ErrorState,
  Icon,
  ListGroup,
  ListRow,
  RowDivider,
  SearchField,
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
  const twoPane = useReportsTwoPane();
  const [search, setSearch] = useState("");
  /** What the project picker is choosing a job for. */
  const [picking, setPicking] = useState<"report" | "template" | null>(null);
  const [templateProject, setTemplateProject] = useState<string | null>(null);
  /** The job the New report menu is open for. */
  const [generateFor, setGenerateFor] = useState<ProjectListItem | null>(null);
  /** On a tablet, the built report open beside the list. */
  const [openReport, setOpenReport] = useState<{ id: string; projectId: string } | null>(null);

  const reportsQuery = useQuery({ queryKey: ["all-reports"], queryFn: listAllReports });
  const templatesQuery = useQuery({
    queryKey: ["document-templates"],
    queryFn: listDocumentTemplates,
    enabled: tab === "templates",
    staleTime: 5 * 60 * 1000,
  });

  const builtIds = useMemo(
    () => (reportsQuery.data ?? []).filter((item) => item.kind === "report").map((item) => item.id),
    [reportsQuery.data],
  );
  // Photos and blueprint chips fill in after the words, and never block them.
  const extrasQuery = useQuery({
    queryKey: ["all-reports-extras", builtIds.join(",")],
    queryFn: () => listReportCardExtras(builtIds),
    enabled: builtIds.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const sections = useMemo(
    () => groupReportIndex(searchReportIndex(reportsQuery.data ?? [], search)),
    [reportsQuery.data, search],
  );
  const templateGroups = useMemo(
    () => groupTemplates(templatesQuery.data ?? []),
    [templatesQuery.data],
  );

  const openBuilt = (reportId: string, projectId: string) => {
    if (twoPane) setOpenReport({ id: reportId, projectId });
    else router.push({ pathname: "/report/[reportId]", params: { reportId, projectId } });
  };
  const editBuilt = (reportId: string, projectId: string) =>
    router.push({ pathname: "/report/edit/[reportId]", params: { reportId, projectId } });

  const openItem = (item: ReportMenuTarget) =>
    item.kind === "page"
      ? router.push({ pathname: "/page/[pageId]", params: { pageId: item.id } })
      : openBuilt(item.id, item.projectId);

  const menu = useReportActions({
    onOpen: openItem,
    onEdit: (item) => editBuilt(item.id, item.projectId),
    onDeleted: (item) => {
      if (openReport?.id === item.id) setOpenReport(null);
    },
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
              accessibilityLabel="New report"
              onPress={() => setPicking("report")}
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

      <ReportsSplitView
        refreshing={activeQuery.isRefetching}
        onRefresh={() => void activeQuery.refetch()}
        detail={
          openReport ? (
            <ReportReader
              key={openReport.id}
              reportId={openReport.id}
              projectId={openReport.projectId}
              onEdit={() => editBuilt(openReport.id, openReport.projectId)}
              onDeleted={() => setOpenReport(null)}
            />
          ) : null
        }
        list={
          activeQuery.isLoading ? (
            <SkeletonList rows={4} />
          ) : activeQuery.error ? (
            <ErrorState
              title={tab === "reports" ? "Could not load reports" : "Could not load templates"}
              message={activeQuery.error instanceof Error ? activeQuery.error.message : undefined}
              onRetry={() => void activeQuery.refetch()}
            />
          ) : (
            <View
              style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.lg, gap: spacing.md }}
            >
              {tab === "reports" && (reportsQuery.data ?? []).length > 0 ? (
                <View style={{ marginHorizontal: -spacing.lg }}>
                  <SearchField
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Search reports or jobs"
                    accessibilityLabel="Search reports"
                  />
                </View>
              ) : null}

              {tab === "reports" ? (
                sections.length === 0 && search.trim() ? (
                  <EmptyState
                    icon={FileText}
                    title="No matches"
                    body="Try a different word from the report title or the job name."
                  />
                ) : sections.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No reports yet"
                    body="Write a whole-job report, draft one from photos, start from a template or build one by hand. Tap + and pick the job."
                  />
                ) : (
                  sections.map((section) => (
                    <View key={section.key} style={{ gap: spacing.sm, marginBottom: spacing.sm }}>
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
                          isPage={item.kind === "page"}
                          selected={
                            twoPane && item.kind === "report" && openReport?.id === item.id
                          }
                          thumbUri={extrasQuery.data?.thumbs[item.id]}
                          blueprint={extrasQuery.data?.blueprints[item.id]}
                          onPress={() => openItem(item)}
                          onMenu={() => menu.open(item)}
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
                    <View
                      key={group.category}
                      style={{ gap: spacing.sm, marginBottom: spacing.sm }}
                    >
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
          )
        }
      />

      <ReportProjectPickerSheet
        visible={picking !== null}
        title={picking === "template" ? "Which job is it for?" : "New report for which job?"}
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
          else setTimeout(() => setGenerateFor(project), 350);
        }}
      />

      {menu.sheet}

      {generateFor ? (
        <GenerateReportSheet
          projectId={generateFor.id}
          projectName={projectDisplayName(generateFor)}
          scope="all"
          onClose={() => setGenerateFor(null)}
          onOpenBuiltReport={(report) => {
            // A new report is empty: straight to the editor, with it open
            // beside the list on a tablet for when Done comes back.
            if (twoPane) setOpenReport({ id: report.id, projectId: report.project_id });
            editBuilt(report.id, report.project_id);
          }}
        />
      ) : null}

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
