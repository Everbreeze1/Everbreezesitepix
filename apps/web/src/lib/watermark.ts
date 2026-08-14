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
 * - Top-right: prominent BEFORE/AFTER pill (or small UNTAGGED chip)
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

  // ---- Top-right: BEFORE/AFTER pill, or small UNTAGGED chip ----
  let tagBoxLeft = w; // for address truncation
  let tagBoxBottom = pad;
  {
    const isTagged = opts.tag === "before" || opts.tag === "after";
    const text = isTagged ? opts.tag!.toUpperCase() : "UNTAGGED";
    const tagSize = isTagged
      ? Math.max(30, Math.round(minDim * 0.082))
      : Math.max(14, Math.round(minDim * 0.03));
    ctx.font = `${isTagged ? 800 : 700} ${tagSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial`;
    const tm = ctx.measureText(text);
    const px = Math.round(tagSize * (isTagged ? 0.78 : 0.7));
    const py = Math.round(tagSize * (isTagged ? 0.45 : 0.4));
    const boxW = Math.round(tm.width + px * 2);
    const boxH = Math.round(tagSize + py * 2);
    const bx = w - pad - boxW;
    const by = pad;
    const r = Math.round(boxH * 0.5);

    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = isTagged ? 18 : 8;
    ctx.shadowOffsetY = isTagged ? 4 : 2;
    ctx.fillStyle = isTagged
      ? opts.tag === "before"
        ? "rgba(37,99,235,0.96)" // blue
        : "rgba(16,185,129,0.96)" // green
      : "rgba(15,23,42,0.62)"; // slate, low-key
    roundRect(ctx, bx, by, boxW, boxH, r);
    ctx.fill();
    ctx.restore();

    if (isTagged) {
      ctx.strokeStyle = "rgba(255,255,255,0.55)";
      ctx.lineWidth = Math.max(1, Math.round(minDim * 0.003));
      roundRect(ctx, bx, by, boxW, boxH, r);
      ctx.stroke();
    }

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
