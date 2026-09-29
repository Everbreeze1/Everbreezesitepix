import { useState } from "react";
import { Alert, Platform, Share, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { relativeTime } from "@everlumen/shared";
import type { PhotoListItem } from "@/api/photos";
import { listProjectReports } from "@/api/reports";
import { getTemplateGateFacts } from "@/api/report-builder";
import { templatesLockedFor } from "@/api/report-builder-view";
import {
  addPhotosToExistingReport,
  createSelectionShareLinks,
  savePhotosToPhone,
} from "@/api/photo-selection";
import {
  photoDropMessage,
  saveToPhoneRefusal,
  shareLinkRefusal,
  shareLinksMessage,
  shareLinksShortfall,
  singleProjectRefusal,
} from "@/api/photo-selection-view";
import { spacing } from "@/theme";
import { FilePlus, FileText, FolderPlus, Globe, Share2 } from "@/ui/icons";
import {
  ActionSheet,
  Button,
  EmptyState,
  Icon,
  ListGroup,
  ListRow,
  RowDivider,
  Sheet,
  SkeletonList,
  Text,
} from "@/ui";
import { GenerateReportSheet } from "./GenerateReportSheet";
import { NewBuiltReportSheet } from "./NewBuiltReportSheet";

/**
 * The bulk bar's hand-over actions: the parts of the web's photo bulk bar that
 * send a selection somewhere rather than change it.
 *
 *   save       to the phone's photo library (iOS share sheet, one per photo)
 *   share      one public link per photo, sent together in one message
 *   report     a new report, or a section added to an existing one
 *   document   the web's Generate menu, with these photos already ticked
 *
 * Reports and documents belong to one job, so a library selection that spans
 * jobs is told why rather than offered a button that fails.
 */
export type HandOverStep = "save" | "share" | "report" | "document";

type OpenSheet = "share" | "report-menu" | "report-new" | "report-existing" | "document" | null;

export type HandOverSelection = {
  photos: PhotoListItem[];
  /** The job of each selected photo, so a mixed selection can be refused. */
  projectIds: string[];
  projectName?: string;
  /** Clears the selection once the photos have gone somewhere else. */
  onFinished: () => void;
};

/** iOS will not present a modal while another is still animating out. */
const MODAL_GAP_MS = 350;

export function usePhotoHandOver(selection: HandOverSelection | undefined) {
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const later = (next: OpenSheet) => {
    setSheet(null);
    setTimeout(() => setSheet(next), MODAL_GAP_MS);
  };

  function start(step: HandOverStep) {
    if (!selection) return;
    const count = selection.photos.length;
    if (step === "save") {
      const refusal = saveToPhoneRefusal(count, Platform.OS);
      if (refusal) {
        Alert.alert(
          "Save to phone",
          refusal,
          Platform.OS === "ios"
            ? [{ text: "OK" }]
            : [
                { text: "Not now", style: "cancel" },
                { text: "Send links", onPress: () => setSheet("share") },
              ],
        );
        return;
      }
      Alert.alert(
        `Save ${count} photo${count === 1 ? "" : "s"} to your phone?`,
        'The share sheet opens once for each photo. Choose "Save Image" each time. Close a sheet to stop.',
        [
          { text: "Cancel", style: "cancel" },
          { text: "Save", onPress: () => void runSave() },
        ],
      );
      return;
    }
    if (step === "share") {
      setSheet("share");
      return;
    }
    const refusal = singleProjectRefusal(selection.projectIds);
    if (refusal) {
      Alert.alert(step === "report" ? "Report" : "Document", refusal);
      return;
    }
    setSheet(step === "report" ? "report-menu" : "document");
  }

  async function runSave() {
    if (!selection) return;
    setBusy("save");
    try {
      const { saved, stopped } = await savePhotosToPhone(selection.photos);
      if (stopped && saved < selection.photos.length) {
        Alert.alert(
          "Stopped",
          `${saved} of ${selection.photos.length} photo${
            selection.photos.length === 1 ? "" : "s"
          } went through the share sheet.`,
        );
      }
    } catch (error) {
      Alert.alert(
        "Could not save",
        error instanceof Error ? error.message : "The photos could not be downloaded.",
      );
    } finally {
      setBusy(null);
    }
  }

  const ui = selection ? (
    <HandOverSheets
      selection={selection}
      sheet={sheet}
      setSheet={setSheet}
      later={later}
      busy={busy}
      setBusy={setBusy}
    />
  ) : null;

  return { start, ui, busy: busy !== null };
}

function HandOverSheets({
  selection,
  sheet,
  setSheet,
  later,
  busy,
  setBusy,
}: {
  selection: HandOverSelection;
  sheet: OpenSheet;
  setSheet: (next: OpenSheet) => void;
  later: (next: OpenSheet) => void;
  busy: string | null;
  setBusy: (next: string | null) => void;
}) {
  const queryClient = useQueryClient();
  const projectId = selection.projectIds[0] ?? "";
  const count = selection.photos.length;
  const attach = selection.photos.map((p) => ({ id: p.id, caption: p.caption }));

  const [links, setLinks] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);
  const [shareNote, setShareNote] = useState<string | null>(null);

  const reports = useQuery({
    queryKey: ["project-reports", projectId],
    queryFn: () => listProjectReports(projectId),
    enabled: sheet === "report-existing" && Boolean(projectId),
  });

  const gate = useQuery({
    queryKey: ["report-template-gate"],
    queryFn: getTemplateGateFacts,
    enabled: sheet === "report-new",
    staleTime: 10 * 60 * 1000,
  });

  const refreshReports = () => {
    void queryClient.invalidateQueries({ queryKey: ["all-reports"] });
    void queryClient.invalidateQueries({ queryKey: ["project-reports", projectId] });
  };

  async function sendLinks(list: string[]) {
    try {
      await Share.share({ message: shareLinksMessage(list) });
    } catch {
      // Dismissing the share sheet is not a failure.
    }
  }

  async function makeLinks() {
    setBusy("share");
    setShareNote(null);
    setProgress(0);
    try {
      const result = await createSelectionShareLinks(
        selection.photos.map((p) => p.id),
        setProgress,
      );
      setLinks(result.links);
      setShareNote(shareLinksShortfall(result.links.length, count));
      if (result.links.length) await sendLinks(result.links);
    } catch (error) {
      setShareNote(error instanceof Error ? error.message : "Could not create the links.");
    } finally {
      setBusy(null);
    }
  }

  async function addToReport(reportId: string) {
    setBusy("existing");
    try {
      const { added, skipped } = await addPhotosToExistingReport(reportId, attach);
      refreshReports();
      if (added === 0) {
        Alert.alert("Already there", "Those photos are already in this report.");
        return;
      }
      setSheet(null);
      selection.onFinished();
      router.push({ pathname: "/report/[reportId]", params: { reportId, projectId } });
      Alert.alert("Added", photoDropMessage(added, skipped));
    } catch (error) {
      Alert.alert(
        "Could not add to the report",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  const shareRefusal = shareLinkRefusal(count);

  return (
    <>
      <Sheet
        visible={sheet === "share"}
        onClose={() => {
          if (busy === "share") return;
          setSheet(null);
          setLinks([]);
          setShareNote(null);
        }}
        title={`Share ${count} photo${count === 1 ? "" : "s"}`}
        subtitle="One link per photo, sent together"
        footer={
          shareRefusal ? null : (
            <Button
              label={
                busy === "share"
                  ? `Creating ${progress} of ${count}`
                  : links.length
                    ? "Send the links again"
                    : "Create links and send"
              }
              icon={Share2}
              fullWidth
              loading={busy === "share"}
              disabled={busy === "share"}
              onPress={() => (links.length ? void sendLinks(links) : void makeLinks())}
            />
          )
        }
      >
        <View style={{ gap: spacing.md }}>
          <View style={{ flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" }}>
            <Icon icon={Globe} size="md" tone="muted" />
            <Text variant="body" tone="muted" style={{ flex: 1 }}>
              Anyone with a link sees that photo and nothing else. Each link stays live until you
              turn it off on the photo itself.
            </Text>
          </View>
          {shareRefusal ? (
            <Text variant="body" tone="destructive">
              {shareRefusal}
            </Text>
          ) : null}
          {shareNote ? (
            <Text variant="caption" tone="destructive">
              {shareNote}
            </Text>
          ) : null}
          {links.length ? (
            <Text variant="caption" tone="muted" selectable>
              {shareLinksMessage(links)}
            </Text>
          ) : null}
        </View>
      </Sheet>

      <ActionSheet
        visible={sheet === "report-menu"}
        onClose={() => setSheet(null)}
        title="Report"
        actions={[
          { label: "New report", icon: FilePlus, onPress: () => later("report-new") },
          {
            label: "Add to existing report",
            icon: FolderPlus,
            onPress: () => later("report-existing"),
          },
        ]}
      />

      <Sheet
        visible={sheet === "report-existing"}
        onClose={() => (busy === "existing" ? undefined : setSheet(null))}
        title="Add to existing report"
        subtitle={`${count} photo${count === 1 ? "" : "s"}, filed as one section`}
      >
        {reports.isLoading ? (
          <SkeletonList rows={4} />
        ) : reports.error ? (
          <Text variant="body" tone="destructive">
            {reports.error instanceof Error ? reports.error.message : "Could not load reports."}
          </Text>
        ) : (reports.data ?? []).length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No reports on this job yet"
            body="Start a new report with these photos instead."
            action={{ label: "New report", onPress: () => later("report-new") }}
          />
        ) : (
          <ListGroup>
            {(reports.data ?? []).map((report, i) => (
              <View key={report.id}>
                {i > 0 ? <RowDivider /> : null}
                <ListRow
                  icon={FileText}
                  title={report.title || "Untitled report"}
                  subtitle={`Created ${relativeTime(report.created_at)}`}
                  onPress={() => (busy ? undefined : void addToReport(report.id))}
                />
              </View>
            ))}
          </ListGroup>
        )}
      </Sheet>

      {sheet === "report-new" ? (
        <NewBuiltReportSheet
          visible
          projectId={projectId}
          projectName={selection.projectName ?? ""}
          templatesLocked={templatesLockedFor(gate.data)}
          attachPhotos={attach}
          onClose={() => setSheet(null)}
          onCreated={(report) => {
            refreshReports();
            setSheet(null);
            selection.onFinished();
            router.push({
              pathname: "/report/edit/[reportId]",
              params: { reportId: report.id, projectId: report.project_id },
            });
          }}
        />
      ) : null}

      {sheet === "document" ? (
        <GenerateReportSheet
          projectId={projectId}
          projectName={selection.projectName ?? ""}
          scope="all"
          title="Make a document"
          photoIds={selection.photos.map((p) => p.id)}
          onClose={() => setSheet(null)}
        />
      ) : null}
    </>
  );
}
