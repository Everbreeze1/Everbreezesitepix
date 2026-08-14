import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Images, MapPin, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { readableTextOn } from "@/lib/contrast";
import type { PortfolioShowcaseCard } from "@/lib/portfolio.functions";

/**
 * One project in the portfolio grid.
 *
 * The whole tile is a single anchor rather than a div with an onClick, so
 * middle-click, "open in new tab" and keyboard focus all behave like the links
 * they look like - the same reasoning as the stretched link on the in-app
 * showcase cards.
 *
 * `href` mode exists for the gallery embed, which renders inside an iframe on
 * someone else's domain and therefore cannot use the router.
 */
export function ShowcaseCard({
  card,
  portfolioSlug,
  accent,
  hrefBase,
  target,
}: {
  card: PortfolioShowcaseCard;
  portfolioSlug?: string;
  accent: string;
  /** When set, renders a plain <a> to `${hrefBase}/${card.slug}` (embeds). */
  hrefBase?: string;
  target?: "_blank";
}) {
  const location = [card.city, card.state].filter(Boolean).join(", ");

  const body = (
    <>
      <div className="relative aspect-[4/3] overflow-hidden bg-neutral-100">
        {card.cover_image_url ? (
          <img
            src={card.cover_image_url}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="grid h-full place-items-center text-neutral-300">
            <Images className="h-8 w-8" />
          </div>
        )}

        {/* Bottom-anchored scrim so the meta row stays legible on light photos
            without dimming the whole image the way a flat overlay would. */}
        <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />

        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          {card.service_type ? (
            <span
              className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] shadow-sm"
              style={{ backgroundColor: accent, color: readableTextOn(accent) }}
            >
              {card.service_type}
            </span>
          ) : (
            <span />
          )}
          {/* `featured` stopped controlling grid order once the owner could drag
              the order themselves - it survives as this badge, which is the
              part customers actually see. */}
          {card.featured && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-neutral-900 shadow-sm">
              <Star className="h-3 w-3 fill-current" />
              Featured
            </span>
          )}
        </div>

        <div className="absolute inset-x-3 bottom-3 flex items-end justify-between gap-2 text-white">
          {location ? (
            <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{location}</span>
            </span>
          ) : (
            <span />
          )}
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-white/80">
            <Images className="h-3 w-3" />
            {card.photo_count}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-5">
        <h3 className="text-balance text-lg font-extrabold leading-snug tracking-tight text-neutral-900">
          {card.title}
        </h3>
        {card.summary && (
          <p className="mt-2 line-clamp-2 text-pretty text-sm leading-relaxed text-neutral-500">
            {card.summary}
          </p>
        )}
        <span
          className="mt-4 inline-flex items-center gap-1 text-xs font-bold uppercase tracking-[0.1em] transition-transform group-hover:translate-x-0.5"
          style={{ color: accent }}
        >
          View project <ArrowUpRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </>
  );

  const className = cn(
    "group flex flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white transition duration-300",
    "hover:-translate-y-1 hover:border-neutral-300 hover:shadow-[0_18px_40px_-18px_rgba(0,0,0,0.35)]",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
  );

  if (hrefBase) {
    return (
      <a
        href={`${hrefBase}/${card.slug}`}
        target={target}
        rel={target === "_blank" ? "noreferrer" : undefined}
        className={className}
      >
        {body}
      </a>
    );
  }

  return (
    <Link
      to="/p/$slug/$showcaseSlug"
      params={{ slug: portfolioSlug!, showcaseSlug: card.slug }}
      className={className}
    >
      {body}
    </Link>
  );
}
