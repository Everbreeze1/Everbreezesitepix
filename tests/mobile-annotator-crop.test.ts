import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { annotationCanvasSize } from "../apps/mobile/src/api/annotation";

/*
 * The annotator must not crop the photograph it is marking up.
 *
 * This is a data-loss bug wearing a layout bug's clothes. `AnnotationCanvas`
 * draws the photo inside an `<Svg>`, and `saveAnnotatedPhoto` rasterises that
 * same surface with `toDataURL` - so whatever the canvas does to the picture is
 * what gets written to the new file and uploaded.
 *
 * The surface used to take the full screen width and then clamp the height:
 *
 *     const canvasWidth = window.width;
 *     const canvasHeight = Math.min(window.height * 0.62, canvasWidth / aspect);
 *
 * For a landscape photo those agree. For a portrait one the clamp shortens the
 * box without narrowing it, leaving a surface WIDER than the photograph's
 * aspect - and `preserveAspectRatio="... slice"` fills that box by cropping.
 * On a 9:16 photograph about a quarter of the height went: out of the editor,
 * so it could not be marked up, and out of the saved copy, permanently.
 *
 * Marking up a defect and then filing a picture with the defect cropped off is
 * about the worst outcome this screen has.
 */

const PHONE = { width: 360, height: 780 };
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

describe("the drawing surface matches the photograph", () => {
  const CASES: [string, number][] = [
    ["landscape 4:3", 4 / 3],
    ["square", 1],
    ["portrait 3:4", 3 / 4],
    ["tall 9:16", 9 / 16],
    ["very tall panorama", 1 / 3],
    ["very wide panorama", 3],
  ];

  for (const [name, aspect] of CASES) {
    it(`keeps the aspect exactly for a ${name} photo`, () => {
      const box = annotationCanvasSize(PHONE, aspect);
      // Within a rounding hair. Anything more is a visible crop or letterbox.
      expect(box.width / box.height).toBeCloseTo(aspect, 6);
    });

    it(`fits a ${name} photo on the screen`, () => {
      const box = annotationCanvasSize(PHONE, aspect);
      expect(box.width).toBeLessThanOrEqual(PHONE.width + 0.001);
      expect(box.height).toBeLessThanOrEqual(PHONE.height * 0.62 + 0.001);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
    });
  }

  it("the old formula really did crop a tall photo, which is why this exists", () => {
    /*
     * Not a tautology: this reproduces the previous arithmetic and shows the
     * surface it produced disagreed with the photograph. Without this the test
     * above could be satisfied by any formula at all.
     */
    const aspect = 9 / 16;
    const oldWidth = PHONE.width;
    const oldHeight = Math.min(PHONE.height * 0.62, oldWidth / aspect);
    const oldAspect = oldWidth / oldHeight;
    // 0.744 against the photo's 0.5625: the surface was a third wider than the
    // picture it was supposed to be showing.
    expect(oldAspect / aspect).toBeGreaterThan(1.3);

    const lost = 1 - oldHeight / (oldWidth / aspect);
    expect(lost).toBeGreaterThan(0.2); // over a fifth of the picture

    const now = annotationCanvasSize(PHONE, aspect);
    expect(now.width / now.height).toBeCloseTo(aspect, 6);
  });

  it("survives a photo with no usable dimensions", () => {
    // `width`/`height` arrive as route params and can be missing. A zero-sized
    // canvas would render an invisible, unmarkable photo.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const box = annotationCanvasSize(PHONE, bad);
      expect(box.width, String(bad)).toBeGreaterThan(0);
      expect(box.height, String(bad)).toBeGreaterThan(0);
    }
  });
});

describe("and the canvas letterboxes rather than crops", () => {
  it("uses meet, not slice", () => {
    /*
     * Belt and braces. The sizing above means the two agree, but if they ever
     * disagree, `meet` shows a hairline of background at the edge while
     * `slice` silently cuts the picture down and writes the cropped version.
     */
    const canvas = read("apps/mobile/src/components/AnnotationCanvas.tsx");
    expect(canvas).toContain('preserveAspectRatio="xMidYMid meet"');
    // The ATTRIBUTE, not the word: "slice" appears in the comment above it
    // explaining what it used to do, and a bare substring check flagged that.
    expect(canvas).not.toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it("the screen uses the shared helper rather than its own arithmetic", () => {
    const screen = read("apps/mobile/app/(app)/photo/[id]/annotate.tsx");
    expect(screen).toContain("annotationCanvasSize(window, aspect)");
    expect(screen).not.toContain("Math.min(window.height * 0.62");
  });

  it("and the save really does rasterise this surface", () => {
    // The reason a display bug is a data bug here.
    expect(read("apps/mobile/src/api/photo-annotations.ts")).toContain("canvas.toDataURL(");
  });
});
