import { thumbPathFor } from "@sitepix/shared";
import { supabase } from "@/integrations/sitepix/client";

/**
 * Longest edge of a stored thumbnail.
 *
 * One stored variant has to serve two readers, so it is sized for the larger:
 *
 *   - Grid tiles. The biggest is 480 CSS px, doubled for retina = 960.
 *   - Public showcase pages, which previously transformed to 1400 for exactly
 *     this reason ("~1400px renditions instead of 4000px camera originals").
 *
 * 1400 covers both and still lands near 200 KB, roughly a tenth of the 2 MB
 * originals `compressImageFile` produces. Storing a second, smaller variant
 * would save bytes a phone already downloads quickly, at the cost of another
 * upload on every capture; not worth it. Anything asking for more than this
 * reads the original instead - see `PhotoThumb`.
 */
export const THUMBNAIL_MAX_DIM = 1400;
const THUMBNAIL_QUALITY = 0.7;

/**
 * Downscaled JPEG copy of an image, or null if the browser cannot decode it
 * (HEIC on some devices, a corrupt capture, a non-image blob).
 */
export async function renderThumbnailBlob(source: Blob): Promise<Blob | null> {
  if (!source.type.startsWith("image/")) return null;
  const bitmap = await createImageBitmap(source).catch(() => null);
  if (!bitmap) return null;
  try {
    const scale = Math.min(1, THUMBNAIL_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", THUMBNAIL_QUALITY),
    );
  } finally {
    bitmap.close();
  }
}

/**
 * Render and store the thumbnail for a photo that has just been uploaded, and
 * return the path to put in `photos.thumb_path`.
 *
 * Returns null instead of throwing, always. A thumbnail is an optimisation: if
 * generation or upload fails, the photo is still fully usable and readers fall
 * back to the full-size object. Failing the upload over a missing thumbnail
 * would trade a slow grid tile for a lost site photo.
 *
 * `upsert` because a re-save of the same object path - a retry, or the
 * annotate-and-replace flow - must overwrite the stale thumbnail rather than
 * collide with it and leave the old image showing.
 */
export async function uploadPhotoThumbnail(
  storagePath: string,
  source: Blob,
): Promise<string | null> {
  try {
    const thumb = await renderThumbnailBlob(source);
    if (!thumb) return null;
    const thumbPath = thumbPathFor(storagePath);
    const { error } = await supabase.storage
      .from("site-photos")
      .upload(thumbPath, thumb, { contentType: "image/jpeg", upsert: true });
    if (error) {
      console.warn("[photos] thumbnail upload failed; reads fall back to full size", error, {
        storagePath,
      });
      return null;
    }
    return thumbPath;
  } catch (e) {
    console.warn("[photos] thumbnail generation failed; reads fall back to full size", e, {
      storagePath,
    });
    return null;
  }
}
