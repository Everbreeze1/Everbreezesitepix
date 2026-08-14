import { supabase } from "./supabase";

/**
 * Upload a local image URI (camera / library) into `site-photos` + `photos` row.
 * Same path shape as web gallery: `{userId}/{projectId}/{uuid}.jpg`
 */
export async function uploadProjectPhoto(options: {
  userId: string;
  projectId: string;
  uri: string;
  mimeType?: string | null;
  caption?: string;
}): Promise<{ id: string }> {
  const mime = options.mimeType?.startsWith("image/")
    ? options.mimeType
    : "image/jpeg";
  const ext = mime.includes("png") ? "png" : "jpg";
  const path = `${options.userId}/${options.projectId}/${crypto.randomUUID()}.${ext}`;

  const res = await fetch(options.uri);
  if (!res.ok) throw new Error("Could not read image from device");
  const blob = await res.blob();

  const { error: upErr } = await supabase.storage
    .from("site-photos")
    .upload(path, blob, { contentType: mime, upsert: false });
  if (upErr) throw new Error(upErr.message);

  /*
   * KNOWN GAP - no `thumb_path`. The web app writes a downscaled copy beside
   * every original (`apps/web/src/lib/photo-thumbnails.ts`) so grids never pull
   * full-size photos, but that renderer is canvas-based and React Native has
   * neither `createImageBitmap` nor `<canvas>`. Photos uploaded here therefore
   * read back at full size, exactly like pre-thumbnail rows - correct, just not
   * cheap. Closing it means resizing with `expo-image-manipulator` and passing
   * the result through the same `thumbPathFor()` derivation so the delete paths
   * still find it.
   */

  const caption =
    options.caption?.trim() ||
    `Photo ${new Date().toLocaleString()}`;

  const { data, error: insErr } = await supabase
    .from("photos")
    .insert({
      project_id: options.projectId,
      uploaded_by: options.userId,
      storage_path: path,
      size_bytes: blob.size,
      caption,
      phase: "untagged",
    })
    .select("id")
    .single();

  if (insErr || !data) throw new Error(insErr?.message ?? "Insert failed");
  return { id: data.id };
}
