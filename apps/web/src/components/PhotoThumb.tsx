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

/**
 * Paths that have asked to be signed but whose request has not gone out yet,
 * and the resolvers waiting on them.
 */
const queued = new Map<string, Array<(url: string | null) => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * How many paths ride in one signing request. Comfortably under the URI budget
 * `lib/chunked-ids.ts` describes for the `.in()` filters elsewhere, and more
 * than a grid ever has on screen at once.
 */
const SIGN_BATCH_MAX = 100;

/**
 * A grid of tiles all mounts within the same frame, so collecting one tick's
 * worth of paths and signing them together turns N requests into one.
 */
async function flushSignQueue() {
  flushTimer = null;
  while (queued.size) {
    const batch = Array.from(queued.keys()).slice(0, SIGN_BATCH_MAX);
    const waiting = batch.map((path) => {
      const fns = queued.get(path) ?? [];
      queued.delete(path);
      return [path, fns] as const;
    });

    let signedByPath = new Map<string, string>();
    try {
      const { data, error } = await supabase.storage
        .from("site-photos")
        .createSignedUrls(batch, 60 * 60);
      // Index-aligned with the request, the way every other caller reads it.
      if (!error) {
        (data ?? []).forEach((row, i) => {
          if (row?.signedUrl) signedByPath.set(batch[i], row.signedUrl);
        });
      }
    } catch {
      signedByPath = new Map();
    }

    for (const [path, fns] of waiting) {
      const url = signedByPath.get(path) ?? null;
      if (url) cache.set(path, url);
      inflight.delete(path);
      fns.forEach((fn) => fn(url));
    }
  }
}

/**
 * Sign one stored object, batched with whatever else asks in the same tick.
 *
 * This used to be a `createSignedUrl` (singular) per tile. Each one is its own
 * round trip and the browser only runs about six per host at a time, so a
 * screenful of two dozen tiles queued into four waves and every tile sat on its
 * grey placeholder until its wave came up - the second or two of blank tiles on
 * first load. `SelectPhotosForPageDialog` and `loadPhotos` already batch through
 * `createSignedUrls` for the same reason; this is the last per-tile caller.
 */
function signStored(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit) return Promise.resolve(hit);

  const existing = inflight.get(path);
  if (existing) return existing;

  const req = new Promise<string | null>((resolve) => {
    const fns = queued.get(path);
    if (fns) fns.push(resolve);
    else queued.set(path, [resolve]);
  });
  inflight.set(path, req);
  if (!flushTimer) flushTimer = setTimeout(flushSignQueue, 0);
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
 * The other thing that buys: plain signing works in batch. Per-tile signing
 * existed only because `createSignedUrls` rejects `transform`, so tiles that
 * need signing now share one request per tick (see `signStored`), and callers
 * that already hold a signed URL can pass it as `fallbackUrl` and make no
 * request at all.
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

  /*
   * When a stored thumbnail is expected, wait for it. Do not open with
   * `fallbackUrl`.
   *
   * This used to read `cache.get(wanted) ?? fallbackUrl`, which looks like a
   * harmless head start and is the opposite. Callers pass the *full-size*
   * signed URL as `fallbackUrl` - the Gallery already has one for every photo
   * from its batch sign - so on a cold cache every tile on screen immediately
   * began downloading a multi-megabyte camera original, which is the one thing
   * this component exists to avoid. The thumbnail arrived a moment later and
   * swapped `src`, but the original was already in flight, and the tile sat on
   * its grey placeholder for a second or two while it came down. That is the
   * blank-tile pause on first load.
   *
   * The wait costs one batched signing round trip (see `signStored`) against a
   * download of the full original, and the effect below still falls back to
   * `fallbackUrl` if the thumbnail cannot be signed. A photo with no stored
   * thumbnail has nothing to wait for and opens on the fallback as before.
   */
  const [url, setUrl] = useState<string | null>(() =>
    wanted ? (cache.get(wanted) ?? null) : (fallbackUrl ?? null),
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
