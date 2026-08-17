import ReactMarkdown from "react-markdown";
import { Check, ImageOff, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cleanCaption, cleanWalkthroughMarkdown } from "@sitepix/shared";
import { cn } from "@/lib/utils";

export interface WalkthroughPhotoStep {
  photo_id: string;
  offset_seconds: number;
  spoken_note: string | null;
  position: number;
  caption: string | null;
  taken_at: string | null;
  image_url: string;
}

const formatOffset = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${Math.max(0, seconds % 60)
    .toString()
    .padStart(2, "0")}`;

/**
 * Re-exported from @sitepix/shared, where it moved so the walkthrough PDF can
 * apply the identical reduction. It could not before: it ran its own extractor,
 * and the printed summary differed from the one approved on screen.
 */
export { cleanWalkthroughMarkdown };

export function estimateWalkthroughNote(
  transcript: string | null | undefined,
  startSeconds: number,
  endSeconds: number | null,
  durationSeconds: number,
  index: number = 0,
  total: number = 1,
) {
  const words = (transcript ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const totalCount = Math.max(1, total);
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : endSeconds && endSeconds > startSeconds
        ? endSeconds
        : 0;

  let startRatio: number;
  let endRatio: number;
  if (duration > 0 && Number.isFinite(startSeconds)) {
    const perPhoto = duration / totalCount;
    const windowStart = Math.max(0, startSeconds - Math.min(8, perPhoto / 2));
    const windowEnd = Math.min(
      duration,
      endSeconds && endSeconds > startSeconds ? endSeconds : startSeconds + Math.max(10, perPhoto),
    );
    startRatio = Math.min(0.95, Math.max(0, windowStart / duration));
    endRatio = Math.min(1, Math.max(startRatio + 0.02, windowEnd / duration));
  } else {
    const share = 1 / totalCount;
    startRatio = Math.min(0.95, index * share);
    endRatio = Math.min(1, (index + 1) * share);
  }
  const start = Math.min(words.length - 1, Math.floor(words.length * startRatio));
  const end = Math.min(words.length, Math.max(start + 6, Math.ceil(words.length * endRatio)));
  return words.slice(start, end).join(" ").trim() || null;
}

export function WalkthroughPhotoSteps({
  steps,
  variant = "recorded",
}: {
  steps: WalkthroughPhotoStep[];
  /**
   * "summary": no recording behind these photos, so there are no offsets to
   * show and no narration that could be missing. The default keeps the
   * recorded rendering byte-identical - this component is also the public
   * share page's gallery.
   */
  variant?: "recorded" | "summary";
}) {
  if (!steps.length) return null;
  const isSummary = variant === "summary";

  return (
    <section className="mb-8">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">
            {isSummary ? "Photos in this summary" : "Photo walkthrough"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isSummary
              ? "The photos this summary was written from."
              : "Narration mapped to the moment each photo was taken."}
          </p>
        </div>
        <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {steps.length} {steps.length === 1 ? "photo" : "photos"}
        </span>
      </div>
      {/* Photo and its note are fused into one card - image on top, note directly
          beneath with no gap - rather than a side-by-side layout that collapses
          into an unrelated-looking stack on narrow screens. The offset badge on
          the photo (not a "Photo N" label) is enough to place it in the walk. */}
      {/* items-start only for summaries. A recorded walkthrough gives every tile
          a note strip, so equal-height stretching lines their bottoms up. A
          summary's strip appears only when the photo has a real caption, and
          stretching then pads the caption-less tiles with a blank white band
          the reader reads as a missing image. */}
      <ol className={cn("grid gap-4 sm:grid-cols-2", isSummary && "items-start")}>
        {steps.map((step, idx) => {
          const note = step.spoken_note?.trim();
          const caption = cleanCaption(step.caption);
          return (
            <li
              key={`${step.photo_id}-${idx}`}
              className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {step.image_url ? (
                  <img
                    src={step.image_url}
                    alt={note || caption || "Walkthrough photo"}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 100vw, 50vw"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-6 w-6" />
                  </div>
                )}
                {/* Every summary link carries offset 0, so the badge would
                    stamp a meaningless "0:00" on each tile. */}
                {!isSummary && (
                  <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
                    {formatOffset(step.offset_seconds)}
                  </span>
                )}
              </div>

              {/* Nothing was spoken over a summary, so the "no narration"
                  apology would repeat under every single photo. Show the strip
                  only when it has something to say. */}
              {(!isSummary || caption) && (
                <div className="border-t border-amber-200 bg-amber-50 px-3.5 py-2.5 dark:border-amber-900/40 dark:bg-amber-950/30">
                  {note ? (
                    <p className="text-sm italic leading-relaxed text-foreground">
                      &ldquo;{note}&rdquo;
                    </p>
                  ) : isSummary ? null : (
                    <p className="text-sm italic leading-relaxed text-muted-foreground">
                      No narration captured near this photo.
                    </p>
                  )}
                  {caption && <p className="mt-1 text-xs text-muted-foreground">{caption}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function WalkthroughMarkdown({
  markdown,
  photoUrls,
  variant = "recorded",
}: {
  markdown: string;
  photoUrls: Record<string, string>;
  /** "summary": there was no narration to organize - see WalkthroughPhotoSteps. */
  variant?: "recorded" | "summary";
}) {
  const trimmed = (markdown ?? "").trim();
  if (!trimmed) return null;
  const isSummary = variant === "summary";
  return (
    <section className="mt-2">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Summary</h2>
          <p className="text-xs text-muted-foreground">
            {isSummary
              ? "AI notes drafted from the photos you picked."
              : "Organized notes from the walkthrough narration."}
          </p>
        </div>
      </div>
      {/*
        `wt-markdown` carries the real styling (see styles.css). The prose-*
        classes this used to rely on are a no-op - @tailwindcss/typography is
        not installed - so headings rendered at body size and bullets lost their
        markers, which Tailwind's preflight strips. Same fix, and same reason,
        as the explicit `.tiptap` rules.
      */}
      <div className="wt-markdown rounded-xl border border-border bg-muted/20 p-5">
        <ReactMarkdown
          components={{
            img: ({ src, alt }) => {
              const s = typeof src === "string" ? src : "";
              if (s.startsWith("photo:")) {
                const id = s.slice("photo:".length);
                const url = photoUrls[id];
                if (!url)
                  return (
                    <span className="my-3 flex h-32 items-center justify-center rounded border border-dashed border-border bg-muted text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </span>
                  );
                return (
                  <img
                    src={url}
                    alt={alt ?? ""}
                    loading="lazy"
                    decoding="async"
                    sizes="(max-width: 640px) 100vw, 720px"
                    className="h-auto w-full max-w-full rounded-lg border border-border bg-muted"
                  />
                );
              }
              return (
                <img
                  src={s}
                  alt={alt ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full max-w-full"
                />
              );
            },
            input: ({ type, checked, ...props }) =>
              type === "checkbox" ? (
                <input
                  type="checkbox"
                  defaultChecked={!!checked}
                  className="mr-2 align-middle"
                  {...props}
                />
              ) : (
                <input type={type} {...props} />
              ),
          }}
        >
          {trimmed}
        </ReactMarkdown>
      </div>
    </section>
  );
}

export function WalkthroughShareButtons({
  url,
  title,
  copied,
  onCopy,
}: {
  url: string;
  title: string;
  copied: boolean;
  onCopy: () => Promise<void> | void;
}) {
  if (!url) return null;

  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const handleShare = async () => {
    if (canNativeShare) {
      try {
        await navigator.share({ title, text: title, url });
        return;
      } catch {
        // fall through to copy
      }
    }
    await onCopy();
  };

  return (
    <Button type="button" size="sm" onClick={handleShare}>
      {copied ? (
        <Check className="mr-1.5 h-3.5 w-3.5" />
      ) : (
        <Share2 className="mr-1.5 h-3.5 w-3.5" />
      )}
      {copied ? "Copied" : "Share"}
    </Button>
  );
}
