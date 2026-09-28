import { useCallback, useState } from "react";
import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deletePage, setPageShare } from "@/api/pages";
import { builtReportPdfUrl, patchBuiltReport } from "@/api/report-builder";
import { deleteReport } from "@/api/reports";
import { isReportShared, shareTogglePatch } from "@/api/report-view";
import { openShareSheet, publicUrl } from "@/api/sharing";
import {
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  PenLine,
  Trash2,
} from "@/ui/icons";
import { ActionSheet, type SheetAction } from "@/ui";

/*
 * The sheet closes before an action runs, and iOS will not present the share
 * sheet, a browser or an alert while another modal is still animating out: it
 * drops it without a word. So anything that presents waits for the slide.
 */
const afterSheet = (run: () => void) => setTimeout(run, 350);

/** The least a row needs for its menu. */
export type ReportMenuTarget = {
  kind: "report" | "page";
  id: string;
  projectId: string;
  title: string;
  shareToken?: string | null;
  revokedAt?: string | null;
};

/**
 * A report row's secondary actions, behind its kebab.
 *
 * The web's Reports list puts exactly these in a dropdown: open, copy the
 * link, open the public page, the PDF, and turning the link off or back on.
 * Delete joins them here because the phone has no other place for it on a
 * list, and it asks first. On the phone every one of these used to be a
 * switch or a button on the row or on the report itself, and the page read as
 * a settings screen.
 *
 * One sheet per list, opened with whichever row was tapped.
 */
export function useReportActions({
  onOpen,
  onDeleted,
  onEdit,
  openLabel = "Open report",
}: {
  onOpen: (target: ReportMenuTarget) => void;
  onDeleted?: (target: ReportMenuTarget) => void;
  /** Opens a built report's editor. Adds "Edit report" beside "Open report". */
  onEdit?: (target: ReportMenuTarget) => void;
  /** The first action's words; the report's own screen offers "Edit report". */
  openLabel?: string;
}) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<ReportMenuTarget | null>(null);

  const refresh = useCallback(
    (item: ReportMenuTarget) => {
      void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
      void queryClient.invalidateQueries({ queryKey: ["project-reports", item.projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project-report-pages", item.projectId] });
      if (item.kind === "report") {
        void queryClient.invalidateQueries({ queryKey: ["report", item.id] });
      } else {
        void queryClient.invalidateQueries({ queryKey: ["project-page", item.id] });
      }
    },
    [queryClient],
  );

  const complain = (fallback: string) => (error: unknown) =>
    Alert.alert(fallback, error instanceof Error ? error.message : undefined);

  const share = useMutation({
    mutationFn: async ({ item, enable }: { item: ReportMenuTarget; enable: boolean }) => {
      if (item.kind === "page") await setPageShare(item.id, enable);
      else await patchBuiltReport(item.id, shareTogglePatch(enable));
    },
    onSuccess: (_void, { item }) => refresh(item),
    onError: complain("The link did not change"),
  });

  const remove = useMutation({
    mutationFn: async (item: ReportMenuTarget) => {
      if (item.kind === "page") await deletePage(item.id);
      else await deleteReport(item.id);
    },
    onSuccess: (_void, item) => {
      refresh(item);
      onDeleted?.(item);
    },
    onError: complain("Could not delete that report"),
  });

  const actionsFor = (item: ReportMenuTarget): SheetAction[] => {
    const live = isReportShared({
      share_token: item.shareToken ?? null,
      revoked_at: item.revokedAt ?? null,
    });
    const url = publicUrl(item.kind === "page" ? "pages" : "reports", item.shareToken ?? null);
    const pdf = item.kind === "report" ? builtReportPdfUrl(item.shareToken ?? null) : null;

    const actions: SheetAction[] = [
      {
        label: openLabel,
        icon: onEdit ? FileText : PenLine,
        onPress: () => onOpen(item),
      },
      ...(onEdit && item.kind === "report"
        ? [{ label: "Edit report", icon: PenLine, onPress: () => onEdit(item) }]
        : []),
      {
        label: "Copy link",
        icon: Copy,
        disabled: !live || !url,
        onPress: () => {
          if (url) afterSheet(() => void openShareSheet(url, item.title));
        },
      },
      {
        label: "Open the public page",
        icon: ExternalLink,
        disabled: !live || !url,
        onPress: () => {
          if (url) afterSheet(() => void WebBrowser.openBrowserAsync(url));
        },
      },
    ];
    if (item.kind === "report") {
      actions.push({
        label: "Download PDF",
        icon: Download,
        disabled: !live || !pdf,
        onPress: () => {
          if (pdf) afterSheet(() => void WebBrowser.openBrowserAsync(pdf));
        },
      });
    }
    actions.push(
      live
        ? {
            label: "Turn the link off",
            icon: EyeOff,
            onPress: () => share.mutate({ item, enable: false }),
          }
        : {
            label: "Turn the link back on",
            icon: Eye,
            onPress: () => share.mutate({ item, enable: true }),
          },
      {
        label: "Delete report",
        icon: Trash2,
        destructive: true,
        onPress: () =>
          afterSheet(() =>
            Alert.alert(
              `Delete "${item.title}"?`,
              live
                ? "The photos stay on the project. Anyone holding the public link will get a page saying the report is gone."
                : "The photos stay on the project. Only the report goes.",
              [
                { text: "Cancel", style: "cancel" },
                { text: "Delete", style: "destructive", onPress: () => remove.mutate(item) },
              ],
            ),
          ),
      },
    );
    return actions;
  };

  const sheet = (
    <ActionSheet
      visible={target !== null}
      onClose={() => setTarget(null)}
      title={target?.title}
      actions={target ? actionsFor(target) : []}
    />
  );

  return { open: setTarget, sheet };
}
