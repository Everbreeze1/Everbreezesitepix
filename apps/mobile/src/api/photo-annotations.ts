import { photoObjectPaths, thumbPathFor } from "@everlumen/shared";
import { randomUUID } from "expo-crypto";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { File, Paths } from "expo-file-system";
import type Svg from "react-native-svg";
import { supabase } from "@/lib/supabase";

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
}): Promise<{ id: string }> {
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

  const path = `${options.userId}/${options.projectId}/${randomUUID()}.jpg`;
  const bytes = await new File(encoded.uri).arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from("site-photos")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: false });
  if (upErr) throw new Error(upErr.message);

  // Same thumbnail rules as any other capture, so the annotated copy behaves
  // like a normal photo everywhere it appears.
  let thumbPath: string | null = null;
  try {
    const thumbSource = ImageManipulator.manipulate(encoded.uri);
    thumbSource.resize({ width: 1400 });
    const thumb = await (
      await thumbSource.renderAsync()
    ).saveAsync({
      format: SaveFormat.JPEG,
      compress: 0.7,
    });
    const thumbBytes = await new File(thumb.uri).arrayBuffer();
    const candidate = thumbPathFor(path);
    const { error } = await supabase.storage
      .from("site-photos")
      .upload(candidate, thumbBytes, { contentType: "image/jpeg", upsert: true });
    if (!error) thumbPath = candidate;
  } catch {
    // An optimisation. A photo without one still reads correctly.
  }

  const { data, error: insErr } = await supabase
    .from("photos")
    .insert({
      project_id: options.projectId,
      uploaded_by: options.userId,
      storage_path: path,
      thumb_path: thumbPath,
      size_bytes: bytes.byteLength,
      caption: options.caption,
      phase: options.phase,
    })
    .select("id")
    .single();

  if (insErr || !data) {
    await supabase.storage
      .from("site-photos")
      .remove(photoObjectPaths(path, thumbPath))
      .catch(() => {});
    throw new Error(insErr?.message ?? "Could not save the annotated photo");
  }

  try {
    scratch.delete();
  } catch {
    // Cache directory; the OS reclaims it.
  }

  return { id: data.id };
}
