import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { createPage } from "@/api/pages";
import {
  generatePhotoReportPage,
  getTemplateGateFacts,
  type BuiltReport,
} from "@/api/report-builder";
import {
  generateOptions,
  generatePhotoError,
  MAX_GENERATE_PHOTOS,
  templatesLockedFor,
  type GenerateKind,
  type PhotosPerPage,
} from "@/api/report-builder-view";
import { generateComprehensiveReport } from "@/api/reports";
import { emptyJobWarning, reportAiWarning, reportBuiltSummary } from "@/api/report-view";
import { generateSummaryFromPhotos } from "@/api/summaries";
import { radius, spacing, useTheme } from "@/theme";
import { ClipboardCheck, FileText, Library, Lock, PenLine, Sparkles, Video } from "@/ui/icons";
import { Badge, Icon, Sheet, Text, type LucideIcon } from "@/ui";
import { TemplatePickerSheet } from "@/ui/TemplatePickerSheet";
import { NewBuiltReportSheet } from "./NewBuiltReportSheet";
import { PhotosPerPagePicker } from "./ReportControls";
import { ReportPhotoPickerSheet } from "./ReportPhotoPickerSheet";

const ICONS: Record<GenerateKind, LucideIcon> = {
  summary: Video,
  full_report: Sparkles,
  photo_report: ClipboardCheck,
  built_report: PenLine,
  template: Library,
  blank_page: FileText,
};

type Step = "menu" | "summary" | "photo_report" | "built_report" | "template" | null;

/**
 * Every kind of report the web's Generate menu makes, for one job.
 *
 * The same kinds, in the same order and words as `GenerateDocumentMenu`, so a
 * crew who learned it on the desktop finds it here. Each kind that needs photos
 * picks them first; each that needs a template picks it first; the result
 * opens straight away.
 *
 * Mounted only while in use: the parent renders it when somebody asks for a new
 * report and unmounts it on close, so every open starts from the menu.
 */
export function GenerateReportSheet({
  projectId,
  projectName,
  scope = "reports",
  onClose,
  onOpenBuiltReport,
}: {
  projectId: string;
  projectName: string;
  scope?: "reports" | "all";
  onClose: () => void;
  /** Where a hand-built report opens. Defaults to its own screen. */
  onOpenBuiltReport?: (report: BuiltReport) => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("menu");
  const [perPage, setPerPage] = useState<PhotosPerPage>(2);
  const [failure, setFailure] = useState<string | null>(null);

  const gate = useQuery({
    queryKey: ["report-template-gate"],
    queryFn: getTemplateGateFacts,
    staleTime: 10 * 60 * 1000,
  });
  const templatesLocked = templatesLockedFor(gate.data);

  /*
   * One modal at a time. iOS will not present a second modal while the first
   * is still animating out and drops it without a word, so the menu closes and
   * the next step opens a moment later.
   */
  const goTo = (next: Step) => {
    setStep(null);
    setTimeout(() => setStep(next), 350);
  };

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
    void queryClient.invalidateQueries({ queryKey: ["project-reports", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["project-report-pages", projectId] });
    void queryClient.invalidateQueries({ queryKey: ["document-tree", projectId] });
  };

  const openPage = (pageId: string) => {
    refresh();
    onClose();
    router.push({ pathname: "/page/[pageId]", params: { pageId } });
  };

  const fail = (fallback: string) => (error: unknown) =>
    setFailure(error instanceof Error ? error.message : fallback);

  /* The whole-job report reads every photo, so it asks for none. */
  const full = useMutation({
    mutationFn: () => generateComprehensiveReport({ projectId, idempotencyKey: randomUUID() }),
    onSuccess: (result) => {
      refresh();
      const detail = [
        reportBuiltSummary(result),
        emptyJobWarning(result.photoCount),
        reportAiWarning(result),
      ]
        .filter(Boolean)
        .join("\n\n");
      onClose();
      Alert.alert(result.page?.title ?? "Report written", detail, [
        { text: "Later", style: "cancel" },
        {
          text: "Open it",
          onPress: () => {
            if (result.page) {
              router.push({ pathname: "/page/[pageId]", params: { pageId: result.page.id } });
            }
          },
        },
      ]);
    },
    onError: fail("Could not write the report."),
  });

  const photoReport = useMutation({
    mutationFn: (photoIds: string[]) =>
      generatePhotoReportPage({
        projectId,
        photoIds,
        photosPerPage: perPage,
        idempotencyKey: randomUUID(),
      }),
    onSuccess: (result) => {
      if (result.aiFailed) {
        Alert.alert(
          "Created without AI text",
          "The model could not be reached, so the report has its structure and photos but no written text yet.",
        );
      }
      openPage(result.pageId);
    },
    onError: fail("Could not generate the report."),
  });

  const summary = useMutation({
    mutationFn: (photoIds: string[]) =>
      generateSummaryFromPhotos({ projectId, photoIds, idempotencyKey: randomUUID() }),
    onSuccess: ({ summaryId }) => {
      refresh();
      void queryClient.invalidateQueries({ queryKey: ["project-summaries", projectId] });
      onClose();
      if (summaryId) {
        router.push({ pathname: "/summary/[summaryId]", params: { summaryId } });
      } else {
        Alert.alert("Summary saved", "You will find it under Walkthroughs.");
      }
    },
    onError: fail("Could not write the summary."),
  });

  const blank = useMutation({
    mutationFn: () => createPage({ projectId, template: "blank" }),
    onSuccess: (page) => openPage(page.id),
    onError: fail("Could not create the page."),
  });

  const busy = full.isPending || blank.isPending;

  const choose = (kind: GenerateKind) => {
    setFailure(null);
    switch (kind) {
      case "full_report":
        full.mutate();
        return;
      case "blank_page":
        blank.mutate();
        return;
      case "template":
        if (templatesLocked) {
          Alert.alert(
            "Templates are on Pro and Team",
            "Starter builds documents and reports by hand, with every layout control still available.",
          );
          return;
        }
        goTo("template");
        return;
      default:
        goTo(kind);
    }
  };

  const options = generateOptions(scope);

  return (
    <>
      <Sheet
        visible={step === "menu"}
        onClose={onClose}
        title="New report"
        subtitle={projectName || undefined}
      >
        <View style={{ gap: spacing.xs }}>
          {failure ? (
            <Text variant="caption" tone="destructive" style={{ marginBottom: spacing.sm }}>
              {failure}
            </Text>
          ) : null}
          {options.map((option, index) => {
            const newGroup = index === 0 || options[index - 1].group !== option.group;
            const lockedRow = option.pro && templatesLocked;
            const running =
              (option.kind === "full_report" && full.isPending) ||
              (option.kind === "blank_page" && blank.isPending);
            return (
              <View key={option.kind}>
                {newGroup ? (
                  <Text
                    variant="overline"
                    tone="muted"
                    style={{ marginTop: index === 0 ? 0 : spacing.md, marginBottom: spacing.xs }}
                  >
                    {option.group.toUpperCase()}
                  </Text>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={option.title}
                  accessibilityHint={option.description}
                  accessibilityState={{ disabled: busy, busy: running }}
                  disabled={busy}
                  onPress={() => choose(option.kind)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: spacing.md,
                    minHeight: 60,
                    paddingHorizontal: spacing.md,
                    paddingVertical: spacing.sm,
                    borderRadius: radius.md,
                    opacity: busy && !running ? 0.45 : 1,
                    backgroundColor: pressed ? theme.colors.secondary : "transparent",
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.md,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: theme.colors.accent,
                    }}
                  >
                    {running ? (
                      <ActivityIndicator color={theme.colors.primary} />
                    ) : (
                      <Icon icon={lockedRow ? Lock : ICONS[option.kind]} size="md" tone="primary" />
                    )}
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                      <Text variant="bodyStrong">
                        {running
                          ? option.kind === "full_report"
                            ? "Writing the report"
                            : "Creating"
                          : option.title}
                      </Text>
                      {lockedRow ? <Badge label="Pro" tone="neutral" variant="outline" /> : null}
                    </View>
                    <Text variant="caption" tone="muted">
                      {running && option.kind === "full_report"
                        ? "Reading every photo on the job. This can take a minute."
                        : option.description}
                    </Text>
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </Sheet>

      <ReportPhotoPickerSheet
        visible={step === "summary"}
        projectId={projectId}
        title="Photos for the summary"
        max={MAX_GENERATE_PHOTOS}
        confirmLabel={summary.isPending ? "Writing the summary" : "Write the summary"}
        busy={summary.isPending}
        options={
          failure ? (
            <Text variant="caption" tone="destructive">
              {failure}
            </Text>
          ) : null
        }
        onClose={() => (summary.isPending ? undefined : onClose())}
        onDone={(ids) => {
          const bad = generatePhotoError(ids.length);
          if (bad) setFailure(bad);
          else summary.mutate(ids);
        }}
      />

      <ReportPhotoPickerSheet
        visible={step === "photo_report"}
        projectId={projectId}
        title="Photos for the report"
        max={MAX_GENERATE_PHOTOS}
        confirmLabel={photoReport.isPending ? "Writing the report" : "Generate report"}
        busy={photoReport.isPending}
        options={
          <View style={{ gap: spacing.sm }}>
            <PhotosPerPagePicker value={perPage} onChange={setPerPage} />
            {failure ? (
              <Text variant="caption" tone="destructive">
                {failure}
              </Text>
            ) : null}
          </View>
        }
        onClose={() => (photoReport.isPending ? undefined : onClose())}
        onDone={(ids) => {
          const bad = generatePhotoError(ids.length);
          if (bad) setFailure(bad);
          else photoReport.mutate(ids);
        }}
      />

      <NewBuiltReportSheet
        visible={step === "built_report"}
        projectId={projectId}
        projectName={projectName}
        templatesLocked={templatesLocked}
        onClose={onClose}
        onCreated={(report) => {
          refresh();
          onClose();
          if (onOpenBuiltReport) onOpenBuiltReport(report);
          else
            router.push({
              pathname: "/report/[reportId]",
              params: { reportId: report.id, projectId: report.project_id },
            });
        }}
      />

      <TemplatePickerSheet
        visible={step === "template"}
        projectId={projectId}
        onClose={onClose}
        onCreated={(page) => openPage(page.id)}
      />
    </>
  );
}
