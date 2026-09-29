import { Directory, File, FileMode, Paths } from "expo-file-system";
import { Album, Asset, requestPermissionsAsync } from "expo-media-library";
import * as Sharing from "expo-sharing";
import { supabase } from "@/lib/supabase";
import { ZipWriter } from "@/lib/zip";
import { signPhotoUrls, type PhotoListItem } from "./photos";
import { PHONE_ALBUM, savedPhotoFileName, type SaveOutcome } from "./photo-selection-view";
import { ZIP_SIZE_LIMIT, pathExtension, type ZipLayout, type ZipOutcome } from "./photo-zip-view";

/**
 * Photos leaving the app as files: into the phone's own gallery, or into one
 * zip handed to the share sheet so it can go to Files, Downloads or Drive.
 *
 * Both download the full-size original, never the grid's thumbnail. Both sign
 * a few photos at a time, just before they are fetched, because a signed URL
 * lasts an hour and a whole job over a slow connection can take longer.
 */

/** How many originals are signed per request. */
const SIGN_BATCH = 25;

/** Sign the originals a batch at a time, yielding each photo with its URL. */
async function* originals<T extends PhotoListItem>(
  photos: readonly T[],
): AsyncGenerator<{ photo: T; index: number; url: string | null }> {
  for (let start = 0; start < photos.length; start += SIGN_BATCH) {
    const batch = photos.slice(start, start + SIGN_BATCH);
    const urls = await signPhotoUrls([...batch], false);
    for (let i = 0; i < batch.length; i++) {
      yield { photo: batch[i], index: start + i, url: urls[batch[i].id] ?? null };
    }
  }
}

function freshDirectory(name: string): Directory {
  const dir = new Directory(Paths.cache, name);
  if (dir.exists) dir.delete();
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === "AbortError");
}

/* --------------------------------------------------------- save to phone */

/**
 * Ask to add photos to the gallery, and nothing more.
 *
 * Write-only: the app never needs to read the person's library to put photos
 * in it, and iOS words an add-only prompt accordingly. `blocked` means the
 * system will not ask again, so only Settings can change the answer.
 */
export async function requestSavePermission(): Promise<"granted" | "denied" | "blocked"> {
  const response = await requestPermissionsAsync(true, ["photo"]);
  if (response.granted) return "granted";
  return response.canAskAgain ? "denied" : "blocked";
}

/**
 * The app's album, found or made on the first photo of a run.
 *
 * Filing into an album needs more than add-only access on iOS, and some
 * Android galleries refuse it too. The first time it fails the run stops
 * trying and saves the rest to the library alone, which is where the photos
 * matter; the album is only a way to find them again.
 */
type AlbumState = { album: Album | null; off: boolean };

async function saveToGallery(uri: string, state: AlbumState): Promise<void> {
  if (!state.off) {
    try {
      if (!state.album) state.album = await Album.get(PHONE_ALBUM);
      if (state.album) {
        await Asset.create(uri, state.album);
      } else {
        state.album = await Album.create(PHONE_ALBUM, [uri], false);
      }
      return;
    } catch {
      state.off = true;
    }
  }
  await Asset.create(uri);
}

/**
 * Download each original and write it to the gallery, in the app's album
 * where the phone allows one.
 *
 * Permission is the caller's to ask for, so it can explain a refusal. One photo
 * failing is not the run failing: the count comes back and the caller says so.
 */
export async function savePhotosToPhone(
  photos: readonly PhotoListItem[],
  options: { onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<SaveOutcome> {
  const { onProgress, signal } = options;
  const dir = freshDirectory("saved-photos");
  const state: AlbumState = { album: null, off: false };
  let saved = 0;
  let failed = 0;
  let cancelled = false;

  try {
    for await (const { photo, index, url } of originals(photos)) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      onProgress?.(index);
      if (!url) {
        failed += 1;
        continue;
      }
      try {
        const target = new File(dir, savedPhotoFileName(photo));
        const file = await File.downloadFileAsync(url, target, { idempotent: true, signal });
        await saveToGallery(file.uri, state);
        if (file.exists) file.delete();
        saved += 1;
      } catch (error) {
        if (isAbort(error, signal)) {
          cancelled = true;
          break;
        }
        failed += 1;
      }
    }
  } finally {
    if (dir.exists) dir.delete();
  }
  onProgress?.(photos.length);
  return { saved, failed, total: photos.length, cancelled, inAlbum: saved > 0 && !state.off };
}

/** One photo from the viewer, the same way the bulk bar saves many. */
export function savePhotoToPhone(photo: PhotoListItem): Promise<SaveOutcome> {
  return savePhotosToPhone([photo]);
}

/* ------------------------------------------------------------------- zip */

/**
 * Every photo on a job, in the order the web's project page lists them.
 *
 * The project screen loads its grid a page at a time, so its list is only as
 * long as the person has scrolled. The web's export takes the whole job, and so
 * does this: a light read of just the columns a zip needs, a thousand rows at a
 * time.
 */
export async function listAllProjectPhotos(projectId: string): Promise<PhotoListItem[]> {
  const page = 1000;
  const out: PhotoListItem[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("photos")
      .select("id, caption, storage_path, thumb_path, image_url, created_at, taken_at, phase, tags")
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .order("taken_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    const rows = (data as PhotoListItem[]) ?? [];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

/**
 * Build a zip of the originals on disk, one photo at a time.
 *
 * Each photo is downloaded to the cache, read, written into the open zip file
 * and deleted before the next starts, so memory holds one photo and the
 * central directory, never the archive. The zip stops short of
 * `ZIP_SIZE_LIMIT` and says how many were left out rather than failing late.
 *
 * Returns null when cancelled; the half-written file is removed.
 */
export async function buildPhotoZip(
  photos: readonly PhotoListItem[],
  layout: ZipLayout,
  options: { onProgress?: (done: number) => void; signal?: AbortSignal } = {},
): Promise<(ZipOutcome & { uri: string }) | null> {
  const { onProgress, signal } = options;
  const dir = freshDirectory("photo-zips");
  const output = new File(dir, layout.fileName);
  output.create({ overwrite: true });
  const handle = output.open(FileMode.WriteOnly);
  const writer = new ZipWriter(
    { write: (bytes) => handle.writeBytes(bytes) },
    {
      maxBytes: ZIP_SIZE_LIMIT,
    },
  );

  let added = 0;
  let failed = 0;
  let leftOut = 0;
  let cancelled = false;

  try {
    if (layout.folder) writer.addDirectory(layout.folder);
    for await (const { photo, index, url } of originals(photos)) {
      if (signal?.aborted) {
        cancelled = true;
        break;
      }
      onProgress?.(index);
      if (!url) {
        failed += 1;
        continue;
      }
      let part: File | null = null;
      try {
        part = await File.downloadFileAsync(
          url,
          new File(dir, `part-${index}.${pathExtension(photo.storage_path)}`),
          { idempotent: true, signal },
        );
        const name = layout.entryName(photo, index, part.type);
        const bytes = await part.bytes();
        if (!writer.fits(name, bytes.length)) {
          leftOut = photos.length - index;
          break;
        }
        writer.addFile(name, bytes, new Date(photo.taken_at ?? photo.created_at));
        added += 1;
      } catch (error) {
        if (isAbort(error, signal)) {
          cancelled = true;
          break;
        }
        failed += 1;
      } finally {
        if (part?.exists) part.delete();
      }
    }
    if (!cancelled) writer.finish();
  } finally {
    handle.close();
  }

  if (cancelled) {
    dir.delete();
    return null;
  }
  if (added === 0) {
    dir.delete();
    throw new Error("None of the photos could be downloaded. Check the connection and try again.");
  }
  onProgress?.(photos.length);
  return { uri: output.uri, added, failed, leftOut };
}

/** Hand a finished zip to the share sheet: Files, Downloads, Drive, mail. */
export async function shareZip(uri: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("This phone has no way to share a file from the app.");
  }
  await Sharing.shareAsync(uri, {
    mimeType: "application/zip",
    UTI: "public.zip-archive",
    dialogTitle: "Save or send the zip",
  });
}
