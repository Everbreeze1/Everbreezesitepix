import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, ImageOff } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WalkthroughPhotoStep } from "@/components/WalkthroughReport";

/**
 * The walkthrough recording, and the photos taken during it.
 *
 * "Instead we should have the video only and the screen shots taken ... we
 * don't need no out loud AI narration. That is only used to produce automatic
 * reports." So this is the plain footage with its own controls, sized to the
 * way it was shot, and a strip of the photos underneath. Tapping a photo jumps
 * the video to the moment it was taken. The AI's write-up lives on the Summary.
 */

const fmtOffset = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;

export function WalkthroughVideo({
  videoUrl,
  mimeType,
  durationSeconds,
  steps,
  className,
}: {
  videoUrl: string;
  mimeType: string | null;
  /** The recorded length, used to place photo markers before metadata loads. */
  durationSeconds: number;
  steps: WalkthroughPhotoStep[];
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSeconds || 0);
  /**
   * Width over height, once metadata loads. A phone walk is usually portrait:
   * stretching it to the card's width blows it up past the screen, so portrait
   * footage is sized by height instead and landscape by width.
   */
  const [aspect, setAspect] = useState<number | null>(null);

  useEffect(() => {
    setAspect(null);
    setCurrentTime(0);
    /*
     * A recording from a phone that turned mid-walk can change size as it
     * plays. Follow it so the frame never crops or stretches the picture.
     */
    const el = videoRef.current;
    if (!el) return;
    const onResize = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) setAspect(el.videoWidth / el.videoHeight);
    };
    el.addEventListener("resize", onResize);
    return () => el.removeEventListener("resize", onResize);
  }, [videoUrl]);

  const seek = useCallback((seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    setCurrentTime(Math.max(0, seconds));
    frameRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    void el.play().catch(() => {
      /* Autoplay refused after a seek is fine - the video still moved. */
    });
  }, []);

  const total = duration || durationSeconds || 0;
  const portrait = aspect !== null && aspect < 1;

  return (
    <section
      className={cn(
        "overflow-hidden rounded-3xl border border-border bg-card shadow-sm",
        className,
      )}
    >
      <div ref={frameRef} className="flex items-center justify-center bg-black">
        <video
          ref={videoRef}
          key={videoUrl}
          controls
          playsInline
          preload="metadata"
          className={cn(
            "block bg-black object-contain",
            portrait ? "h-[70vh] max-h-[70vh] w-auto max-w-full" : "aspect-video w-full",
          )}
          style={aspect && !portrait ? { aspectRatio: aspect } : undefined}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d) && d > 0) setDuration(d);
            const w = e.currentTarget.videoWidth;
            const h = e.currentTarget.videoHeight;
            if (w > 0 && h > 0) setAspect(w / h);
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        >
          {mimeType && <source src={videoUrl} type={mimeType} />}
          <source src={videoUrl} />
          Your browser cannot play this video.
        </video>
      </div>

      {steps.length > 0 && (
        <div className="border-t border-border/60 px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              <Camera className="h-3.5 w-3.5" />
              Photos from this walk · {steps.length}
            </p>
            <p className="text-[11px] text-muted-foreground">Tap a photo to jump to it</p>
          </div>

          {/* Where each photo sits on the recording, and where playback is now. */}
          {total > 0 && (
            <div className="relative mt-3 h-1.5 w-full rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary/70 transition-[width] duration-200"
                style={{ width: `${Math.min(100, (currentTime / total) * 100)}%` }}
              />
              {steps.map((step, i) => (
                <span
                  key={`${step.photo_id}-mark-${i}`}
                  aria-hidden
                  className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground/60"
                  style={{ left: `${Math.min(100, (step.offset_seconds / total) * 100)}%` }}
                />
              ))}
            </div>
          )}

          <ol className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {steps.map((step, i) => (
              <li key={`${step.photo_id}-${i}`} className="shrink-0">
                <button
                  type="button"
                  onClick={() => seek(step.offset_seconds)}
                  title={`Jump to ${fmtOffset(step.offset_seconds)}`}
                  className="group relative block h-24 w-32 overflow-hidden rounded-xl border border-border bg-muted transition hover:border-primary/60 sm:h-28 sm:w-40"
                >
                  {step.image_url ? (
                    <img
                      src={step.image_url}
                      alt={`Photo at ${fmtOffset(step.offset_seconds)}`}
                      loading="lazy"
                      decoding="async"
                      className="h-full w-full object-cover transition group-hover:scale-[1.04]"
                    />
                  ) : (
                    <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </span>
                  )}
                  <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 px-1.5 py-0.5 font-mono text-[10.5px] text-white">
                    {fmtOffset(step.offset_seconds)}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
