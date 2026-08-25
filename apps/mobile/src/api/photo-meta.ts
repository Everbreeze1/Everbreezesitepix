/**
 * Timestamp and GPS for a captured photo.
 *
 * The web app parses these out of the file's bytes with `exifr`
 * (`apps/web/src/lib/photo-exif.ts`). Mobile does not need to: both
 * `expo-camera` and `expo-image-picker` hand back a native EXIF dictionary
 * alongside the asset, so the data arrives already decoded and there is no
 * byte-parsing library to drag into the bundle.
 *
 * The field names below are what those two modules actually emit, which is
 * close to but not exactly the EXIF spec, and differs a little between iOS and
 * Android. Everything here is defensive: a photo with no usable metadata is
 * normal, not an error.
 */

export type PhotoMeta = {
  /** ISO 8601, or null when the source had no usable timestamp. */
  takenAt: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type Coords = {
  latitude: number | null;
  longitude: number | null;
};

const EMPTY: PhotoMeta = { takenAt: null, latitude: null, longitude: null };

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/**
 * EXIF writes dates as `YYYY:MM:DD HH:MM:SS`, with colons in the date part.
 * `new Date()` cannot read that, so the first two separators are swapped for
 * hyphens. The result carries no timezone, so it is interpreted as device-local
 * time, which is what the person taking the photo means by "when".
 */
function parseExifDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalised = value.trim().replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
  const date = new Date(normalised);
  if (Number.isNaN(date.getTime())) return null;
  // A camera clock reset to 1970 is worse than no timestamp at all.
  if (date.getFullYear() < 2000) return null;
  return date.toISOString();
}

/**
 * Apply the hemisphere reference.
 *
 * EXIF stores latitude and longitude as unsigned magnitudes plus a separate
 * `S`/`W` marker. Ignoring the marker is the classic bug that files a job site
 * in the wrong hemisphere: on Android the raw value often arrives unsigned, so
 * every site in the western hemisphere would map to the same longitude east.
 */
function applyRef(value: number | null, ref: unknown, negative: string): number | null {
  if (value === null) return null;
  const marker = typeof ref === "string" ? ref.trim().toUpperCase() : "";
  if (marker === negative && value > 0) return -value;
  return value;
}

/** Pull timestamp and GPS out of an `expo-camera` / `expo-image-picker` EXIF dictionary. */
export function readExifMeta(exif: Record<string, unknown> | null | undefined): PhotoMeta {
  if (!exif) return EMPTY;

  const takenAt =
    parseExifDate(exif.DateTimeOriginal) ??
    parseExifDate(exif.DateTimeDigitized) ??
    parseExifDate(exif.CreateDate) ??
    parseExifDate(exif.DateTime) ??
    null;

  /*
   * iOS nests GPS under a `GPS` sub-dictionary; Android flattens it onto the
   * top level. Read both rather than branching on `Platform.OS`, which would be
   * one more thing to get wrong on a device nobody tested.
   */
  const gps = (exif.GPS as Record<string, unknown> | undefined) ?? exif;

  const latitude = applyRef(
    asNumber(gps.GPSLatitude ?? gps.Latitude),
    gps.GPSLatitudeRef ?? gps.LatitudeRef,
    "S",
  );
  const longitude = applyRef(
    asNumber(gps.GPSLongitude ?? gps.Longitude),
    gps.GPSLongitudeRef ?? gps.LongitudeRef,
    "W",
  );

  // 0,0 is in the Atlantic. It means "the field was present but empty", never
  // a real job site.
  const hasFix = latitude !== null && longitude !== null && (latitude !== 0 || longitude !== 0);

  return {
    takenAt,
    latitude: hasFix ? latitude : null,
    longitude: hasFix ? longitude : null,
  };
}

/**
 * Settle on the values written to the `photos` row.
 *
 * Preference order for coordinates: what the camera stamped on the photo, then
 * where the device was standing, then the project's own address.
 *
 * The device fix is a step beyond what web does, and it matters here. Phone
 * cameras only write GPS into EXIF when location permission is granted to the
 * camera itself, so field photos routinely arrive with no fix at all. Falling
 * straight through to the project address would place every one of them at the
 * street pin instead of where the person was standing.
 */
export function resolvePhotoMeta(
  exif: PhotoMeta,
  device: Coords | null,
  project: Coords | null,
): { taken_at: string; latitude: number | null; longitude: number | null } {
  return {
    taken_at: exif.takenAt ?? new Date().toISOString(),
    latitude: exif.latitude ?? device?.latitude ?? project?.latitude ?? null,
    longitude: exif.longitude ?? device?.longitude ?? project?.longitude ?? null,
  };
}
