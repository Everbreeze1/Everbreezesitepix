import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import type Svg from "react-native-svg";

/**
 * Flatten a photo and its before/after pill into a new file.
 *
 * The same two-step the annotation save uses: `react-native-svg` rasterises the
 * photo and the pill together natively, then the PNG it hands back is
 * re-encoded to JPEG. Skipping the re-encode would put a PNG of a photograph
 * into the queue, several times the size of the JPEG it came from, on exactly
 * the rows someone bothered to tag.
 *
 * @returns the uri of the watermarked copy.
 */

/** Matches `JPEG_QUALITY` in photos.ts, so a watermarked photo is not heavier. */
const JPEG_QUALITY = 0.85;

/**
 * `toDataURL` takes a callback and has no error channel, so a failure is
 * silence. The timeout turns that into an error rather than a capture that
 * never finishes queueing.
 */
function rasterise(canvas: Svg | null): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!canvas || typeof canvas.toDataURL !== "function") {
      reject(new Error("The watermark surface is not ready yet"));
      return;
    }
    const timer = setTimeout(() => reject(new Error("Rendering the watermark timed out")), 15_000);
    try {
      canvas.toDataURL((base64) => {
        clearTimeout(timer);
        if (base64) resolve(base64);
        else reject(new Error("The watermark could not be rendered"));
      });
    } catch (e) {
      clearTimeout(timer);
      reject(e instanceof Error ? e : new Error("The watermark could not be rendered"));
    }
  });
}

export async function renderWatermarked(canvas: Svg | null): Promise<string> {
  const base64 = await rasterise(canvas);

  const scratch = new File(Paths.cache, `watermark-${randomUUID()}.png`);
  scratch.create({ overwrite: true });
  /*
   * Written with `encoding: "base64"` rather than decoded here. `Buffer` is a
   * Node global Hermes does not have, and it type-checks cleanly because
   * `@types/node` is in the tree, so the crash would only appear on device.
   * The annotation path records the same trap.
   */
  scratch.write(base64, { encoding: "base64" });

  const rendered = await ImageManipulator.manipulate(scratch.uri).renderAsync();
  const encoded = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });

  // The PNG was scratch space between two encoders and is several megabytes.
  // Leaving it behind grows the cache by one copy of every photo taken.
  try {
    scratch.delete();
  } catch {
    // A cache file that will not delete is not worth failing a capture over.
  }

  return encoded.uri;
}
