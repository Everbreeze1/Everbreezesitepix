// Shared photo watermarking utilities - used by camera capture and file uploads
// to brand site photos with Before/After labels and project context.

export type BeforeAfterTag = "before" | "after" | null;

export interface WatermarkContext {
  tag?: BeforeAfterTag;
  projectName?: string | null;
  address?: string | null;
  companyName?: string | null;
  companyLogoUrl?: string | null;
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function hasAnything(opts: WatermarkContext): boolean {
  return !!(
    opts.tag ||
    opts.projectName ||
    opts.address ||
    opts.companyName ||
    opts.companyLogoUrl
  );
}

function truncateToWidth(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + ellipsis).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return text.slice(0, lo).trimEnd() + ellipsis;
}

/**
 * Draws a balanced, premium photo overlay:
 * - Top-left: project address (white text with subtle shadow)
 * - Top-right: prominent BEFORE/AFTER pill, and nothing at all otherwise
 * - Bottom-right: semi-transparent company logo
 * Layout adapts to portrait and landscape via minDim scaling.
 */
export async function drawWatermark(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  opts: WatermarkContext,
): Promise<void> {
  if (!hasAnything(opts)) return;

  const minDim = Math.min(w, h);
  const pad = Math.round(minDim * 0.035);
  ctx.textBaseline = "alphabetic";

  /*
   * ---- Top-right: BEFORE/AFTER pill ----
   *
   * Only before/after get drawn. This used to stamp a slate "UNTAGGED" chip
   * whenever the capture mode was anything else, and that word is burnt into
   * the JPEG forever: tag the photo "Condenser Being Washed" a minute later
   * and the Details panel says one thing while the pixels next to it still
   * say UNTAGGED. Nothing can resync them, because there is no live badge to
   * resync - the contradiction is inside the image.
   *
   * It was also the wrong word. "Untagged" here only ever meant "the shooter
   * picked the Untagged capture mode rather than Before or After"; it says
   * nothing about `photos.tags`, which is the catalogue the Details panel, the
   * tag filter and bulk-tag all read. Two unrelated ideas sharing one label,
   * with the useless one printed on the customer's photo.
   *
   * `share.projects.$token.tsx` already reached this conclusion for the
   * on-screen chip ("`untagged` is not a phase"); this is its burnt-in twin.
   * Before/After stay: those the shooter deliberately chose, and they are what
   * the pill is for.
   */
  let tagBoxLeft = w; // for address truncation
  let tagBoxBottom = pad;
  if (opts.tag === "before" || opts.tag === "after") {
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

    tagBoxLeft = bx;
    tagBoxBottom = by + boxH;
  }

  // ---- Top-left: project address ----
  if (opts.address) {
    const size = Math.max(16, Math.round(minDim * 0.038));
    ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
    ctx.textBaseline = "top";
    const maxWidth = Math.max(80, tagBoxLeft - pad * 2);
    const line = truncateToWidth(ctx, opts.address, maxWidth);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.75)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = "rgba(255,255,255,0.98)";
    ctx.fillText(line, pad, pad + Math.round(size * 0.15));
    ctx.restore();
    ctx.textBaseline = "alphabetic";
  }

  // ---- Bottom-right: company logo, elegant and semi-transparent ----
  if (opts.companyLogoUrl) {
    try {
      const img = await loadImage(opts.companyLogoUrl);
      const maxH = Math.round(minDim * 0.2);
      const maxW = Math.round(w * 0.42);
      const scale = Math.min(maxH / img.height, maxW / img.width);
      const lw = img.width * scale;
      const lh = img.height * scale;
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 22;
      ctx.shadowOffsetY = 3;
      ctx.globalAlpha = 0.92;
      ctx.drawImage(img, w - pad - lw, h - pad - lh, lw, lh);
      ctx.restore();
    } catch {
      // ignore logo load failures
    }
  }
}

/**
 * Applies the watermark overlay to a File and returns a new JPEG File.
 * If there is nothing to draw, returns the original file unchanged.
 */
export async function applyWatermarkToFile(file: File, opts: WatermarkContext): Promise<File> {
  if (!hasAnything(opts) || !file.type.startsWith("image/")) return file;
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
