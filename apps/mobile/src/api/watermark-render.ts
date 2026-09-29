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

/**
 * Longest edge the pill is burnt in at. Matches `MAX_DIM` in photos.ts: the
 * uploader shrinks every original to this anyway, so stamping at the camera's
 * full 12 megapixels only made the rasteriser push four times the pixels
 * through a base64 PNG for a result that was then thrown away.
 */
const STAMP_MAX_DIM = 2048;

/**
 * Shrink a capture once, natively, to the size it will be stored at, and
 * report its real (upright) dimensions for the watermark surface.
 *
 * Throws on failure; the caller fails open to the original.
 */
export async function downscaleForStamp(
  uri: string,
): Promise<{ uri: string; width: number; height: number }> {
  const probe = await ImageManipulator.manipulate(uri).renderAsync();
  const { width, height } = probe;
  if (Math.max(width, height) <= STAMP_MAX_DIM) {
    const saved = await probe.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
    return { uri: saved.uri, width: saved.width, height: saved.height };
  }
  // Resized from the image already decoded above, so the file is read once.
  const context = ImageManipulator.manipulate(probe);
  context.resize(width >= height ? { width: STAMP_MAX_DIM } : { height: STAMP_MAX_DIM });
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * A small copy of a capture for the batch strip and review grid.
 *
 * The camera hands back a 12 megapixel JPEG; a grid of those decoded at full
 * size is what made review tiles appear one by one, seconds apart. Returns
 * null on any failure and the caller shows the original instead.
 */
export async function makePreviewThumb(uri: string): Promise<string | null> {
  try {
    const context = ImageManipulator.manipulate(uri);
    context.resize({ width: PREVIEW_DIM });
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7 });
    return saved.uri;
  } catch {
    return null;
  }
}

/** Wide enough for a tablet's review tile at 3x density. */
const PREVIEW_DIM = 480;
