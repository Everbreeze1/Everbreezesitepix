import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import type Svg from "react-native-svg";
import { enqueue, newOutboxId } from "@/offline/outbox";
import { persistCapture } from "@/offline/media";
import { requestSync } from "@/offline/sync";
import type { PhotoUploadPayload } from "@/offline/handlers";

/**
 * Flatten a marked-up photo and store it as a new one.
 *
 * A new row rather than a replacement, matching what the web annotator does.
 * The original is evidence: someone marking up a defect photo has not decided
 * to destroy the untouched shot of it, and a report may already reference it.
 *
 * The flattening is done by `react-native-svg`'s own `toDataURL`, which
 * rasterises the photo and the markup together natively. That is the reason
 * this feature needed no Skia and no development build: the plan assumed a
 * canvas was required, and the SVG renderer already is one.
 */

/** PNG from the rasteriser, re-encoded to JPEG at roughly this quality. */
const JPEG_QUALITY = 0.85;

function rasterise(canvas: Svg | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toDataURL !== "function") {
      reject(new Error("The drawing surface is not ready yet"));
      return;
    }
    /*
     * `toDataURL` takes a callback and has no error channel, so a failure shows
     * up as silence. Without the timeout the save button would spin forever on
     * a device where the rasteriser fails, which is worse than an error.
     */
    const timer = setTimeout(() => reject(new Error("Rendering the annotation timed out")), 15_000);
    try {
      canvas.toDataURL((base64) => {
        clearTimeout(timer);
        if (base64) resolve(base64);
        else reject(new Error("The annotation could not be rendered"));
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error("The annotation could not be rendered"));
    }
  });
}

export async function saveAnnotatedPhoto(options: {
  canvas: Svg | null;
  userId: string;
  projectId: string;
  caption: string;
  phase: string;
  /** Carried through so the queued row records the real pixel size. */
  width?: number | null;
  height?: number | null;
}): Promise<{ queued: true }> {
  const base64 = await rasterise(options.canvas);

  /*
   * The rasteriser hands back a PNG, which for a photograph is several times
   * the size of the JPEG it came from. Writing it to a file and re-encoding
   * keeps the annotated copy in the same size range as every other photo in the
   * project, so the grid does not visibly stall on exactly the rows someone
   * bothered to mark up.
   */
  const scratch = new File(Paths.cache, `annotated-${randomUUID()}.png`);
  scratch.create({ overwrite: true });
  /*
   * Written with `encoding: "base64"` rather than decoded here. `Buffer` is a
   * Node global that Hermes does not have, and reaching for it type-checks
   * cleanly because `@types/node` is in the tree: it would have crashed on the
   * device and nowhere before it.
   */
  scratch.write(base64, { encoding: "base64" });

  const rendered = await ImageManipulator.manipulate(scratch.uri).renderAsync();
  const encoded = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });

  /*
   * From here the outbox owns it, exactly as a camera capture does.
   *
   * This used to upload the file, upload a thumbnail and insert the row inline,
   * which meant a marked-up defect photo could only be saved with signal - and
   * marking up a defect is done standing in front of it. The rasterising and
   * the JPEG encode still happen here because they need the live canvas; what
   * follows is the same `photo_upload` the camera queues, so the annotated copy
   * travels the same tested path and behaves like any other photo on arrival.
   */
  const outboxId = newOutboxId();
  const localUri = persistCapture(encoded.uri, outboxId);

  const payload: PhotoUploadPayload = {
    userId: options.userId,
    projectId: options.projectId,
    caption: options.caption,
    phase: options.phase as PhotoUploadPayload["phase"],
    tags: [],
    width: options.width ?? null,
    height: options.height ?? null,
  };

  await enqueue({
    id: outboxId,
    kind: "photo_upload",
    projectId: options.projectId,
    localUri,
    payload,
  });
  requestSync();

  try {
    // The PNG the rasteriser produced. The durable copy above is a JPEG, so
    // this one has no further use.
    scratch.delete();
  } catch {
    // Cache directory; the OS reclaims it.
  }

  /*
   * No id to return: the row does not exist until the queue delivers it. The
   * one caller ignored the id anyway - it invalidates the grid and goes back -
   * so this reports that the work is safely on the device rather than
   * pretending to know what the server will call it.
   */
  return { queued: true as const };
}
