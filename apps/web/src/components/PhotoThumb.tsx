import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { cn } from "@/lib/utils";

/**
 * Resolved thumbnail URLs, keyed by `path@width`. Module-level so scrolling
 * back up, remounting a grid, or switching filters never re-signs a photo the
 * user has already seen.
 */
const cache = new Map<string, string>();
/** In-flight requests, so two visible tiles of the same photo share one call. */
const inflight = new Map<string, Promise<string | null>>();
/**
 * Set once transformation is proven unavailable (it needs a paid Supabase
 * plan). After that every tile skips straight to the original instead of
 * making a doomed request per photo.
 */
let transformUnavailable = false;

async function signThumb(path: string, width: number): Promise<string | null> {
  const key = `${path}@${width}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (transformUnavailable) return null;

  const existing = inflight.get(key);
  if (existing) return existing;

  const req = (async () => {
    try {
      const { data, error } = await supabase.storage
        .from("site-photos")
        .createSignedUrl(path, 60 * 60, {
          transform: { width, resize: "cover", quality: 75 },
        });
      if (error || !data?.signedUrl) {
        transformUnavailable = true;
        return null;
      }
      cache.set(key, data.signedUrl);
      return data.signedUrl;
    } catch {
      transformUnavailable = true;
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, req);
  return req;
}

interface Props {
  /** Storage path; the only thing that can be transformed. */
  storagePath: string | null | undefined;
  /** Full-size URL, used when transformation is unavailable or fails. */
  fallbackUrl?: string | null;
  /** Rendered width in CSS px; the request asks for 2x for retina. */
  width?: number;
  alt?: string;
  className?: string;
  /** Wrapper class — the observed element, so it must have real dimensions. */
  wrapperClassName?: string;
}

/**
 * A grid photo that downloads a thumbnail instead of the camera original.
 *
 * Why this is per-photo rather than batched: Supabase's batch
 * `createSignedUrls` does not accept `transform` — the singular call sends the
 * transform to the server, which signs it into the token, so a batch URL cannot
 * be rewritten client-side to add one. Signing every photo up front would be
 * hundreds of requests, so instead each tile signs itself only once it actually
 * scrolls into view. The cost is bounded by what the user looks at, not by how
 * many photos the collection holds.
 *
 * Nothing is rendered until the thumbnail resolves — deliberately. Showing the
 * original first would download the very megabytes this exists to avoid.
 *
 * This is a mitigation, not a substitute for real thumbnails generated at
 * upload time; it still costs one signing round trip per photo viewed.
 */
export function PhotoThumb({
  storagePath,
  fallbackUrl,
  width = 400,
  alt = "",
  className,
  wrapperClassName,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState<string | null>(() =>
    storagePath ? (cache.get(`${storagePath}@${width * 2}`) ?? null) : null,
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
    if (!visible || url || !storagePath) return;
    let cancelled = false;
    void signThumb(storagePath, width * 2).then((signed) => {
      if (!cancelled) setUrl(signed ?? fallbackUrl ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [visible, url, storagePath, width, fallbackUrl]);

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
