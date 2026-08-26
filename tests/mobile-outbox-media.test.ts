import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The durable copies behind the offline queue.
 *
 * Two rules are worth pinning, and both are about destroying data rather than
 * about storing it. A queued capture has to survive the OS emptying the camera
 * cache, and the cleanup that removes it has to be certain it is removing a
 * copy the app made rather than the user's own photo.
 */

type Fs = typeof import("./doubles/expo-file-system");
type Media = typeof import("../apps/mobile/src/offline/media");

let fs: Fs;
let media: Media;

const CAMERA_CACHE = "file:///app/cache/Camera/IMG_4821.jpg";
const OUTBOX_DIR = "file:///app/documents/outbox";

beforeEach(async () => {
  vi.resetModules();
  fs = await import("./doubles/expo-file-system");
  fs.__reset();
  media = await import("../apps/mobile/src/offline/media");
});

describe("persistCapture", () => {
  it("copies the capture out of the camera cache", async () => {
    /*
     * The camera hands back a URI in a directory the OS owns and empties
     * whenever it wants storage back. Fine for an upload that happens now,
     * fatal for one that waits out a drive back from site: the row would drain
     * hours later against a file that no longer exists.
     */
    fs.__seedFile(CAMERA_CACHE);

    const stored = media.persistCapture(CAMERA_CACHE, "row-1");

    expect(stored).toBe(`${OUTBOX_DIR}/row-1.jpg`);
    expect(fs.__exists(stored)).toBe(true);
    // The original is left alone. It is not ours to remove.
    expect(fs.__exists(CAMERA_CACHE)).toBe(true);
  });

  it("reuses an existing copy rather than duplicating megabytes", async () => {
    // A retry that re-enters before the first copy was recorded.
    fs.__seedFile(CAMERA_CACHE);
    const first = media.persistCapture(CAMERA_CACHE, "row-1");
    const second = media.persistCapture(CAMERA_CACHE, "row-1");

    expect(second).toBe(first);
    expect(fs.__files().filter((uri) => uri.startsWith(OUTBOX_DIR))).toHaveLength(1);
  });

  it("refuses a capture the OS has already reclaimed", () => {
    expect(() => media.persistCapture(CAMERA_CACHE, "row-1")).toThrow(/no longer on the device/i);
  });
});

describe("discardCapture", () => {
  it("removes a file the app copied", async () => {
    fs.__seedFile(CAMERA_CACHE);
    const stored = media.persistCapture(CAMERA_CACHE, "row-1");

    media.discardCapture(stored);

    expect(fs.__exists(stored)).toBe(false);
  });

  it("refuses to touch anything outside the outbox", () => {
    /*
     * The rule that matters most in this file. `local_uri` on a row that was
     * never copied still points at the camera cache, or at the user's photo
     * library if the capture came from the picker. Deleting there destroys an
     * original the app does not own and cannot restore.
     */
    const libraryOriginal = "file:///user/photos/DCIM/holiday.jpg";
    fs.__seedFile(libraryOriginal);
    fs.__seedFile(CAMERA_CACHE);

    media.discardCapture(libraryOriginal);
    media.discardCapture(CAMERA_CACHE);

    expect(fs.__exists(libraryOriginal)).toBe(true);
    expect(fs.__exists(CAMERA_CACHE)).toBe(true);
  });

  it("does nothing for a row that never held a file", () => {
    expect(() => media.discardCapture(null)).not.toThrow();
    expect(() => media.discardCapture(undefined)).not.toThrow();
    expect(() => media.discardCapture("")).not.toThrow();
  });
});

describe("sweepOrphans", () => {
  it("reclaims files no live row refers to", async () => {
    /*
     * These accumulate from crashes between the copy and the row insert. Nothing
     * else will ever look at them, so without a sweep they are a permanent,
     * invisible chunk of the user's storage.
     */
    fs.__seedFile(CAMERA_CACHE);
    const kept = media.persistCapture(CAMERA_CACHE, "row-live");
    const orphan = media.persistCapture(CAMERA_CACHE, "row-dead");

    const removed = media.sweepOrphans([kept]);

    expect(removed).toBe(1);
    expect(fs.__exists(kept)).toBe(true);
    expect(fs.__exists(orphan)).toBe(false);
  });

  it("keeps everything when every file is still referenced", async () => {
    fs.__seedFile(CAMERA_CACHE);
    const a = media.persistCapture(CAMERA_CACHE, "row-a");
    const b = media.persistCapture(CAMERA_CACHE, "row-b");

    expect(media.sweepOrphans([a, b])).toBe(0);
    expect(fs.__exists(a)).toBe(true);
    expect(fs.__exists(b)).toBe(true);
  });

  it("never reaches outside the outbox directory", () => {
    // A sweep with an empty live list is the most destructive call this module
    // has. It must still only ever see its own directory.
    const libraryOriginal = "file:///user/photos/DCIM/holiday.jpg";
    fs.__seedFile(libraryOriginal);
    fs.__seedFile(CAMERA_CACHE);

    media.sweepOrphans([]);

    expect(fs.__exists(libraryOriginal)).toBe(true);
    expect(fs.__exists(CAMERA_CACHE)).toBe(true);
  });
});
