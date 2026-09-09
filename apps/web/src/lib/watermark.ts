// Shared photo watermarking utilities - used by camera capture and file uploads
// to label site photos with the Before/After pill. The project address and
// company logo are no longer burnt into photos: the report's title page and
// every shared photo should render clean, and the share pages brand their own
// headers anyway.

export type BeforeAfterTag = "before" | "after" | null;

export interface WatermarkContext {
  tag?: BeforeAfterTag;
}

const JPEG_QUALITY = 0.88;

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Draws the before/after pill onto a photo - the only thing burnt into the
 * stored JPEG.
 *
 * The project address and company logo used to be drawn here too, but that
 * put branding on every photo - including the report's title page - where it
 * could never be removed, and it contradicted the phone app, which only ever
 * drew the pill. Sharing still brands itself: the share pages render their
 * own headers from the company metadata, so nothing is lost by keeping the
 * pixels clean.
 *
 * Only before/after get a pill. This used to stamp a slate "UNTAGGED" chip
 * whenever the capture mode was anything else, and that word is burnt into
 * the JPEG forever: tag the photo "Condenser Being Washed" a minute later and
 * the Details panel says one thing while the pixels next to it still say
 * UNTAGGED. Nothing can resync them, because there is no live badge to resync
 * - the contradiction is inside the image. It was also the wrong word:
 * "Untagged" only ever meant "the shooter picked the Untagged capture mode
 * rather than Before or After", not `photos.tags`. Before/After stay: those
 * the shooter deliberately chose, and they are what the pill is for.
 */
export async function drawWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: WatermarkContext,
): Promise<void> {
  if (opts.tag !== "before" && opts.tag !== "after") return;

  const minDim = Math.min(w, h);
  const pad = Math.round(minDim * 0.035);
  ctx.textBaseline = "alphabetic";

  const text = opts.tag.toUpperCase();
  const tagSize = Math.max(30, Math.round(minDim * 0.082));
  ctx.font = `800 ${tagSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
  const tm = ctx.measureText(text);
  const px = Math.round(tagSize * 0.78);
  const py = Math.round(tagSize * 0.45);
  const boxW = Math.round(tm.width + px * 2);
  const boxH = Math.round(tagSize + py * 2);
  const bx = w - pad - boxW;
  const by = pad;
  const r = Math.round(boxH * 0.5);

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle =
    opts.tag === "before"
      ? "rgba(37,99,235,0.96)" // blue
      : "rgba(16,185,129,0.96)"; // green
  roundRect(ctx, bx, by, boxW, boxH, r);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = Math.max(1, Math.round(minDim * 0.003));
  roundRect(ctx, bx, by, boxW, boxH, r);
  ctx.stroke();

  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.fillText(text, bx + px, by + boxH / 2 + Math.round(tagSize * 0.04));
  ctx.textBaseline = "alphabetic";
}

/**
 * Applies the watermark overlay to a File and returns a new JPEG File.
 * If there is nothing to draw, returns the original file unchanged.
 */
export async function applyWatermarkToFile(file: File, opts: WatermarkContext): Promise<File> {
  if ((opts.tag !== "before" && opts.tag !== "after") || !file.type.startsWith("image/"))
    return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0);
  await drawWatermark(ctx, canvas.width, canvas.height, opts);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}
