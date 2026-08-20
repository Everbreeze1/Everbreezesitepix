import { useRef } from "react";
import { ArrowLeft, Check, ImageOff, Images } from "lucide-react";
import { TagPill } from "@/features/photos/components/TagPill";
import type { Photo } from "../types";

export function PhotoCarousel({
  photos,
  photoSrc,
  onOpen,
  onViewAll,
  size = "md",
  showTags = false,
  selectedIds,
  onToggleSelect,
  selectMode = false,
}: {
  photos: Photo[];
  photoSrc: (p: Photo) => string;
  onOpen: (idx: number) => void;
  onViewAll: () => void;
  size?: "sm" | "md" | "lg";
  showTags?: boolean;
  selectedIds?: string[];
  onToggleSelect?: (id: string) => void;
  /**
   * The Select control in the Photos toolbar is on.
   *
   * Without this the carousel could only be told about selection AFTER a first
   * photo had been ticked, and the only way to tick one was to hover a tile -
   * so pressing Select in carousel view appeared to do nothing, and on a touch
   * screen there was no way in at all.
   */
  selectMode?: boolean;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollBy = (dir: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.85), behavior: "smooth" });
  };
  const recent = photos.slice(0, 24);
  const sizeCls = size === "sm" ? "h-36 sm:h-40" : size === "lg" ? "h-72 sm:h-80" : "h-52 sm:h-60";
  const selSet = new Set(selectedIds ?? []);
  const inSelectionMode = selectMode || selSet.size > 0;
  return (
    <div className="relative mt-4">
      <button
        type="button"
        aria-label="Scroll left"
        onClick={() => scrollBy(-1)}
        className="absolute left-1 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-md ring-1 ring-border hover:bg-background md:flex"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        aria-label="Scroll right"
        onClick={() => scrollBy(1)}
        className="absolute right-1 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 shadow-md ring-1 ring-border hover:bg-background md:flex"
      >
        <ArrowLeft className="h-4 w-4 rotate-180" />
      </button>
      <div
        ref={scrollerRef}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {recent.map((p, idx) => {
          const url = photoSrc(p);
          const tags = p.tags ?? [];
          const selected = selSet.has(p.id);
          const when = new Date(p.taken_at ?? p.created_at);
          const dateLabel = when.toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const timeLabel = when.toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          });
          return (
            <div
              key={p.id}
              className={`group relative aspect-[4/3] ${sizeCls} shrink-0 snap-start overflow-hidden rounded-xl border bg-muted shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${
                selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (inSelectionMode && onToggleSelect) onToggleSelect(p.id);
                  else onOpen(idx);
                }}
                className="absolute inset-0"
                aria-label={
                  inSelectionMode ? (selected ? "Deselect photo" : "Select photo") : "Open photo"
                }
              >
                {url ? (
                  <img
                    src={url}
                    alt={p.caption ?? ""}
                    className="h-full w-full object-cover transition group-hover:scale-105"
                    loading="lazy"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <ImageOff className="h-5 w-5" />
                  </div>
                )}
              </button>

              {onToggleSelect && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSelect(p.id);
                  }}
                  aria-label={selected ? "Deselect photo" : "Select photo"}
                  className={`absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md border-2 shadow-md transition ${
                    selected
                      ? "border-primary bg-primary text-primary-foreground opacity-100"
                      : `border-sidebar-foreground/90 bg-sidebar/30 text-transparent backdrop-blur-sm group-hover:opacity-100 ${
                          // Pinned open in select mode: hover never fires on touch.
                          inSelectionMode ? "opacity-100" : "opacity-0"
                        }`
                  }`}
                >
                  <Check className="h-4 w-4" />
                </button>
              )}

              {p.hidden && (
                <span className="pointer-events-none absolute right-2 top-2 z-10 rounded bg-sidebar/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground">
                  Hidden
                </span>
              )}

              {showTags && tags.length > 0 && (
                <div className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap gap-1 bg-gradient-to-b from-sidebar/60 to-transparent p-1.5 pl-11">
                  {tags.slice(0, 4).map((t) => (
                    <TagPill key={t} name={t} size="sm" />
                  ))}
                  {tags.length > 4 && (
                    <span className="rounded-full bg-sidebar/50 px-1.5 py-0.5 text-[10px] font-medium text-sidebar-foreground">
                      +{tags.length - 4}
                    </span>
                  )}
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 bg-gradient-to-t from-sidebar/70 via-sidebar/20 to-transparent p-2 text-[10px] font-medium text-sidebar-foreground">
                <span className="opacity-95 tabular-nums">
                  {dateLabel}, {timeLabel}
                </span>
                {p.phase && p.phase !== "untagged" && (
                  <span className="rounded bg-sidebar-foreground/20 px-1.5 py-px capitalize backdrop-blur-sm">
                    {p.phase}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {photos.length > recent.length && (
          <button
            type="button"
            onClick={onViewAll}
            className={`flex aspect-[4/3] ${sizeCls} shrink-0 snap-start flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card text-sm font-medium text-muted-foreground transition hover:border-primary hover:text-foreground`}
          >
            <Images className="h-6 w-6" />
            View all {photos.length}
          </button>
        )}
      </div>
    </div>
  );
}
