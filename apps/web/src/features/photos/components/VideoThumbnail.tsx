import { useEffect, useRef, useState } from "react";
import { PlayCircle, Loader2, Video as VideoIcon } from "lucide-react";

interface VideoThumbnailProps {
  /** Stable cache key (e.g. walkthrough id or video id). */
  cacheKey: string;
  /** Signed video URL. Can be null if not yet loaded. */
  videoUrl: string | null;
  /** Optional poster URL to use immediately while the real frame is captured. */
  fallbackPosterUrl?: string | null;
  /** ClassName applied to the outer wrapper. */
  className?: string;
  /** Show a play icon overlay. */
  showPlayOverlay?: boolean;
  /** Aspect ratio (defaults to video). */
  aspect?: "video" | "square";
  onClick?: () => void;
}

const CACHE_PREFIX = "sitepix:videothumb:v1:";
const SEEK_TO_SECONDS = 0.25;

function readCache(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(CACHE_PREFIX + key) ?? sessionStorage.getItem(CACHE_PREFIX + key);
  } catch {
    return null;
  }
}
function writeCache(key: string, dataUrl: string) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CACHE_PREFIX + key, dataUrl);
  } catch {
    // Quota exceeded — try sessionStorage as a soft fallback.
    try {
      sessionStorage.setItem(CACHE_PREFIX + key, dataUrl);
    } catch {}
  }
}

/**
 * Renders the first frame of a video as a cached thumbnail.
 * Pulls one frame off an off-screen `<video>` element, paints it to a canvas,
 * and stores the JPEG data URL in sessionStorage keyed by `cacheKey`.
 */
export function VideoThumbnail({
  cacheKey,
  videoUrl,
  fallbackPosterUrl,
  className,
  showPlayOverlay = true,
  aspect = "video",
  onClick,
}: VideoThumbnailProps) {
  const [thumb, setThumb] = useState<string | null>(() => readCache(cacheKey));
  const [loading, setLoading] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    // If we already have a cached thumb for this key, do nothing.
    const cached = readCache(cacheKey);
    if (cached) {
      setThumb(cached);
      return;
    }
    if (!videoUrl) return;

    setLoading(true);
    const v = document.createElement("video");
    v.crossOrigin = "anonymous";
    v.muted = true;
    v.playsInline = true;
    v.preload = "metadata";
    v.src = videoUrl;

    const cleanup = () => {
      v.removeAttribute("src");
      try {
        v.load();
      } catch {}
    };

    const capture = () => {
      try {
        const w = v.videoWidth || 640;
        const h = v.videoHeight || 360;
        if (!w || !h) {
          setLoading(false);
          cleanup();
          return;
        }
        const canvas = document.createElement("canvas");
        // Cap thumbnail size to keep sessionStorage payloads small.
        const MAX = 640;
        const scale = Math.min(1, MAX / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          setLoading(false);
          cleanup();
          return;
        }
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        if (!cancelledRef.current) {
          writeCache(cacheKey, dataUrl);
          setThumb(dataUrl);
        }
      } catch (e) {
        console.warn("Video thumbnail capture failed", e);
      } finally {
        setLoading(false);
        cleanup();
      }
    };

    const onLoadedMeta = () => {
      // Seek a hair past zero to avoid black first-frame on many encoders.
      try {
        v.currentTime = Math.min(SEEK_TO_SECONDS, Math.max(0, (v.duration || 1) - 0.05));
      } catch {
        capture();
      }
    };
    const onSeeked = () => capture();
    const onError = () => {
      setLoading(false);
      cleanup();
    };

    v.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
    v.addEventListener("seeked", onSeeked, { once: true });
    v.addEventListener("error", onError, { once: true });

    return () => {
      cancelledRef.current = true;
      v.removeEventListener("loadedmetadata", onLoadedMeta);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("error", onError);
      cleanup();
    };
  }, [cacheKey, videoUrl]);

  const aspectClass = aspect === "video" ? "aspect-video" : "aspect-square";
  const displaySrc = thumb ?? fallbackPosterUrl ?? null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative block w-full overflow-hidden bg-gradient-to-br from-primary/15 to-primary/5 text-primary ${aspectClass} ${onClick ? "cursor-pointer" : "cursor-default"} ${className ?? ""}`}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt=""
          className="h-full w-full object-cover transition group-hover:scale-[1.03]"
          loading="lazy"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <VideoIcon className="h-8 w-8" />
          )}
        </div>
      )}
      {showPlayOverlay && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-gradient-to-t from-black/55 via-black/10 to-transparent opacity-90 transition group-hover:opacity-100">
          <PlayCircle
            className="h-12 w-12 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.55)]"
            strokeWidth={1.5}
          />
        </div>
      )}
    </button>
  );
}
