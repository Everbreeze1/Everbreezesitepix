import { ImageOff, Play, Quote, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SummaryPhoto } from "@/lib/summaries.functions";

/**
 * The summary's photos, each carrying its own note.
 *
 * "each note sitting directly next to its matching photo, not narration and
 * photos in two separate lists like the current build."
 *
 * One list, and it is the only place photos appear on the page. The prose above
 * it is prose: the old composer appended a `## Photos` gallery to the markdown
 * as well, so every reader had to strip it back out before rendering, and any
 * that forgot showed the whole set twice.
 *
 * A note and a quote are different things and look different. `note` is what
 * was done in the shot and is always there; `spoken` is what the technician
 * actually said near that moment and is null when they said nothing, so a
 * silent walk produces visibly shorter cards rather than the same card with
 * different words in it.
 */

const fmtOffset = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${Math.floor(Math.max(0, seconds) % 60)
    .toString()
    .padStart(2, "0")}`;

export function SummaryPhotoNotes({
  photos,
  /** True when this summary came from a recording, so offsets mean something. */
  timed = false,
  /** Given when there is a player above to drive; omitted on the share page. */
  onSeek,
  className,
}: {
  photos: SummaryPhoto[];
  timed?: boolean;
  onSeek?: (seconds: number) => void;
  className?: string;
}) {
  if (!photos.length) return null;
  const narratedCount = photos.filter((p) => p.spoken).length;

  return (
    <section className={cn("mt-8", className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-xl font-semibold tracking-tight">Photos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {narratedCount > 0
              ? "Each photo with what was being done, and what was said on camera near it."
              : timed
                ? "Nobody spoke during this recording, so each photo is described from what was captured with it."
                : "The photos this summary was written from."}
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
          {photos.length} {photos.length === 1 ? "photo" : "photos"}
          {narratedCount > 0 ? ` · ${narratedCount} narrated` : ""}
        </span>
      </div>

      <ol className="grid gap-4 sm:grid-cols-2">
        {photos.map((photo, idx) => {
          // The caption only earns a line of its own when it says something the
          // note does not already say.
          const caption = photo.caption && photo.caption !== photo.note ? photo.caption : null;
          return (
            <li
              key={`${photo.photoId}-${idx}`}
              className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            >
              <div className="relative aspect-[4/3] bg-muted">
                {photo.imageUrl ? (
                  <img
                    src={photo.imageUrl}
                    alt={photo.note || caption || "Site photo"}
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
                {/* A summary written from photos has no timeline, so a badge
                    would stamp a meaningless 0:00 on every tile. */}
                {timed &&
                  (onSeek ? (
                    <button
                      type="button"
                      onClick={() => onSeek(photo.offsetSeconds)}
                      className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm transition hover:bg-black/85"
                    >
                      <Play className="h-2.5 w-2.5" />
                      {fmtOffset(photo.offsetSeconds)}
                    </button>
                  ) : (
                    <span className="absolute right-2 top-2 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
                      {fmtOffset(photo.offsetSeconds)}
                    </span>
                  ))}
              </div>

              <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                <div>
                  <p className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
                    <Sparkles className="h-3 w-3" strokeWidth={2.25} />
                    Note
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-foreground">
                    {photo.note?.trim() || (
                      <span className="text-muted-foreground">
                        Nothing was recorded against this photo.
                      </span>
                    )}
                  </p>
                </div>

                {/* Only when somebody actually spoke here. */}
                {photo.spoken && (
                  <figure className="rounded-xl border-l-2 border-amber-400 bg-amber-50/70 px-3 py-2 dark:bg-amber-950/25">
                    <figcaption className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      <Quote className="h-3 w-3" strokeWidth={2.25} />
                      Heard on camera
                    </figcaption>
                    <blockquote className="mt-1 text-[13px] italic leading-relaxed text-foreground">
                      &ldquo;{photo.spoken}&rdquo;
                    </blockquote>
                  </figure>
                )}

                {caption && (
                  <p className="mt-auto border-t border-border/60 pt-2 text-[11.5px] text-muted-foreground">
                    Caption: {caption}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
