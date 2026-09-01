import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The Android notification icon has to be a silhouette, and nothing else will
 * do.
 *
 * Android does not draw the icon you give it. It reads the ALPHA channel and
 * repaints every non-transparent pixel white, discarding colour, gradient and
 * detail. This was pointed at `adaptive-icon.png`, the full-colour mark, whose
 * blades and seams are all opaque - so the status bar would have shown a solid
 * white disc on every notification the product sends. `BrandMark.tsx` says as
 * much about its own geometry: the seams "are what breaks the silhouette, so
 * without them the mark is a gold disc".
 *
 * It is worth a test because it is invisible until it ships. Nothing fails to
 * build, nothing errors, and it cannot be seen at all on iOS, which uses the
 * app icon instead. The only way to catch it is on an Android device, looking
 * at a real notification, and by then it is in a store build.
 *
 * The replacement is derived from the same 150 grid as the vector mark, with
 * the seams cut OUT of the alpha rather than drawn in a second colour.
 */

const ROOT = process.cwd();
const appJson = () => JSON.parse(readFileSync(join(ROOT, "apps/mobile/app.json"), "utf8"));

function notificationsPlugin(): Record<string, unknown> {
  const plugins = appJson().expo.plugins as unknown[];
  const entry = plugins.find((p) => Array.isArray(p) && p[0] === "expo-notifications");
  expect(entry, "the expo-notifications plugin block has gone").toBeTruthy();
  return (entry as [string, Record<string, unknown>])[1];
}

/** Minimal PNG header read: dimensions and colour type, no dependency. */
function readPng(path: string) {
  const buf = readFileSync(join(ROOT, path));
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    colorType: buf[25],
    bytes: buf.length,
  };
}

describe("the Android notification icon", () => {
  it("is its own asset, not the full-colour launcher icon", () => {
    /*
     * The regression. Pointing this back at icon.png or adaptive-icon.png is a
     * one-word change that looks harmless and ships a white blob.
     */
    const icon = notificationsPlugin().icon;
    expect(icon).toBe("./assets/notification-icon.png");
    expect(icon).not.toBe("./assets/adaptive-icon.png");
    expect(icon).not.toBe("./assets/icon.png");
  });

  it("has an alpha channel, because the alpha IS the icon", () => {
    // Colour type 6 is RGBA. A type 2 (RGB) file has no transparency at all,
    // so its silhouette is the whole square.
    const png = readPng("apps/mobile/assets/notification-icon.png");
    expect(png.colorType).toBe(6);
  });

  it("is 96x96, which is 24dp at the highest density", () => {
    const png = readPng("apps/mobile/assets/notification-icon.png");
    expect(png.width).toBe(96);
    expect(png.height).toBe(96);
  });

  it("is small enough to be a glyph rather than a photograph", () => {
    /*
     * A monochrome silhouette compresses to about a kilobyte. If this ever
     * jumps to six figures, somebody has dropped a coloured export in here and
     * the alpha will be a filled rectangle.
     */
    const png = readPng("apps/mobile/assets/notification-icon.png");
    expect(png.bytes).toBeLessThan(20_000);
  });

  it("uses the brand accent, which survives both notification-shade themes", () => {
    /*
     * `color` tints the small icon in the shade. It was the app's dark navy
     * ground (#171B24), which is nearly invisible against a dark-theme shade.
     * The brand amber reads on both.
     */
    expect(notificationsPlugin().color).toBe("#d97c0a");
  });

  it("that amber is the palette's brand token, not a hand-picked hex", () => {
    // Read from the other side, so the two cannot drift apart silently.
    const tokens = readFileSync(join(ROOT, "apps/mobile/src/theme/tokens.ts"), "utf8");
    expect(tokens).toContain('brand: "#d97c0a"');
  });
});
