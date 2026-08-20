import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { drawWatermark, type WatermarkContext } from "../apps/web/src/lib/watermark";

/**
 * The photo-gallery review, pinned.
 *
 *   "there's no bulk-select functionality anywhere in the grid - no checkbox on
 *    hover, no select mode, no context menu option - despite our Help Center
 *    explicitly telling users they can select photos to bulk-tag, move, share,
 *    or delete."
 *
 *   "in the Annotate editor, pressing Escape mid-edit (e.g., while placing a
 *    measurement point) closes the entire editor and silently discards all
 *    unsaved annotation work - no confirmation prompt."
 *
 *   "a photo displayed an 'UNTAGGED' badge on the image overlay while the
 *    Details panel right next to it showed a tag already applied."
 *
 *   "thumbnails show a brief blank/dark render delay (1-2 seconds) on first
 *    load."
 *
 * Four findings, four different mistakes, and every one of them is the kind a
 * later refactor would reintroduce without being told not to.
 */

const ROOT = resolve(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Code only. The fixes quote the broken behaviour in the comments explaining them. */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ── The burnt-in UNTAGGED chip ──────────────────────────────────────────────

/**
 * Enough of a 2D context to run `drawWatermark` and record what it wrote.
 *
 * The real thing needs a canvas, but every call this function makes is either a
 * setter or a path/paint verb - so a recorder answers the only question worth
 * asking here, which is what text ends up on the customer's photo.
 */
function recordingContext() {
  const drawn: string[] = [];
  const ctx = {
    drawn,
    font: "",
    fillStyle: "" as unknown,
    strokeStyle: "" as unknown,
    lineWidth: 0,
    globalAlpha: 1,
    shadowColor: "",
    shadowBlur: 0,
    shadowOffsetY: 0,
    textBaseline: "alphabetic" as CanvasTextBaseline,
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText: (text: string) => void drawn.push(text),
    strokeText: (text: string) => void drawn.push(text),
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    fill: () => {},
    stroke: () => {},
    drawImage: () => {},
  };
  return ctx;
}

const draw = async (opts: WatermarkContext) => {
  const ctx = recordingContext();
  await drawWatermark(ctx as unknown as CanvasRenderingContext2D, 1600, 1200, opts);
  return ctx.drawn;
};

describe("the watermark never burns the word UNTAGGED into a photo", () => {
  /*
   * The reported symptom was read as two badges disagreeing, but there is only
   * one badge and it is not live: `drawWatermark` painted UNTAGGED into the
   * JPEG at capture time. Tag the photo afterwards and the Details panel
   * updates while the pixels cannot, so the two can never agree again. Nothing
   * in the app could have resynced them.
   */
  it("draws nothing top-right when the shooter picked no marker", async () => {
    expect(await draw({ tag: null, address: "42 Rye Lane" })).not.toContain("UNTAGGED");
  });

  it("draws nothing top-right for the Untagged capture mode either", async () => {
    // `uploadOne` stores the literal string "untagged" for that camera mode.
    const drawn = await draw({ tag: "untagged" as unknown as null, address: "42 Rye Lane" });
    expect(drawn).not.toContain("UNTAGGED");
    expect(drawn).not.toContain("Untagged");
  });

  it("still draws the Before and After pills, which the shooter did choose", async () => {
    expect(await draw({ tag: "before" })).toContain("BEFORE");
    expect(await draw({ tag: "after" })).toContain("AFTER");
  });

  it("keeps drawing the address next to a photo with no marker", async () => {
    // The address is truncated against the tag box. With no tag box there is a
    // whole photo's width to play with, and it must not fall out entirely.
    expect(await draw({ tag: null, address: "42 Rye Lane" })).toContain("42 Rye Lane");
  });

  it("has no UNTAGGED literal left in the code", () => {
    // Comments only, where the note explaining the removal names the old chip.
    expect(stripComments(read("apps/web/src/lib/watermark.ts"))).not.toContain("UNTAGGED");
  });
});

// ── Escape in the annotator ─────────────────────────────────────────────────

describe("Escape in the Annotate editor backs out one step, it does not bin the work", () => {
  const SRC = read("apps/web/src/features/photos/components/PhotoAnnotator.tsx");
  const CODE = stripComments(SRC);

  /*
   * The old handler did clear the in-progress draft on Escape - and then let
   * the key carry on to Radix, whose dialog closed the editor behind it. Both
   * things happened on one press, which is why the work vanished with no
   * prompt. Stopping the key is the half that was missing.
   */
  it("stops the key rather than letting the dialog underneath also act on it", () => {
    const handler = CODE.slice(CODE.indexOf('if (e.key === "Escape")'));
    expect(handler).toMatch(/e\.stopPropagation\(\)/);
  });

  it("takes Escape away from Radix outright", () => {
    expect(CODE).toMatch(/onEscapeKeyDown=\{\(e\) => e\.preventDefault\(\)\}/);
  });

  it("listens in the capture phase, so a focused text field cannot swallow it", () => {
    expect(CODE).toMatch(/window\.addEventListener\("keydown", onKey, true\)/);
    expect(CODE).toMatch(/window\.removeEventListener\("keydown", onKey, true\)/);
  });

  it("cancels the in-progress action first and only then considers closing", () => {
    expect(CODE).toMatch(/if \(!cancelInProgress\(\)\) void requestClose\(\)/);
  });

  it("backs out of a measurement waiting to be calibrated, the reported case", () => {
    const cancel = CODE.slice(CODE.indexOf("const cancelInProgress"));
    for (const state of [
      "textPrompt",
      "calibrate",
      "cropDraft",
      "polyDraft",
      "draft",
      "selectedId",
    ])
      expect(cancel).toContain(state);
  });

  it("closes an open toolbar popover before anything else", () => {
    // This listener swallows Escape, so Radix never sees the key it would
    // normally close a popover with. Missing this trades one bug for another.
    const cancel = CODE.slice(CODE.indexOf("const cancelInProgress"));
    const popovers = cancel.indexOf("stickerPickerOpen");
    expect(popovers).toBeGreaterThanOrEqual(0);
    expect(popovers).toBeLessThan(cancel.indexOf("textPrompt"));
  });

  it("asks before discarding unsaved work, counting crop and rotate as work", () => {
    const dirty = CODE.slice(CODE.indexOf("const isDirty"), CODE.indexOf("const closingRef"));
    for (const state of ["shapes.length", "cropRect", "rotation", "brightness", "contrast"])
      expect(dirty).toContain(state);
    expect(CODE).toMatch(/confirmText: "Discard"/);
  });

  it("does not prompt on a clean editor, where there is nothing to lose", () => {
    expect(CODE).toMatch(/if \(!isDirty\) \{\s*onClose\(\);/);
  });

  it("routes Cancel and the outside click through the same guard as Escape", () => {
    expect(CODE).toMatch(/onClick=\{\(\) => void requestClose\(\)\}/);
    expect(CODE).toMatch(/if \(!o\) void requestClose\(\)/);
  });

  it("ignores the Escape that dismissed its own confirmation", () => {
    // The prompt is a sibling layer at the root, so its Escape reaches this
    // listener too. Without the guard, declining "Discard?" re-asks forever.
    expect(CODE).toMatch(/if \(confirmationIsOpen\(\)\) return/);
  });
});

describe("a confirmation is never raised behind the screen that asked for it", () => {
  /*
   * "Discard your annotations?" is worthless if it renders under an opaque
   * full-screen editor. The annotator sits at z-[120] and its popovers at
   * z-[140], against the shadcn default of z-50 on the alert dialog.
   */
  const SRC = read("apps/web/src/components/ui/alert-dialog.tsx");

  it("puts the alert dialog above every layer that lifts itself off z-50", () => {
    expect(SRC).toMatch(/const CONFIRM_LAYER = "z-\[200\]"/);
    // Both halves: a content panel over a lower overlay still shows the
    // editor through the gap around it.
    expect(SRC.match(/CONFIRM_LAYER,/g)?.length).toBe(2);
  });

  it("leaves no z-50 behind on either half", () => {
    expect(stripComments(SRC)).not.toMatch(/\bz-50\b/);
  });
});

// ── Bulk select in the Gallery ──────────────────────────────────────────────

describe("the Gallery grid can select photos, which the Help Center has always said", () => {
  const SRC = read("apps/web/src/features/gallery/pages/GalleryPage.tsx");
  const CODE = stripComments(SRC);
  const HELP = read("apps/web/src/features/settings/pages/HelpPage.tsx");

  it("still makes the promise the fix is here to keep", () => {
    // If this ever moves, the test below is measuring the wrong thing.
    expect(HELP).toMatch(/Select photos to download, tag, print, share/);
  });

  it("mounts the same bulk bar the project Photos tab uses", () => {
    expect(CODE).toContain("<PhotoBulkActionBar");
    expect(CODE).toMatch(/onSelectAll=\{\(\) => setSelectedIds\(visiblePhotos\.map/);
  });

  it("has a tick box on every tile, and a Select mode for touch where hover does not exist", () => {
    expect(CODE).toMatch(/aria-label=\{selected \? "Deselect photo" : "Select photo"\}/);
    expect(CODE).toContain("const [selectMode, setSelectMode]");
    expect(CODE).toMatch(/group-hover:opacity-100/);
  });

  it("keeps selecting once a run has started rather than jumping to the lightbox", () => {
    expect(CODE).toMatch(/picking \? toggleSelect\(p\.id\) : void openPhoto\(p\)/);
  });

  it("does not nest the tick box inside the tile button", () => {
    // Two buttons, one inside the other, is invalid and browsers disagree about
    // which one owns the click.
    const tile = CODE.slice(CODE.indexOf("visiblePhotos.map((p) => {"));
    expect(tile.slice(0, tile.indexOf("</div>"))).not.toMatch(/<button[\s\S]*<button/);
  });

  it("drops photos from the selection once a filter hides them", () => {
    // Otherwise Trash deletes photos the user was never shown.
    expect(CODE).toMatch(/const onScreen = new Set\(visiblePhotos\.map\(\(p\) => p\.id\)\)/);
  });

  it("only lets Escape clear the selection when nothing is layered over the grid", () => {
    // The bulk Tag dialog and the lightbox own their own Escape; that press is
    // not about the selection underneath them.
    expect(CODE).toMatch(/e\.key === "Escape" && !modalLayerIsOpen\(\)/);
  });

  it("hides selection from the calendar, which the bar's actions would reorder underneath", () => {
    expect(CODE).toMatch(/\{!calendarView && \(\s*<PhotoBulkActionBar/);
  });
});

describe("the bulk bar copes with a selection that spans projects", () => {
  const SRC = read("apps/web/src/features/photos/components/PhotoBulkActionBar.tsx");
  const CODE = stripComments(SRC);

  it("accepts no single project, because the Gallery is cross-project", () => {
    expect(CODE).toMatch(/projectId: string \| null;/);
  });

  it("disables only the two actions that genuinely need one project", () => {
    // Download, tag, print, share, hide and trash are per-photo either way.
    // Reports and Generate file against a project, and a mixed set has none.
    expect(CODE).toMatch(/disabled=\{!projectId\}/);
    expect(CODE).toMatch(/Narrow the selection to one to generate a document/);
    expect(CODE).toMatch(/Narrow the selection to one to build a report/);
  });

  it("offers every project as a destination when there is no source to exclude", () => {
    expect(CODE).toMatch(/projectId \? query\.neq\("id", projectId\) : query/);
  });

  it("keeps the project-scoped dialogs unmounted without a project", () => {
    expect(CODE).toMatch(/\{projectId && \(\s*<NewReportDialog/);
    expect(CODE).toMatch(/\{projectId && \(\s*<AddToReportDialog/);
  });
});

// ── The blank thumbnail pause ───────────────────────────────────────────────

describe("a grid tile does not download the camera original while waiting for its thumbnail", () => {
  const SRC = read("apps/web/src/components/PhotoThumb.tsx");
  const CODE = stripComments(SRC);

  /*
   * `fallbackUrl` is the full-size signed URL. Seeding the initial state with
   * it looked like a head start and was the opposite: on a cold cache every
   * visible tile began pulling a multi-megabyte original, sat on its grey
   * placeholder while it came down, and then swapped to the thumbnail that had
   * arrived long before. That is the blank-tile pause on first load.
   */
  it("waits for the thumbnail when one is expected", () => {
    expect(CODE).toMatch(
      /wanted \? \(cache\.get\(wanted\) \?\? null\) : \(fallbackUrl \?\? null\)/,
    );
  });

  it("still falls back to the original once signing the thumbnail fails", () => {
    expect(CODE).toMatch(/setUrl\(signed \?\? fallbackUrl \?\? null\)/);
  });

  it("signs a screenful in one request rather than one per tile", () => {
    // Browsers run about six requests per host at a time, so a screenful of
    // singular `createSignedUrl` calls queued into waves.
    expect(CODE).toContain("createSignedUrls(batch");
    expect(CODE).not.toContain("createSignedUrl(path");
  });

  it("shares one request between two tiles of the same photo", () => {
    expect(CODE).toContain("inflight.get(path)");
  });
});
