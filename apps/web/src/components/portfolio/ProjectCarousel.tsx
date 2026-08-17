import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight, Images, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { readableTextOn } from "@/lib/contrast";
import type { PortfolioShowcaseCard } from "@/lib/portfolio.functions";

/**
 * The projects, at the size the photos deserve.
 *
 * Client feedback on the generated site: "There is a lot of white space. The
 * project showcases should be on a carousel or some sort of a fancy slide show.
 * Taking large portions of the page."
 *
 * They are right about the cause, not just the symptom. A 4:3 thumbnail in a
 * three-up grid gives a job-site photo about 380 pixels of a 1440 pixel screen,
 * and the rest of the fold is margin. The work is the only reason anyone opened
 * this page, so it gets the fold: one project at a time, edge to edge, with the
 * grid kept below for people who came to browse rather than be impressed.
 *
 * Autoplay stops the moment a visitor engages - pointer in, focus in, tab
 * hidden, or a reduced-motion preference - because a slide that moves while
 * someone is reading it is worse than no slideshow at all.
 */
export function ProjectCarousel({
  cards,
  portfolioSlug,
  accent,
}: {
  cards: PortfolioShowcaseCard[];
  portfolioSlug: string;
  accent: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const count = cards.length;

  // A filter can shrink the list under the current index, which would otherwise
  // leave the carousel pointing at a slide that no longer exists.
  useEffect(() => {
    setIndex((i) => (i < count ? i : 0));
  }, [count]);

  const go = useCallback(
    (delta: number) => {
      if (count === 0) return;
      setIndex((i) => (i + delta + count) % count);
    },
    [count],
  );

  useEffect(() => {
    if (paused || count < 2) return;
    if (typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), 6500);
    // A carousel advancing in a background tab burns through the whole set, so
    // the visitor comes back to slide nine of nine with no idea what they
    // missed.
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [paused, count]);

  const touchX = useRef<number | null>(null);

  if (count === 0) return null;
  const active = cards[Math.min(index, count - 1)];

  return (
    <div
      ref={root}
      role="region"
      aria-roledescription="carousel"
      aria-label="Finished projects"
      className="relative isolate overflow-hidden bg-neutral-950"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setPaused(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          e.preventDefault();
          go(1);
        } else if (e.key === "ArrowLeft") {
          e.preventDefault();
          go(-1);
        }
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start == null || end == null) return;
        if (Math.abs(end - start) > 48) go(end < start ? 1 : -1);
      }}
    >
      {/* Every slide stays mounted and cross-fades. Swapping the src instead
          would flash the alt box on each advance, which on a slow connection is
          most of what a visitor would see. */}
      <div className="relative h-[72vh] min-h-[460px] w-full sm:min-h-[540px] lg:h-[80vh]">
        {cards.map((card, i) => (
          <div
            key={card.slug}
            aria-hidden={i !== index}
            className={cn(
              "absolute inset-0 transition-opacity duration-700 ease-out",
              i === index ? "opacity-100" : "pointer-events-none opacity-0",
            )}
          >
            {card.cover_image_url ? (
              <img
                src={card.cover_image_url}
                alt=""
                loading={i === 0 ? "eager" : "lazy"}
                className={cn(
                  "h-full w-full object-cover transition-transform duration-[8000ms] ease-out",
                  i === index ? "scale-105" : "scale-100",
                )}
              />
            ) : (
              <div className="grid h-full w-full place-items-center bg-neutral-900 text-neutral-700">
                <Images className="h-10 w-10" />
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/55 to-neutral-950/15" />
          </div>
        ))}

        {/* Caption. Keyed on the slug so the copy re-animates in with the photo
            rather than the old title lingering over the new image. */}
        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-6 pb-10 lg:px-10 lg:pb-14">
            <div
              key={active.slug}
              className="animate-in fade-in slide-in-from-bottom-4 duration-500"
            >
              <div className="flex flex-wrap items-center gap-2">
                {active.service_type && (
                  <span
                    className="rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]"
                    style={{ backgroundColor: accent, color: readableTextOn(accent) }}
                  >
                    {active.service_type}
                  </span>
                )}
                {(active.city || active.state) && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
                    <MapPin className="h-3 w-3" />
                    {[active.city, active.state].filter(Boolean).join(", ")}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white/70">
                  <Images className="h-3 w-3" />
                  {active.photo_count} {active.photo_count === 1 ? "photo" : "photos"}
                </span>
              </div>

              <h3 className="font-portfolio-display mt-4 max-w-3xl text-balance text-4xl font-black uppercase leading-[0.92] tracking-[-0.01em] text-white sm:text-6xl lg:text-7xl">
                {active.title}
              </h3>
              {active.summary && (
                <p className="mt-4 max-w-xl text-pretty text-sm leading-relaxed text-white/75 lg:text-base">
                  {active.summary}
                </p>
              )}

              <Link
                to="/p/$slug/$showcaseSlug"
                params={{ slug: portfolioSlug, showcaseSlug: active.slug }}
                className="mt-6 inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-lg transition hover:opacity-90"
                style={{ backgroundColor: accent, color: readableTextOn(accent) }}
              >
                See this project <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        {count > 1 && (
          <>
            <Arrow side="left" onClick={() => go(-1)} />
            <Arrow side="right" onClick={() => go(1)} />
          </>
        )}
      </div>

      {/* Progress rail doubles as navigation. Segments rather than dots: with
          twenty projects a row of dots is unclickable confetti, and a segment
          still reads as "how much is left". */}
      {count > 1 && (
        <div className="mx-auto max-w-6xl px-6 pb-8 lg:px-10">
          <div className="flex items-center gap-4">
            <div className="flex min-w-0 flex-1 gap-1.5 overflow-hidden">
              {cards.slice(0, 12).map((card, i) => (
                <button
                  key={card.slug}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Show ${card.title}`}
                  aria-current={i === index}
                  className="group h-1 min-w-0 flex-1 rounded-full bg-white/20 transition hover:bg-white/40"
                >
                  <span
                    className={cn(
                      "block h-full rounded-full transition-all duration-500",
                      i === index ? "w-full" : "w-0",
                    )}
                    style={{ backgroundColor: accent }}
                  />
                </button>
              ))}
            </div>
            <p className="shrink-0 text-xs font-bold tabular-nums text-white/60">
              {String(index + 1).padStart(2, "0")}
              <span className="text-white/30"> / {String(count).padStart(2, "0")}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Arrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Previous project" : "Next project"}
      className={cn(
        "absolute top-1/2 z-10 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full",
        "border border-white/25 bg-black/25 text-white backdrop-blur-sm transition",
        "hover:bg-black/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
        side === "left" ? "left-3 lg:left-6" : "right-3 lg:right-6",
      )}
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}
