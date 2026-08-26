import { describe, expect, it } from "vitest";
import { readExifMeta, resolvePhotoMeta } from "../apps/mobile/src/api/photo-meta";

/*
 * `apps/mobile/src/api/photo-meta.ts` is pure and imports nothing native, which
 * is the whole reason it is a separate module: the EXIF rules below are easy to
 * get subtly wrong and impossible to notice on a device, because a photo filed
 * at the wrong coordinates still looks like a photo.
 */

describe("readExifMeta", () => {
  it("reads the EXIF date format, which is not a format Date understands", () => {
    // EXIF separates the date with colons: `2026:03:14`, not `2026-03-14`.
    // Passed to `new Date()` untouched this is an Invalid Date, and every photo
    // silently falls back to upload time.
    const meta = readExifMeta({ DateTimeOriginal: "2026:03:14 09:41:07" });
    expect(meta.takenAt).not.toBeNull();
    const parsed = new Date(meta.takenAt!);
    expect(parsed.getFullYear()).toBe(2026);
    expect(parsed.getMonth()).toBe(2);
    expect(parsed.getDate()).toBe(14);
  });

  it("falls back through the other timestamp fields", () => {
    expect(readExifMeta({ CreateDate: "2026:01:02 03:04:05" }).takenAt).not.toBeNull();
    expect(readExifMeta({ DateTime: "2026:01:02 03:04:05" }).takenAt).not.toBeNull();
  });

  it("rejects a camera clock that reset to the epoch", () => {
    // A dead coin cell puts the camera back at 1970. That timestamp would sort
    // the photo to the very start of the project's history forever.
    expect(readExifMeta({ DateTimeOriginal: "1970:01:01 00:00:00" }).takenAt).toBeNull();
  });

  it("applies the hemisphere reference", () => {
    // The classic bug: EXIF stores magnitude plus a separate S/W marker. Ignore
    // the marker and every job site in the western hemisphere lands in Asia.
    const meta = readExifMeta({
      GPSLatitude: 41.8781,
      GPSLatitudeRef: "N",
      GPSLongitude: 87.6298,
      GPSLongitudeRef: "W",
    });
    expect(meta.latitude).toBeCloseTo(41.8781);
    expect(meta.longitude).toBeCloseTo(-87.6298);
  });

  it("leaves an already-signed value alone", () => {
    const meta = readExifMeta({
      GPSLatitude: -33.8688,
      GPSLatitudeRef: "S",
      GPSLongitude: 151.2093,
      GPSLongitudeRef: "E",
    });
    expect(meta.latitude).toBeCloseTo(-33.8688);
    expect(meta.longitude).toBeCloseTo(151.2093);
  });

  it("reads iOS's nested GPS dictionary as well as Android's flat keys", () => {
    const ios = readExifMeta({
      GPS: { Latitude: 51.5074, LatitudeRef: "N", Longitude: 0.1278, LongitudeRef: "W" },
    });
    expect(ios.latitude).toBeCloseTo(51.5074);
    expect(ios.longitude).toBeCloseTo(-0.1278);
  });

  it("treats 0,0 as absent", () => {
    // Null Island is in the Atlantic. It means the field existed and was empty,
    // never a real site.
    const meta = readExifMeta({ GPSLatitude: 0, GPSLongitude: 0 });
    expect(meta.latitude).toBeNull();
    expect(meta.longitude).toBeNull();
  });

  it("parses string coordinates", () => {
    const meta = readExifMeta({ GPSLatitude: "41.8781", GPSLongitude: "-87.6298" });
    expect(meta.latitude).toBeCloseTo(41.8781);
    expect(meta.longitude).toBeCloseTo(-87.6298);
  });

  it("survives missing, empty, and malformed input", () => {
    expect(readExifMeta(null).latitude).toBeNull();
    expect(readExifMeta(undefined).takenAt).toBeNull();
    expect(readExifMeta({}).longitude).toBeNull();
    expect(readExifMeta({ DateTimeOriginal: "not a date" }).takenAt).toBeNull();
    expect(readExifMeta({ GPSLatitude: "abc" }).latitude).toBeNull();
  });
});

describe("resolvePhotoMeta", () => {
  const exifFix = { takenAt: "2026-03-14T09:41:07.000Z", latitude: 10, longitude: 20 };
  const device = { latitude: 30, longitude: 40 };
  const project = { latitude: 50, longitude: 60 };

  it("prefers what the camera stamped on the photo", () => {
    const out = resolvePhotoMeta(exifFix, device, project);
    expect(out.latitude).toBe(10);
    expect(out.longitude).toBe(20);
    expect(out.taken_at).toBe(exifFix.takenAt);
  });

  it("falls back to the device fix before the project address", () => {
    /*
     * This is the step web does not take. A phone camera only writes GPS into
     * EXIF when the camera itself holds location permission, so field photos
     * routinely arrive with none. Falling straight through to the project
     * address would pin every one of them to the street rather than to where
     * the person was standing.
     */
    const out = resolvePhotoMeta(
      { takenAt: null, latitude: null, longitude: null },
      device,
      project,
    );
    expect(out.latitude).toBe(30);
    expect(out.longitude).toBe(40);
  });

  it("falls back to the project when the device has no fix either", () => {
    const out = resolvePhotoMeta({ takenAt: null, latitude: null, longitude: null }, null, project);
    expect(out.latitude).toBe(50);
    expect(out.longitude).toBe(60);
  });

  it("always produces a timestamp", () => {
    const out = resolvePhotoMeta({ takenAt: null, latitude: null, longitude: null }, null, null);
    expect(Number.isNaN(new Date(out.taken_at).getTime())).toBe(false);
    expect(out.latitude).toBeNull();
  });
});
