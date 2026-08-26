import { photoObjectPaths, thumbPathFor } from "@everlumen/shared";
import { randomUUID } from "expo-crypto";
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { readExifMeta, resolvePhotoMeta, type Coords } from "./photo-meta";
import { supabase } from "@/lib/supabase";

/**
 * Photo capture and library reads.
 *
 * The numbers here are deliberately the same as the web app's
 * (`apps/web/src/features/photos/components/CameraCapture.tsx` and
 * `apps/web/src/lib/photo-thumbnails.ts`). Both clients write into one bucket
 * and one table, and a photo has no field recording which client produced it,
 * so a grid mixes them freely. If mobile stored 8MB originals and no thumbnail,
 * the gallery would visibly stall on exactly the rows that came from the field.
 */

/** Longest edge of a stored original. Matches web's `MAX_DIM`. */
const MAX_DIM = 2048;
/** Matches web's `JPEG_QUALITY`. */
const JPEG_QUALITY = 0.85;
/** 2MB cap per photo, as web. */
const MAX_BYTES = 2 * 1024 * 1024;
/** Matches web's `THUMBNAIL_MAX_DIM`, sized for retina grid tiles and showcase pages. */
const THUMBNAIL_MAX_DIM = 1400;
const THUMBNAIL_QUALITY = 0.7;

export type PhotoPhase = "before" | "after" | "untagged";

export type PhotoListItem = {
  id: string;
  caption: string | null;
  storage_path: string;
  thumb_path: string | null;
  image_url: string | null;
  created_at: string;
  taken_at: string | null;
  phase: string | null;
  tags: string[] | null;
};

/** A photo as handed over by `expo-camera` or `expo-image-picker`. */
export type CapturedAsset = {
  uri: string;
  width?: number | null;
  height?: number | null;
  mimeType?: string | null;
  exif?: Record<string, unknown> | null;
};

function longestEdgeTarget(width: number, height: number, max: number) {
  // `resize` preserves aspect ratio from whichever edge is given, so constrain
  // the longer one or a portrait photo comes back far larger than intended.
  return width >= height ? { width: max } : { height: max };
}

async function sizeOf(uri: string): Promise<number> {
  const file = new File(uri);
  return file.exists ? (file.size ?? 0) : 0;
}

/**
 * Re-encode a capture down to something worth storing.
 *
 * A modern phone camera produces 4 to 12MB per shot. Uploading that from a job
 * site is slow, counts against the team's storage, and buys nothing: nothing in
 * the product displays a photo larger than 2048px on its longest edge.
 *
 * Returns the original URI untouched if it is already small enough, or if
 * anything fails. A photo that uploads large beats a photo that does not
 * upload.
 */
async function compressCapture(asset: CapturedAsset): Promise<{ uri: string; size: number }> {
  const originalSize = await sizeOf(asset.uri);

  // Same early exit as web: leave already-small images alone rather than paying
  // a decode and re-encode to save nothing.
  if (originalSize > 0 && originalSize <= MAX_BYTES && originalSize < 1_500_000) {
    return { uri: asset.uri, size: originalSize };
  }

  let width = asset.width ?? 0;
  let height = asset.height ?? 0;

  try {
    if (!width || !height) {
      const probe = await ImageManipulator.manipulate(asset.uri).renderAsync();
      width = probe.width;
      height = probe.height;
    }

    let dim = MAX_DIM;
    let quality = JPEG_QUALITY;
    let best: { uri: string; size: number } | null = null;

    // Up to five passes, shrinking until under the cap, mirroring web.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(width, height) > dim) {
        context.resize(longestEdgeTarget(width, height, dim));
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: quality });
      const size = await sizeOf(saved.uri);

      best = { uri: saved.uri, size };
      if (size > 0 && size <= MAX_BYTES) break;

      dim = Math.round(dim * 0.8);
      quality = Math.max(0.5, quality - 0.1);
    }

    if (best) return best;
  } catch {
    // Fall through to the original.
  }

  return { uri: asset.uri, size: originalSize };
}

/**
 * Render and upload the thumbnail, returning the path for `photos.thumb_path`.
 *
 * Never throws, and returns null on any failure. A thumbnail is an
 * optimisation: readers fall back to the full-size object without it, so
 * failing a capture over a missing thumbnail would trade a slow grid tile for a
 * lost site photo.
 *
 * This closes the gap the stub documented and could not fix. The web renderer
 * is canvas-based and React Native has no canvas, but `expo-image-manipulator`
 * does the same job natively, and `thumbPathFor` keeps the path identical so
 * every existing delete path still finds it.
 */
async function uploadThumbnail(
  storagePath: string,
  asset: CapturedAsset,
  sourceUri: string,
): Promise<string | null> {
  try {
    let width = asset.width ?? 0;
    let height = asset.height ?? 0;

    const context = ImageManipulator.manipulate(sourceUri);
    if (!width || !height) {
      const probe = await ImageManipulator.manipulate(sourceUri).renderAsync();
      width = probe.width;
      height = probe.height;
    }
    if (Math.max(width, height) > THUMBNAIL_MAX_DIM) {
      context.resize(longestEdgeTarget(width, height, THUMBNAIL_MAX_DIM));
    }

    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({
      format: SaveFormat.JPEG,
      compress: THUMBNAIL_QUALITY,
    });

    const bytes = await new File(saved.uri).arrayBuffer();
    const thumbPath = thumbPathFor(storagePath);

    const { error } = await supabase.storage
      .from("site-photos")
      .upload(thumbPath, bytes, { contentType: "image/jpeg", upsert: true });

    return error ? null : thumbPath;
  } catch {
    return null;
  }
}

/**
 * Compress a capture, upload the object and its thumbnail, and report what
 * landed. Stops short of writing the `photos` row.
 *
 * Walkthrough captures need exactly this half: the row is written server-side
 * by the `saveWalkthroughPhoto` op, which also links the photo to the session
 * and its offset. Duplicating the compress-and-thumbnail work there would be
 * two implementations of the sizing rules that have to stay identical.
 */
export async function uploadPhotoObject(
  asset: CapturedAsset,
  storagePath: string,
): Promise<{ sizeBytes: number; thumbPath: string | null }> {
  const source = new File(asset.uri);
  if (!source.exists) throw new Error("Could not read image from device");

  const compressed = await compressCapture(asset);
  const bytes = await new File(compressed.uri).arrayBuffer();

  const { error } = await supabase.storage
    .from("site-photos")
    .upload(storagePath, bytes, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(error.message);

  const thumbPath = await uploadThumbnail(storagePath, asset, compressed.uri);
  return { sizeBytes: compressed.size || bytes.byteLength, thumbPath };
}

export type UploadPhotoOptions = {
  userId: string;
  projectId: string;
  asset: CapturedAsset;
  /** Before/after tagging. Written to `photos.phase`, as web does. */
  phase?: PhotoPhase;
  /** Free-form photo tags, written to `photos.tags`. */
  tags?: string[];
  caption?: string;
  /** Where the device was standing, used when the photo carries no GPS. */
  deviceCoords?: Coords | null;
  /** The project's own coordinates, the last fallback. */
  projectCoords?: Coords | null;
  /**
   * Stable id for this upload, making the whole operation safe to repeat.
   *
   * The offline outbox passes its row id here. Retrying then targets the same
   * storage path and the same duplicate check, so a send that failed after the
   * object landed but before the row was written finishes cleanly instead of
   * producing a second copy of the photo.
   */
  uploadId?: string;
};

/**
 * Upload one capture into `site-photos` plus a `photos` row.
 *
 * Path shape is `{userId}/{projectId}/{uuid}.jpg`, matching web. The bucket's
 * RLS keys off the first two segments, so this is load-bearing, not cosmetic.
 */
export async function uploadProjectPhoto(options: UploadPhotoOptions): Promise<{ id: string }> {
  const { asset, userId, projectId } = options;

  const source = new File(asset.uri);
  if (!source.exists) throw new Error("Could not read image from device");

  const meta = resolvePhotoMeta(
    readExifMeta(asset.exif),
    options.deviceCoords ?? null,
    options.projectCoords ?? null,
  );

  const compressed = await compressCapture(asset);

  /*
   * Always `.jpg`. `compressCapture` re-encodes to JPEG, and even when it bails
   * out and returns the original, every camera and picker path feeding this
   * function produces JPEG. Deriving the extension from a mime type that no
   * longer describes the bytes is how a PNG-named JPEG ends up in the bucket.
   */
  const uploadId = options.uploadId ?? randomUUID();
  const path = `${userId}/${projectId}/${uploadId}.jpg`;

  /*
   * A retry may be finishing an attempt that already wrote the row. There is no
   * unique index on `photos.storage_path`, so nothing in the database would
   * stop a second insert, and the user would find the same photo twice. The
   * path is derived from `uploadId`, so its presence is the dedupe key.
   */
  if (options.uploadId) {
    const { data: existing } = await supabase
      .from("photos")
      .select("id")
      .eq("storage_path", path)
      .maybeSingle();
    if (existing?.id) return { id: existing.id };
  }

  /*
   * Read bytes rather than `await fetch(uri).blob()`. React Native's Blob is a
   * handle to data held natively, and supabase-js cannot see through it: it
   * uploads an empty object and reports success, which is worse than an error
   * because the row is written and the camera cache is already gone.
   */
  const bytes = await new File(compressed.uri).arrayBuffer();

  const { error: upErr } = await supabase.storage
    .from("site-photos")
    /*
     * `upsert` only for a repeatable upload. A retry whose previous attempt
     * left the object behind must overwrite it; without this the second attempt
     * fails with "already exists" and the row can never be written. One-shot
     * uploads keep `false` so a genuine uuid collision still surfaces.
     */
    .upload(path, bytes, { contentType: "image/jpeg", upsert: Boolean(options.uploadId) });
  if (upErr) throw new Error(upErr.message);

  const thumbPath = await uploadThumbnail(path, asset, compressed.uri);

  const caption = options.caption?.trim() || `Photo ${new Date().toLocaleString()}`;
  const tags = options.tags?.filter(Boolean) ?? [];

  const { data, error: insErr } = await supabase
    .from("photos")
    .insert({
      project_id: projectId,
      uploaded_by: userId,
      storage_path: path,
      thumb_path: thumbPath,
      size_bytes: compressed.size || bytes.byteLength,
      caption,
      phase: options.phase ?? "untagged",
      tags: tags.length ? tags : undefined,
      taken_at: meta.taken_at,
      latitude: meta.latitude,
      longitude: meta.longitude,
    })
    .select("id")
    .single();

  if (insErr || !data) {
    /*
     * Reclaim the objects. With no row referencing them nothing in the product
     * can reach them again, and they would still count against the team's
     * storage forever. `photoObjectPaths` derives the thumbnail path even when
     * `thumbPath` is null, because the upload may have succeeded in a way this
     * code did not observe.
     */
    await supabase.storage
      .from("site-photos")
      .remove(photoObjectPaths(path, thumbPath))
      .catch(() => {});
    throw new Error(insErr?.message ?? "Insert failed");
  }

  return { id: data.id };
}

/** Photos for a project, newest first. Walkthrough captures included, trash excluded. */
export async function listProjectPhotos(projectId: string, limit = 60): Promise<PhotoListItem[]> {
  const { data, error } = await supabase
    .from("photos")
    .select("id, caption, storage_path, thumb_path, image_url, created_at, taken_at, phase, tags")
    /*
     * The trash is not part of the photo library, and `deleted_at` has no RLS
     * predicate behind it, so this read has to exclude it by hand like the rest
     * of the product does.
     */
    .is("deleted_at", null)
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return (data as PhotoListItem[]) ?? [];
}

/**
 * Displayable URL per photo id.
 *
 * Prefers the thumbnail: a grid tile showing a 2MB original is the difference
 * between a screen that loads on site data and one that does not. Falls back to
 * the original for rows written before thumbnails existed, and for any upload
 * where thumbnail generation failed.
 */
export async function signPhotoUrls(
  photos: PhotoListItem[],
  preferThumbnail = true,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const needSign: { id: string; path: string }[] = [];

  for (const photo of photos) {
    if (photo.image_url) {
      out[photo.id] = photo.image_url;
      continue;
    }
    const path = preferThumbnail && photo.thumb_path ? photo.thumb_path : photo.storage_path;
    needSign.push({ id: photo.id, path });
  }

  if (!needSign.length) return out;

  const { data } = await supabase.storage.from("site-photos").createSignedUrls(
    needSign.map((n) => n.path),
    60 * 60,
  );

  data?.forEach((signed, index) => {
    if (signed?.signedUrl) out[needSign[index].id] = signed.signedUrl;
  });

  return out;
}
