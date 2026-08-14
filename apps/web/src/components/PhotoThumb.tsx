import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { THUMBNAIL_MAX_DIM } from "@/lib/photo-thumbnails";
import { cn } from "@/lib/utils";

/**
 * Signed thumbnail URLs, keyed by object path. Module-level so scrolling back
 * up, remounting a grid, or switching filters never re-signs a photo the user
 * has already seen.
 */
const cache = new Map<string, string>();
/** In-flight requests, so two visible tiles of the same photo share one call. */
const inflight = new Map<string, Promise<string | null>>();

async function signStored(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return hit;

  const existing = inflight.get(path);
  if (existing) return existing;

  const req = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from("site-photos")
        .createSignedUrl(path, 60 * 60);
      if (error || !data?.signedUrl) return null;
      cache.set(path, data.signedUrl);
      return data.signedUrl;
    } catch {
      return null;
    } finally {
      inflight.delete(path);
    }
  })();
  inflight.set(path, req);
  return req;
}

interface Props {
  /** Original object path, used when no thumbnail is available. */
  storagePath: string | null | undefined;
  /**
   * `photos.thumb_path` when the caller has the row. Absent or null means the
   * photo predates stored thumbnails and reads the original.
   */
  thumbPath?: string | null;
  /** Already-signed full-size URL, preferred over re-signing the original. */
  fallbackUrl?: string | null;
  /**
   * Rendered width in CSS px. Decides whether the stored thumbnail is big
   * enough (it is compared at 2x for retina) - a lightbox asking for more than
   * the thumbnail holds gets the original instead of an upscaled blur.
   */
  width?: number;
  alt?: string;
  className?: string;
  /** Wrapper class - the observed element, so it must have real dimensions. */
  wrapperClassName?: string;
}

/**
 * A grid photo that downloads a stored thumbnail instead of the camera original.
 *
 * This used to ask Supabase to transform the original on the fly. That endpoint
 * is metered by *distinct origin image per billing cycle* - 100 on the Pro plan
 * - so the cost grew with how many different photos anyone looked at, and the
 * organization hit 170% of quota on roughly 12 MB of stored photos. Thumbnails
 * are now produced once at upload time (`lib/photo-thumbnails.ts`) and simply
 * signed here, which takes the meter off the read path completely.
 *
 * The other thing that buys: plain signing works in batch. The old per-tile
 * signing existed only because `createSignedUrls` rejects `transform`, so
 * callers that already hold a signed URL can now pass it as `fallbackUrl` and
 * this makes no request at all.
 */
export function PhotoThumb({
  storagePath,
  thumbPath,
  fallbackUrl,
  width = 400,
  alt = "",
  className,
  wrapperClassName,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Only worth reading the thumbnail if it holds enough pixels for this tile.
  const thumbFitsTile = width * 2 <= THUMBNAIL_MAX_DIM;
  const wanted = thumbFitsTile ? (thumbPath ?? null) : null;

  const [url, setUrl] = useState<string | null>(
    () => (wanted ? cache.get(wanted) : null) ?? fallbackUrl ?? null,
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (visible || !ref.current) return;
    const el = ref.current;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      // Start fetching slightly before the tile is on screen so it has usually
      // arrived by the time it is.
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    // A stored thumbnail is the cheapest read; otherwise take a signed URL the
    // caller already has, and only sign the original when there is nothing else.
    if (wanted) {
      let cancelled = false;
      void signStored(wanted).then((signed) => {
        if (!cancelled) setUrl(signed ?? fallbackUrl ?? null);
      });
      return () => {
        cancelled = true;
      };
    }
    if (fallbackUrl) {
      setUrl(fallbackUrl);
      return;
    }
    if (!storagePath) return;
    let cancelled = false;
    void signStored(storagePath).then((signed) => {
      if (!cancelled) setUrl(signed);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, wanted, fallbackUrl, storagePath]);

  return (
    <div ref={ref} className={cn("h-full w-full bg-muted", wrapperClassName)}>
      {url ? (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cn("h-full w-full object-cover", className)}
        />
      ) : (
        <div className="h-full w-full animate-pulse bg-muted" />
      )}
    </div>
  );
}
