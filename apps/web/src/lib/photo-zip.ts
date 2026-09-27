/**
 * File names for a zip of selected photos.
 *
 * Kept import-free so it can be tested. Two things go wrong quietly in a zip
 * that do not in one-at-a-time downloads: two photos captioned "Kitchen" land
 * on the same path and the second silently replaces the first, and a caption
 * carrying `/` becomes a folder. Names are sanitised the same way the single
 * download always was, and repeats get a `-2`, `-3` suffix.
 */

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/gif": "gif",
};

/** Extension for a downloaded blob's type, falling back to jpg. */
export function photoExtension(mimeType: string | null | undefined): string {
  return MIME_EXT[(mimeType ?? "").toLowerCase().split(";")[0].trim()] ?? "jpg";
}

/** The base name for one photo, without an extension. */
export function photoBaseName(photo: { id: string; caption: string | null }): string {
  // `-` is last in the class, so it is a literal and needs no escape.
  const fromCaption = photo.caption
    ?.replace(/[^\w.-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 60);
  return fromCaption || `photo_${photo.id.slice(0, 8)}`;
}

/**
 * Hands out unique names in the order asked. Case-insensitive, because the
 * zip is usually unpacked on Windows or macOS, where "Kitchen.jpg" and
 * "kitchen.jpg" are the same file.
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

/** A safe zip file name for a project, or "photos" for a mixed selection. */
export function zipFileName(projectName: string | null | undefined, date = new Date()): string {
  const base = (projectName ?? "").replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "photos";
  const day = date.toISOString().slice(0, 10);
  return `${base}-photos-${day}.zip`;
}
