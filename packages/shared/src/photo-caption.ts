// Heuristics to hide auto-generated/ugly filenames from the UI.
// Examples we want to treat as "no real caption":
//   sitepix-1781560897511.jpg
//   walkthrough-1781449720790.jpg
//   IMG_1234.HEIC, image (3).png, photo-2025-01-02.jpeg, Photo 1781560897511
const FILENAME_RE = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?)$/i;
/*
 * The digit run has to reach the END of the string.
 *
 * This used to be `…[\s_-]?\d`, which fired on anything merely *starting* with
 * one of these words followed by a digit - so a caption a person actually
 * typed, like "Photo 3 of the north wall crack", was classified as a generated
 * filename and thrown away. The discard is not cosmetic: `sanitizeCaption`
 * blanks it, and report sections persist the blanked value.
 *
 * Trailing separators and further digit groups are still matched so dated
 * exports like "photo-2025-01-02" are caught, while any real prose after the
 * number keeps the caption.
 */
const GENERATED_PREFIX_RE =
  /^(sitepix|walkthrough|img|image|photo|dsc|pxl|screenshot|capture)[\s_-]?\d[\d\s_-]*$/i;

export function isFilenameLikeCaption(caption?: string | null): boolean {
  if (!caption) return true;
  const c = caption.trim();
  if (!c) return true;
  if (FILENAME_RE.test(c)) return true;
  if (GENERATED_PREFIX_RE.test(c)) return true;
  // Pure long digit blobs (timestamps)
  if (/^\d{8,}$/.test(c)) return true;
  return false;
}

export function cleanCaption(caption?: string | null): string | null {
  return isFilenameLikeCaption(caption) ? null : (caption as string).trim();
}

/**
 * Sanitize a caption that may be plain text or HTML (rich-text).
 * Strips tags/entities to test the underlying text - if it's filename-like
 * or empty, returns "". Otherwise returns the original input unchanged so
 * any rich formatting is preserved.
 */
export function sanitizeCaption(input?: string | null): string {
  if (!input) return "";
  const plain = String(input)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  if (isFilenameLikeCaption(plain)) return "";
  return input;
}

export function displayCaption(caption: string | null | undefined, fallback: string): string {
  return cleanCaption(caption) ?? fallback;
}

export function formatPhotoDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}
