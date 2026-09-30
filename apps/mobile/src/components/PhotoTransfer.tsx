import { useRef, useState } from "react";
import { Alert, Linking, Platform, View } from "react-native";
import type { PhotoListItem } from "@/api/photos";
import {
  buildPhotoZip,
  listAllProjectPhotos,
  requestSavePermission,
  savePhotoToPhone,
  savePhotosToPhone,
  shareZip,
} from "@/api/photo-download";
import {
  saveProgressLabel,
  savePermissionMessage,
  saveResultMessage,
  saveToPhoneRefusal,
} from "@/api/photo-selection-view";
import { zipProgressLabel, zipResultMessage, type ZipLayout } from "@/api/photo-zip-view";
import { spacing } from "@/theme";
import { X } from "@/ui/icons";
import { Button, ProgressBar, Sheet, Text } from "@/ui";

/**
 * Photos leaving the app as files, with the progress and the questions that
 * go with it: the bulk bar's "Save" and "Download zip", the project menu's
 * "Download photos", and the viewer's single "Save".
 *
 * A run of many photos shows a sheet with a bar and a Cancel, because a whole
 * job over site signal is minutes, not seconds, and a spinner with no way out
 * is how people end up force-quitting the app. The result is said once the
 * sheet is gone, and says plainly when some photos did not make it.
 */

/** iOS will not present an alert or share sheet while a modal animates out. */
const MODAL_GAP_MS = 350;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Run = { title: string; label: string; done: number; total: number };

/**
 * Ask for add-only access, and when it is refused say where to change it,
 * with a button that goes there.
 */
async function ensureSavePermission(): Promise<boolean> {
  const answer = await requestSavePermission();
  if (answer === "granted") return true;
  Alert.alert("Allow Everlumen to add photos", savePermissionMessage(answer, Platform.OS), [
    { text: "Not now", style: "cancel" },
    { text: "Open Settings", onPress: () => void Linking.openSettings() },
  ]);
  return false;
}

function failureText(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Save one photo from the viewer. No progress sheet: the viewer's own share
 * sheet is already open and a second modal over it would not show on iOS.
 */
export async function saveOnePhoto(photo: PhotoListItem): Promise<void> {
  try {
    if (!(await ensureSavePermission())) return;
    const outcome = await savePhotoToPhone(photo);
    const { title, body } = saveResultMessage(outcome);
    Alert.alert(title, body);
  } catch (error) {
    Alert.alert("Could not save", failureText(error, "The photo could not be downloaded."));
  }
}

export type ZipJob =
  | { photos: PhotoListItem[]; layout: ZipLayout }
  | { projectId: string; layout: ZipLayout };

/**
 * Save many photos to the gallery, and build a zip of many, each behind the
 * same progress sheet. `ui` goes once in the screen's tree.
 */
export function usePhotoTransfer() {
  const [run, setRun] = useState<Run | null>(null);
  const abort = useRef<AbortController | null>(null);

  async function save(photos: PhotoListItem[]) {
    const refusal = saveToPhoneRefusal(photos.length);
    if (refusal) {
      Alert.alert("Save to phone", refusal);
      return;
    }
    let granted = false;
    try {
      granted = await ensureSavePermission();
    } catch (error) {
      Alert.alert("Could not save", failureText(error, "Could not ask for access to Photos."));
    }
    if (!granted) return;

    const controller = new AbortController();
    abort.current = controller;
    const total = photos.length;
    const title = `Saving ${total} photo${total === 1 ? "" : "s"}`;
    setRun({ title, label: saveProgressLabel(0, total), done: 0, total });
    try {
      const outcome = await savePhotosToPhone(photos, {
        signal: controller.signal,
        onProgress: (done) => setRun({ title, label: saveProgressLabel(done, total), done, total }),
      });
      setRun(null);
      await wait(MODAL_GAP_MS);
      const { title: heading, body } = saveResultMessage(outcome);
      Alert.alert(heading, body);
    } catch (error) {
      setRun(null);
      await wait(MODAL_GAP_MS);
      Alert.alert("Could not save", failureText(error, "The photos could not be downloaded."));
    } finally {
      abort.current = null;
      setRun(null);
    }
  }

  async function zip(job: ZipJob) {
    const controller = new AbortController();
    abort.current = controller;
    const title = "Making a zip";
    setRun({ title, label: zipProgressLabel(0, 0), done: 0, total: 0 });
    try {
      const photos = "photos" in job ? job.photos : await listAllProjectPhotos(job.projectId);
      if (controller.signal.aborted) return;
      if (!photos.length) {
        setRun(null);
        await wait(MODAL_GAP_MS);
        Alert.alert("No photos yet", "There are no photos on this project to download.");
        return;
      }
      const total = photos.length;
      setRun({ title, label: zipProgressLabel(0, total), done: 0, total });
      const result = await buildPhotoZip(photos, job.layout, {
        signal: controller.signal,
        onProgress: (done) => setRun({ title, label: zipProgressLabel(done, total), done, total }),
      });
      setRun(null);
      if (!result) return;
      await wait(MODAL_GAP_MS);
      try {
        await shareZip(result.uri);
      } catch (error) {
        Alert.alert("Could not open the share sheet", failureText(error, "Please try again."));
        return;
      }
      const note = zipResultMessage(result);
      if (note) {
        await wait(MODAL_GAP_MS);
        Alert.alert("Some photos are not in the zip", note);
      }
    } catch (error) {
      setRun(null);
      await wait(MODAL_GAP_MS);
      Alert.alert("Could not make the zip", failureText(error, "Please try again."));
    } finally {
      abort.current = null;
      setRun(null);
    }
  }

  const cancel = () => abort.current?.abort();

  const ui = (
    <Sheet
      visible={run !== null}
      onClose={cancel}
      title={run?.title ?? ""}
      subtitle="Full size, one photo at a time. Keep the app open until it finishes."
      footer={
        <Button
          label="Cancel"
          icon={X}
          variant="outline"
          fullWidth
          accessibilityHint="Stops after the photo in progress"
          onPress={cancel}
        />
      }
    >
      <View style={{ gap: spacing.sm }}>
        <ProgressBar
          value={run?.done ?? 0}
          total={run?.total ?? 0}
          showLabel
          label={run?.label ?? ""}
        />
        {run && run.total === 0 ? (
          <Text variant="caption" tone="muted">
            Finding every photo on the project.
          </Text>
        ) : null}
      </View>
    </Sheet>
  );

  return { save, zip, ui, busy: run !== null };
}
