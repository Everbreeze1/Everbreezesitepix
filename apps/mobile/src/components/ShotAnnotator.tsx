import { useRef } from "react";
import { Modal } from "react-native";
import type { AnnotationTool } from "@/api/annotation";
import { renderWatermarked } from "@/api/watermark-render";
import {
  PhotoAnnotator,
  type AnnotatorSaveOutput,
  type PhotoAnnotatorHandle,
} from "@/components/annotator/PhotoAnnotator";

export type ShotAnnotatorTool = AnnotationTool | "measure";

/**
 * Mark up a shot before it is saved: the camera's version of web's Annotate
 * step, with Measure for Pro and Team.
 *
 * The same full editor as a saved photo's Annotate (`PhotoAnnotator`), in a
 * modal. The difference is the result: it replaces the shot in the batch
 * instead of filing a copy, because on web the camera's annotator edits the
 * preview in place and the shot has no saved original to protect yet.
 *
 * The flattened file is rendered at the photo's own pixel size off screen, so
 * markup does not cost the photo its resolution. Rotate and crop change that
 * size, so the result carries it.
 */
export function ShotAnnotator({
  visible,
  uri,
  width,
  height,
  canMeasure,
  initialTool = "pen",
  capturedAt,
  onCancel,
  onDone,
}: {
  visible: boolean;
  uri: string;
  width?: number | null;
  height?: number | null;
  canMeasure: boolean;
  initialTool?: ShotAnnotatorTool;
  /** When the shot was taken, for the Timestamp tool. Defaults to now. */
  capturedAt?: string | null;
  onCancel: () => void;
  onDone: (result: { uri: string; width: number; height: number }) => void;
}) {
  const editor = useRef<PhotoAnnotatorHandle>(null);

  async function save(out: AnnotatorSaveOutput) {
    if (!out.dirty) {
      // Nothing changed: keep the shot as it was rather than re-encoding it.
      onCancel();
      return;
    }
    const rendered = await renderWatermarked(out.canvas);
    onDone({ uri: rendered, width: out.width, height: out.height });
  }

  return (
    <Modal
      visible={visible}
      animationType="fade"
      supportedOrientations={["portrait", "landscape"]}
      onRequestClose={() => editor.current?.back()}
    >
      {visible ? (
        <PhotoAnnotator
          // A new shot is a new document: remount rather than carry markup over.
          key={uri}
          ref={editor}
          uri={uri}
          width={width}
          height={height}
          canMeasure={canMeasure}
          initialTool={initialTool === "measure" && !canMeasure ? "pen" : initialTool}
          capturedAt={capturedAt}
          title={initialTool === "measure" ? "Measure" : "Annotate"}
          onCancel={onCancel}
          onSave={save}
        />
      ) : null}
    </Modal>
  );
}
