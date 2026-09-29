import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import type Svg from "react-native-svg";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { renderWatermarked } from "@/api/watermark-render";
import { ScanCanvas, ScanWarpCanvas } from "@/components/ScanCanvas";
import {
  isConvexQuad,
  quadBounds,
  scanOutputSize,
  warpPatches,
  type Quad,
  type WarpPatch,
} from "@/components/scan-warp";

/** The largest side a scan's source is decoded at before it is straightened. */
const SOURCE_MAX = 3200;

export type ScanImage = { uri: string; width: number; height: number };

/**
 * A photo made ready for the scan steps: upright and at a size a phone can
 * hold several copies of.
 *
 * Re-encoded through the manipulator, which bakes the EXIF orientation into
 * the pixels. Without it a portrait page shot on Android arrives as a
 * landscape file with a rotate tag, the corners would be set on one picture
 * and warped on another, and the camera's reported size may be either.
 */
export async function prepareScanSource(uri: string): Promise<ScanImage> {
  const loaded = await ImageManipulator.manipulate(uri).renderAsync();
  let rendered = loaded;
  if (Math.max(loaded.width, loaded.height) > SOURCE_MAX) {
    const context = ImageManipulator.manipulate(uri);
    context.resize(loaded.width >= loaded.height ? { width: SOURCE_MAX } : { height: SOURCE_MAX });
    rendered = await context.renderAsync();
  }
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

type Job =
  | { kind: "warp"; src: ScanImage; width: number; height: number; patches: WarpPatch[] }
  | { kind: "enhance"; src: ScanImage };

/** How the page came out, so the screen can say so. */
export type Straightened = "warp" | "box" | "none";

/**
 * The scan pipeline's off-screen surface and the two passes that run on it:
 * straighten the page from its four corners, then the document look.
 *
 * Render `surface` somewhere in the tree (it positions itself off-screen),
 * then call `process`. Every pass fails open: a warp that does not render
 * falls back to cropping the corners' bounding box, and a document look that
 * does not render leaves the page in colour. The page is never lost.
 */
export function useScanSurface(): {
  surface: ReactNode;
  process: (
    src: ScanImage,
    quad: Quad | null,
    enhance: boolean,
  ) => Promise<ScanImage & { straightened: Straightened }>;
} {
  const [job, setJob] = useState<Job | null>(null);
  const ref = useRef<Svg>(null);
  const resolver = useRef<((uri: string | null) => void) | null>(null);

  /*
   * Rasterise once the surface has mounted. 250ms rather than the watermark's
   * 120 because the warp draws the page once per patch, and the first draw is
   * what starts the image decoding.
   */
  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void renderWatermarked(ref.current)
        .then((uri) => {
          if (!cancelled) resolver.current?.(uri);
        })
        .catch(() => {
          if (!cancelled) resolver.current?.(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [job]);

  const run = useCallback(async (next: Job): Promise<string | null> => {
    try {
      return await new Promise<string | null>((resolve) => {
        resolver.current = resolve;
        setJob(next);
        setTimeout(() => resolve(null), 25_000);
      });
    } finally {
      resolver.current = null;
      setJob(null);
    }
  }, []);

  const process = useCallback(
    async (src: ScanImage, quad: Quad | null, enhance: boolean) => {
      let page: ScanImage = src;
      let straightened: Straightened = "none";

      if (quad && isConvexQuad(quad)) {
        // Normalised corners to this image's pixels.
        const px = quad.map((p) => ({ x: p.x * src.width, y: p.y * src.height })) as Quad;
        const size = scanOutputSize(px);
        const patches = warpPatches(px, size.width, size.height);
        const warped = patches.length
          ? await run({ kind: "warp", src, width: size.width, height: size.height, patches })
          : null;
        if (warped) {
          page = { uri: warped, ...size };
          straightened = "warp";
        } else {
          try {
            const rect = quadBounds(px, src.width, src.height);
            const cropped = await ImageManipulator.manipulate(src.uri).crop(rect).renderAsync();
            const saved = await cropped.saveAsync({ format: SaveFormat.JPEG, compress: 0.9 });
            page = { uri: saved.uri, width: saved.width, height: saved.height };
            straightened = "box";
          } catch {
            // Keep the whole photo rather than lose the page.
          }
        }
      }

      if (enhance) {
        const look = await run({ kind: "enhance", src: page });
        if (look) page = { ...page, uri: look };
      }
      return { ...page, straightened };
    },
    [run],
  );

  const surface = job ? (
    <View style={styles.offscreen} pointerEvents="none" accessibilityElementsHidden>
      {job.kind === "warp" ? (
        <ScanWarpCanvas
          ref={ref}
          uri={job.src.uri}
          sourceWidth={job.src.width}
          sourceHeight={job.src.height}
          width={job.width}
          height={job.height}
          patches={job.patches}
        />
      ) : (
        <ScanCanvas ref={ref} uri={job.src.uri} width={job.src.width} height={job.src.height} />
      )}
    </View>
  ) : null;

  return { surface, process };
}

const styles = StyleSheet.create({
  // Off-screen, not hidden: the rasteriser needs a real, laid out view.
  offscreen: { position: "absolute", left: -10000, top: 0 },
});
