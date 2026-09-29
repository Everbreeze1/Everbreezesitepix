/**
 * What a zip of photos is called and what is inside it, kept free of React
 * Native so it can be tested.
 *
 * The web makes two different zips and the phone makes the same two, named the
 * same way, so a folder of them on a laptop does not show which device made
 * which:
 *
 *   project   "Export photos as ZIP" in the project's actions menu
 *             (`ProjectActionsMenu.tsx`): one folder named after the job, each
 *             photo `<caption>-<n>.<ext>`, the zip `<job>-photos.zip`.
 *   selection "Download" on the photo bulk bar (`PhotoBulkActionBar.tsx` and
 *             `lib/photo-zip.ts`): flat, each photo named after its caption
 *             with `-2`, `-3` for repeats, the zip `<job>-photos-<date>.zip`.
 */

type ZipPhoto = { id: string; caption: string | null; storage_path: string };

/** How one zip names itself and its entries. */
export type ZipLayout = {
  fileName: string;
  /** A single folder every entry sits in, or null for a flat zip. */
  folder: string | null;
  /** The entry's path inside the zip, folder included. */
  entryName: (photo: ZipPhoto, index: number, mimeType: string) => string;
};

/**
 * The most a zip made on the phone may hold.
 *
 * The format tops out at 4 GB without ZIP64, which this writer does not do.
 * Two is the practical line: the zip sits in the phone's cache while the share
 * sheet hands it on, and a mail or chat app refuses far less than that anyway.
 */
export const ZIP_SIZE_LIMIT = 2 * 1024 * 1024 * 1024;
export const ZIP_SIZE_LIMIT_LABEL = "2 GB";

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

/** The storage path's extension, lower-cased, or jpg when it has none. */
export function pathExtension(path: string): string {
  return /\.([a-z0-9]{2,5})$/i.exec(path)?.[1]?.toLowerCase() ?? "jpg";
}

/** Extension for a downloaded file's type, falling back to its storage path. */
export function photoExtension(mimeType: string | null | undefined, path = ""): string {
  const type = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  return MIME_EXT[type] ?? pathExtension(path);
}

/** The web bulk bar's base name for one photo, without an extension. */
export function photoBaseName(photo: { id: string; caption: string | null }): string {
  const fromCaption = photo.caption
    ?.replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 60);
  return fromCaption || `photo_${photo.id.slice(0, 8)}`;
}

/**
 * Unique names in the order asked, case-insensitively, because the zip is
 * usually unpacked on Windows or macOS where "Kitchen.jpg" and "kitchen.jpg"
 * are the same file.
 */
export function createNameAllocator() {
  const used = new Set<string>();
  return (base: string, ext: string): string => {
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base}-${n}.${ext}`;
    used.add(name.toLowerCase());
    return name;
  };
}

/** The web bulk bar's zip name: the job and the day, or "photos" for a mix. */
export function zipFileName(projectName: string | null | undefined, date = new Date()): string {
  const base = (projectName ?? "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "photos";
  const day = date.toISOString().slice(0, 10);
  return `${base}-photos-${day}.zip`;
}

/** The web project menu's folder name, which is also its zip's name. */
export function projectZipFolder(projectName: string | null | undefined): string {
  return (projectName ?? "").replace(/[^a-z0-9]/gi, "_") || "project";
}

/** A whole job, laid out as the web's "Export photos as ZIP" lays it out. */
export function projectZipLayout(projectName: string | null | undefined): ZipLayout {
  const folder = projectZipFolder(projectName);
  return {
    fileName: `${folder}-photos.zip`,
    folder,
    entryName: (photo, index) => {
      const n = index + 1;
      const base = (photo.caption || `photo-${n}`).replace(/[^a-z0-9]/gi, "_").slice(0, 40);
      return `${folder}/${base}-${n}.${pathExtension(photo.storage_path)}`;
    },
  };
}

/** A bulk-bar selection, laid out as the web's bulk Download lays it out. */
export function selectionZipLayout(
  projectName: string | null | undefined,
  date = new Date(),
): ZipLayout {
  const nameFor = createNameAllocator();
  return {
    fileName: zipFileName(projectName, date),
    folder: null,
    entryName: (photo, _index, mimeType) =>
      nameFor(photoBaseName(photo), photoExtension(mimeType, photo.storage_path)),
  };
}

/** The line under the progress bar while a zip is being built. */
export function zipProgressLabel(done: number, total: number): string {
  if (total <= 0) return "Finding the photos";
  return `Adding ${Math.min(done, total)} of ${total}`;
}

export type ZipOutcome = {
  added: number;
  failed: number;
  /** Photos that were never tried because the zip reached its size limit. */
  leftOut: number;
};

/**
 * What to say once the zip is ready, or null when every photo went in.
 *
 * Said after the share sheet, so a zip that is missing photos never passes for
 * the whole set.
 */
export function zipResultMessage({ added, failed, leftOut }: ZipOutcome): string | null {
  const parts: string[] = [];
  if (leftOut > 0) {
    parts.push(
      `The zip holds the first ${added + failed} photo${added + failed === 1 ? "" : "s"}. ${leftOut} more would have taken it past ${ZIP_SIZE_LIMIT_LABEL}; select them and download a second zip.`,
    );
  }
  if (failed > 0) {
    parts.push(
      `${failed} photo${failed === 1 ? "" : "s"} could not be downloaded and ${
        failed === 1 ? "is" : "are"
      } not in the zip.`,
    );
  }
  return parts.length ? parts.join(" ") : null;
}
