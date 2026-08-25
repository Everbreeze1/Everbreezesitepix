import exifr from "exifr";

export interface PhotoMeta {
  takenAt: string | null; // ISO
  latitude: number | null;
  longitude: number | null;
}

/**
 * Extract GPS + timestamp from a JPEG/HEIC file. Returns nulls on failure -
 * caller should fall back to project address coords and `now()`.
 */
export async function extractPhotoMeta(file: File): Promise<PhotoMeta> {
  try {
    const data = await exifr.parse(file, {
      pick: ["DateTimeOriginal", "CreateDate", "GPSLatitude", "GPSLongitude"],
      gps: true,
    });
    if (!data) return { takenAt: null, latitude: null, longitude: null };
    const d: Date | undefined = data.DateTimeOriginal ?? data.CreateDate;
    return {
      takenAt: d ? new Date(d).toISOString() : null,
      latitude: typeof data.latitude === "number" ? data.latitude : null,
      longitude: typeof data.longitude === "number" ? data.longitude : null,
    };
  } catch {
    return { takenAt: null, latitude: null, longitude: null };
  }
}

export function mergePhotoMeta(
  exif: PhotoMeta,
  fallback: { latitude: number | null; longitude: number | null },
): { taken_at: string; latitude: number | null; longitude: number | null } {
  return {
    taken_at: exif.takenAt ?? new Date().toISOString(),
    latitude: exif.latitude ?? fallback.latitude ?? null,
    longitude: exif.longitude ?? fallback.longitude ?? null,
  };
}

/*
 * `formatPhotoDateGroup` now lives in `@everlumen/shared` so the mobile photo
 * grid groups rows exactly as this gallery does. Re-exported here to keep the
 * existing import path working.
 */
export { formatPhotoDateGroup } from "@everlumen/shared";
