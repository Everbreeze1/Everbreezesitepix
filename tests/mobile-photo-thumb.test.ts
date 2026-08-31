import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * A photo grid must never render a missing photo as nothing.
 *
 * This is the bug, and it made the Gallery look like an empty screen with a
 * date header floating on it.
 *
 * `photos` on this workspace holds 652 rows and most of the storage objects
 * behind them were never uploaded. `createSignedUrls` answers per path, so a
 * missing object comes back `{ error: "Either the object does not exist or you
 * do not have access to it", signedUrl: null }` while its neighbours sign
 * fine - 8 of 9 on the first gallery page. `signPhotoUrls` discarded that
 * error, so the tile got `source={undefined}`, and an `<Image>` with no source
 * draws **nothing at all**: no box, no colour, no outline.
 *
 * Every layer was correct. The grid was right, the tiles were laid out at the
 * right 320x320 positions, the accessibility tree listed them, tsc and lint and
 * 2400 tests were green, and the screen was blank with nothing in any log.
 */

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("signPhotoUrls does not swallow storage failures", () => {
  const src = () => read("apps/mobile/src/api/photos.ts");

  it("reads the error off createSignedUrls", () => {
    // `const { data } = await ...` was the whole bug: the error had nowhere to
    // go, so nothing anywhere could report it.
    expect(src()).toMatch(/const \{ data, error \} = await supabase\.storage/);
  });

  it("says something when objects cannot be signed", () => {
    const s = src();
    expect(s).toMatch(/console\.warn/);
    expect(s).toMatch(/could not be signed|batch of/);
  });

  it("retries a failed thumbnail against the original", () => {
    /*
     * `thumb_path` can point at a file that was never written: the web writes a
     * downscaled copy beside each upload and mobile captures never had one. One
     * extra request for the affected photos turns a blank tile into the picture.
     */
    const s = src();
    expect(s).toMatch(/fallback/);
    expect(s).toMatch(/retry/);
  });
});

describe("PhotoThumb draws the missing case", () => {
  const src = () => read("apps/mobile/src/ui/PhotoThumb.tsx");

  it("renders a placeholder rather than returning null", () => {
    /*
     * The component's whole reason for existing. Returning null, or rendering
     * an `<Image>` with no source, reproduces the original bug exactly.
     */
    const s = src();
    expect(s).not.toMatch(/return null/);
    expect(s).toMatch(/ImageOff/);
    expect(s).toMatch(/accessibilityLabel="Photo unavailable"/);
  });

  it("marks the placeholder as absent, not as loading", () => {
    // A solid panel the same colour as a skeleton reads as "still loading",
    // forever. A dashed edge is the convention for "nothing here".
    expect(src()).toMatch(/borderStyle: "dashed"/);
  });
});

describe("photo grids use it", () => {
  /*
   * Checked per file rather than trusted, because the failure is invisible: a
   * grid that goes back to a bare `<Image>` looks fine in review, passes every
   * type check, and renders an empty screen the moment a file is missing.
   */
  const GRIDS = [
    "apps/mobile/app/(app)/(tabs)/gallery.tsx",
    "apps/mobile/app/(app)/project/[id]/index.tsx",
    "apps/mobile/app/(app)/project/[id]/trash.tsx",
  ];

  it("every converted grid renders through PhotoThumb", () => {
    for (const path of GRIDS) {
      expect(read(path), `${path} should use PhotoThumb`).toMatch(/<PhotoThumb/);
    }
  });

  it("no converted grid still passes an undefined source to an Image", () => {
    // The exact shape that drew nothing: `source={x ? {uri: x} : undefined}`
    // inside a grid tile.
    for (const path of GRIDS) {
      const s = read(path);
      const tileGrid = s.split("lightbox")[0];
      expect(tileGrid, `${path} has a bare Image in its grid`).not.toMatch(
        /source=\{urls\[photo\.id\] \? \{ uri: urls\[photo\.id\] \} : undefined\}/,
      );
    }
  });
});
