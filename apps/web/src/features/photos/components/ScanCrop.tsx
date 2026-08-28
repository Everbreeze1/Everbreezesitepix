import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, RotateCcw, X, Loader2 } from "lucide-react";

interface Pt {
  x: number;
  y: number;
}

interface Props {
  open: boolean;
  imageUrl: string;
  onCancel: () => void;
  /** Returns a JPEG blob of the perspective-corrected crop. */
  onApply: (blob: Blob) => void;
}

/**
 * Manual 4-corner perspective crop. User drags corner handles to frame a
 * document; on Apply we compute a homography and warp the quad into an
 * axis-aligned rectangle.
 */
export function ScanCrop({ open, imageUrl, onCancel, onApply }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  // Corner points in *displayed* pixel space (relative to img container).
  const [pts, setPts] = useState<Pt[]>([]);
  const [dragging, setDragging] = useState<number | null>(null);

  // Initialize corners at 10% inset once we know the display size.
  useEffect(() => {
    if (!open || !size.w || !size.h) return;
    const ix = size.w * 0.08;
    const iy = size.h * 0.08;
    setPts([
      { x: ix, y: iy },
      { x: size.w - ix, y: iy },
      { x: size.w - ix, y: size.h - iy },
      { x: ix, y: size.h - iy },
    ]);
  }, [open, size.w, size.h]);

  const onImgLoad = () => {
    const img = imgRef.current;
    if (!img) return;
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    setSize({ w: img.clientWidth, h: img.clientHeight });
  };

  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      const img = imgRef.current;
      if (img) setSize({ w: img.clientWidth, h: img.clientHeight });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [open]);

  const scale = useMemo(() => {
    if (!size.w || !natural.w) return 1;
    return natural.w / size.w;
  }, [size.w, natural.w]);

  const move = (e: React.PointerEvent) => {
    if (dragging == null || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(size.w, e.clientX - rect.left));
    const y = Math.max(0, Math.min(size.h, e.clientY - rect.top));
    setPts((p) => p.map((pt, i) => (i === dragging ? { x, y } : pt)));
  };

  const reset = () => {
    const ix = size.w * 0.08;
    const iy = size.h * 0.08;
    setPts([
      { x: ix, y: iy },
      { x: size.w - ix, y: iy },
      { x: size.w - ix, y: size.h - iy },
      { x: ix, y: size.h - iy },
    ]);
  };

  const apply = async () => {
    if (pts.length !== 4 || !natural.w) return;
    setBusy(true);
    try {
      // Scale display coords to natural image coords.
      const src = pts.map((p) => ({ x: p.x * scale, y: p.y * scale }));
      // Estimate output dimensions from average edge lengths.
      const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
      const topW = dist(src[0], src[1]);
      const botW = dist(src[3], src[2]);
      const leftH = dist(src[0], src[3]);
      const rightH = dist(src[1], src[2]);
      const outW = Math.round(Math.max(topW, botW));
      const outH = Math.round(Math.max(leftH, rightH));
      if (outW < 32 || outH < 32) throw new Error("Crop area too small");

      const dst: Pt[] = [
        { x: 0, y: 0 },
        { x: outW, y: 0 },
        { x: outW, y: outH },
        { x: 0, y: outH },
      ];
      // Compute homography mapping dst -> src (so we can sample src pixels).
      const H = computeHomography(dst, src);
      if (!H) throw new Error("Could not compute perspective transform");

      // Load source pixels.
      const bitmap = await loadBitmap(imageUrl);
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = natural.w;
      srcCanvas.height = natural.h;
      const sctx = srcCanvas.getContext("2d");
      if (!sctx) throw new Error("Canvas unavailable");
      sctx.drawImage(bitmap, 0, 0);
      const srcImg = sctx.getImageData(0, 0, natural.w, natural.h);
      const sD = srcImg.data;
      const sW = natural.w;
      const sH = natural.h;

      const dstCanvas = document.createElement("canvas");
      dstCanvas.width = outW;
      dstCanvas.height = outH;
      const dctx = dstCanvas.getContext("2d");
      if (!dctx) throw new Error("Canvas unavailable");
      const outImg = dctx.createImageData(outW, outH);
      const oD = outImg.data;

      // Warp: for each dst pixel (u,v), find src (x,y) via H, sample bilinearly.
      const [a, b, c, d, e, f, g, h] = H;
      for (let v = 0; v < outH; v++) {
        for (let u = 0; u < outW; u++) {
          const denom = g * u + h * v + 1;
          const sx = (a * u + b * v + c) / denom;
          const sy = (d * u + e * v + f) / denom;
          const idx = (v * outW + u) * 4;
          if (sx < 0 || sy < 0 || sx >= sW - 1 || sy >= sH - 1) {
            oD[idx] = oD[idx + 1] = oD[idx + 2] = 255;
            oD[idx + 3] = 255;
            continue;
          }
          const x0 = Math.floor(sx);
          const y0 = Math.floor(sy);
          const dx = sx - x0;
          const dy = sy - y0;
          const i00 = (y0 * sW + x0) * 4;
          const i10 = i00 + 4;
          const i01 = i00 + sW * 4;
          const i11 = i01 + 4;
          for (let ch = 0; ch < 3; ch++) {
            const v00 = sD[i00 + ch];
            const v10 = sD[i10 + ch];
            const v01 = sD[i01 + ch];
            const v11 = sD[i11 + ch];
            const top = v00 + (v10 - v00) * dx;
            const bot = v01 + (v11 - v01) * dx;
            oD[idx + ch] = top + (bot - top) * dy;
          }
          oD[idx + 3] = 255;
        }
      }
      dctx.putImageData(outImg, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        dstCanvas.toBlob((b) => resolve(b), "image/jpeg", 0.9),
      );
      if (!blob) throw new Error("Encoding failed");
      onApply(blob);
    } catch (err) {
      console.error("[ScanCrop] apply failed", err);
      setBusy(false);
    }
  };

  const handleSize = 22;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent
        className="fixed inset-0 z-[110] h-screen max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden border-0 bg-black p-0 text-white [&>button[aria-label='Close']]:hidden"
        style={{ width: "100vw", height: "100dvh", maxHeight: "100dvh" }}
      >
        <div className="relative flex h-full w-full flex-col">
          {/* Top bar */}
          <div className="flex items-center justify-between border-b border-white/10 bg-black/60 px-4 py-3">
            <button
              onClick={onCancel}
              aria-label="Cancel crop"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <X className="h-5 w-5" />
            </button>
            <p className="text-sm font-semibold">Adjust document corners</p>
            <button
              onClick={reset}
              aria-label="Reset corners"
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
          </div>

          {/* Image + handles */}
          <div className="flex flex-1 items-center justify-center overflow-hidden p-4">
            <div
              ref={containerRef}
              className="relative inline-block max-h-full max-w-full touch-none select-none"
              onPointerMove={move}
              onPointerUp={() => setDragging(null)}
              onPointerLeave={() => setDragging(null)}
            >
              <img
                ref={imgRef}
                src={imageUrl}
                alt="Document to crop"
                onLoad={onImgLoad}
                draggable={false}
                className="max-h-[calc(100dvh-180px)] max-w-full select-none object-contain"
              />
              {pts.length === 4 && size.w > 0 && (
                <svg
                  width={size.w}
                  height={size.h}
                  className="pointer-events-none absolute left-0 top-0"
                >
                  <polygon
                    points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                    fill="rgba(59,130,246,0.15)"
                    stroke="rgb(59,130,246)"
                    strokeWidth={2}
                  />
                </svg>
              )}
              {pts.map((p, i) => (
                <div
                  key={i}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    (e.target as Element).setPointerCapture?.(e.pointerId);
                    setDragging(i);
                  }}
                  className="absolute rounded-full border-2 border-white bg-primary shadow-lg"
                  style={{
                    width: handleSize,
                    height: handleSize,
                    left: p.x - handleSize / 2,
                    top: p.y - handleSize / 2,
                    touchAction: "none",
                  }}
                  role="slider"
                  aria-label={`Corner ${i + 1}`}
                />
              ))}
            </div>
          </div>

          {/* Bottom bar */}
          <div className="flex items-center justify-between gap-3 border-t border-white/10 bg-black/60 px-4 py-3">
            <p className="text-xs text-white/60">Drag the corners onto the document edges.</p>
            <Button
              onClick={apply}
              disabled={busy}
              className="bg-white text-black hover:bg-white/90"
            >
              {busy ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Apply crop
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

async function loadBitmap(url: string): Promise<CanvasImageSource> {
  if (typeof createImageBitmap === "function") {
    const res = await fetch(url);
    const blob = await res.blob();
    return createImageBitmap(blob);
  }
  return await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/**
 * Compute the 8 coefficients of a 3x3 homography [a b c; d e f; g h 1]
 * mapping src[i] -> dst[i] via Gaussian elimination on an 8x8 system.
 */
function computeHomography(src: Pt[], dst: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  // Gaussian elimination
  const n = 8;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(A[k][i]) > Math.abs(A[pivot][i])) pivot = k;
    }
    if (pivot !== i) {
      [A[i], A[pivot]] = [A[pivot], A[i]];
      [b[i], b[pivot]] = [b[pivot], b[i]];
    }
    if (Math.abs(A[i][i]) < 1e-9) return null;
    for (let k = i + 1; k < n; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < n; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = b[i];
    for (let j = i + 1; j < n; j++) s -= A[i][j] * x[j];
    x[i] = s / A[i][i];
  }
  return x; // [a, b, c, d, e, f, g, h]
}
