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

/** "Today", "Yesterday", or "Tue, Jun 3" / "Jun 3, 2025" for older. */
export function formatPhotoDateGroup(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  if (d.getFullYear() === now.getFullYear())
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
