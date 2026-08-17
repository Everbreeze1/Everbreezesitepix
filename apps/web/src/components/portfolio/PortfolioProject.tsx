import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, CalendarDays, MapPin, Package, Star, Wrench } from "lucide-react";
import { ShowcaseView } from "@/components/ShowcaseView";
import { cn } from "@/lib/utils";
import { readableTextOn, withAlpha } from "@/lib/contrast";
import type { PublicPortfolioShowcase } from "@/lib/portfolio.functions";
import { DEFAULT_ACCENT, PortfolioChrome } from "./PortfolioChrome";
import { ShowcaseCard } from "./ShowcaseCard";

/**
 * A single project inside the portfolio site.
 *
 * The body is the existing <ShowcaseView> untouched - the brochure layout was
 * never the problem, it just had nowhere to live. What is added around it is
 * everything that makes it a page *of a site* rather than a standalone
 * document: a way back to the grid, a spec strip, the neighbouring projects,
 * and more of the same kind of work.
 */
export function PortfolioProject({ data }: { data: PublicPortfolioShowcase }) {
  const site = data.site!;
  const s = data.showcase!;
  const accent = s.accent_color || site.accent_color || DEFAULT_ACCENT;
  const location = [s.city, s.state].filter(Boolean).join(", ");

  const meta = [
    s.service_type && { icon: Wrench, label: "Service", value: s.service_type },
    location && { icon: MapPin, label: "Location", value: location },
    s.completed_on && {
      icon: CalendarDays,
      label: "Completed",
      value: formatMonth(s.completed_on),
    },
    s.products_used.length > 0 && {
      icon: Package,
      label: s.products_used.length === 1 ? "Product used" : "Products used",
      value: s.products_used.join(", "),
    },
  ].filter(Boolean) as Array<{
    icon: typeof Wrench;
    label: string;
    value: string;
  }>;

  return (
    <PortfolioChrome site={site} isHome={false}>
      {/* Breadcrumb. The single element that stops a project page feeling like
          a dead end you can only leave with the back button. */}
      <div className="border-b border-neutral-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3.5 lg:px-10">
          <Link
            to="/p/$slug"
            params={{ slug: site.slug }}
            className="inline-flex items-center gap-1.5 text-sm font-bold text-neutral-500 transition hover:text-neutral-900"
          >
            <ArrowLeft className="h-4 w-4" /> All work
          </Link>
          {s.service_type && (
            <>
              <span className="text-neutral-300">/</span>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.12em]"
                style={{ backgroundColor: withAlpha(accent, 0.1), color: accent }}
              >
                {s.service_type}
              </span>
            </>
          )}
        </div>
      </div>

      <ShowcaseView
        showcase={{
          title: s.title,
          tagline: s.tagline ?? s.summary,
          layout: s.layout,
          intro_html: s.intro_html,
          outro_html: s.outro_html,
          accent_color: accent,
          show_contact: false,
          /*
            Always off here, whatever the showcase itself says.

            A showcase serves two audiences and the review CTA only works for
            one of them. Shared straight from a finished job it reaches the
            customer who just paid you, and "happy with the work?" is exactly
            right. Reached through the portfolio it is a prospect who has never
            hired you, and asking them to review work they didn't buy reads as
            a mistake - which it is. `showcases.show_reviews` defaults to true
            for the per-job case, so inheriting it here pointed a write-a-review
            button at every stranger browsing the site.

            Proof, not the ask, is what belongs on this page. That is the strip
            below.
          */
          show_reviews: false,
          cover_image_url: s.cover_image_url,
          sections: s.sections,
        }}
        company={{
          name: site.business_name,
          logo_url: site.logo_url,
          phone: site.phone,
          address: site.address,
          email: site.email,
        }}
        // The site chrome already owns the brand, the contact band and the
        // footer - letting the document render its own would show each of them
        // twice on the way down the page.
        brandInMasthead={false}
        footer={false}
        minHeight={false}
      />

      <ReviewProof site={site} accent={accent} reviewLinks={data.reviewLinks} />

      {meta.length > 0 && (
        <section className="border-t border-neutral-100 bg-neutral-50">
          <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
            <p
              className="text-[11px] font-bold uppercase tracking-[0.24em]"
              style={{ color: accent }}
            >
              Project details
            </p>
            <dl className="mt-6 grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
              {meta.map((m) => (
                <div key={m.label}>
                  <dt className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-neutral-400">
                    <m.icon className="h-3.5 w-3.5" /> {m.label}
                  </dt>
                  <dd className="mt-1.5 text-pretty text-base font-bold leading-snug text-neutral-800">
                    {m.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      )}

      {(data.prev || data.next) && (
        <nav aria-label="More projects" className="border-t border-neutral-100">
          <div className="mx-auto grid max-w-6xl gap-px sm:grid-cols-2">
            <NeighbourLink slug={site.slug} item={data.prev} direction="prev" accent={accent} />
            <NeighbourLink slug={site.slug} item={data.next} direction="next" accent={accent} />
          </div>
        </nav>
      )}

      {data.related.length > 0 && (
        <section className="border-t border-neutral-100 bg-neutral-50">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:px-10 lg:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-portfolio-display text-balance text-3xl font-black uppercase tracking-tight lg:text-5xl">
                More {s.service_type?.toLowerCase() ?? "work"}
              </h2>
              <Link
                to="/p/$slug"
                params={{ slug: site.slug }}
                className="inline-flex items-center gap-1.5 text-sm font-bold"
                style={{ color: accent }}
              >
                See all work <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {data.related.map((card) => (
                <ShowcaseCard
                  key={card.slug}
                  card={card}
                  portfolioSlug={site.slug}
                  accent={accent}
                />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Closing ask. Lives here rather than inside ShowcaseView so it sits
          after the related work - the last thing on the page is the phone
          number, not another project to get lost in. */}
      {(site.phone || site.email || site.cta_url) && (
        <section id="contact" className="scroll-mt-24" style={{ backgroundColor: accent }}>
          <div
            className="mx-auto max-w-3xl px-6 py-16 text-center lg:px-10 lg:py-20"
            style={{ color: readableTextOn(accent) }}
          >
            <h2 className="font-portfolio-display text-balance text-4xl font-black uppercase leading-[0.95] tracking-tight lg:text-6xl">
              {site.cta_label?.trim() || "Want something like this?"}
            </h2>
            <p className="mx-auto mt-4 max-w-lg text-pretty text-base leading-relaxed opacity-80">
              Get in touch and we'll come take a look. Estimates are free.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              {site.phone && (
                <a
                  href={`tel:${site.phone}`}
                  className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-lg transition hover:opacity-90"
                  style={{ backgroundColor: readableTextOn(accent), color: accent }}
                >
                  {site.phone}
                </a>
              )}
              {site.cta_url?.trim() && (
                <a
                  href={site.cta_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-bold transition hover:bg-white/10"
                  style={{ borderColor: withAlpha(readableTextOn(accent), 0.4) }}
                >
                  Request an estimate <ArrowRight className="h-4 w-4" />
                </a>
              )}
            </div>
          </div>
        </section>
      )}
    </PortfolioChrome>
  );
}

/**
 * Social proof on a project page: the rating, and a way to go read it.
 *
 * The prospect's version of the review section. They have just scrolled a whole
 * job in photographs and are deciding whether these people are real, so this
 * sits immediately after the work and immediately before the neighbouring
 * projects. It is one line rather than the home page's full band, because the
 * argument has already been made once and repeating it at that size would push
 * the next project below the fold.
 */
function ReviewProof({
  site,
  accent,
  reviewLinks,
}: {
  site: PublicPortfolioShowcase["site"];
  accent: string;
  reviewLinks: PublicPortfolioShowcase["reviewLinks"];
}) {
  if (!site?.show_reviews) return null;
  const rating = site.google_rating;
  const readUrl = site.google_reviews_url;
  // Without a rating to lead with, the only thing left is a link labelled with
  // a platform name, which is a weaker claim than the photographs above it.
  if (rating == null && reviewLinks.length === 0) return null;

  return (
    <section className="border-t border-neutral-100 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-6 py-8 text-center lg:px-10">
        {rating != null ? (
          <p className="inline-flex items-center gap-2 text-sm text-neutral-600">
            <span className="inline-flex gap-0.5 text-amber-400">
              {[0, 1, 2, 3, 4].map((i) => (
                <Star
                  key={i}
                  className={cn("h-4 w-4", i < Math.round(rating) ? "fill-current" : "opacity-25")}
                />
              ))}
            </span>
            <span className="font-black text-neutral-900">{rating.toFixed(1)}</span>
            {site.google_review_count ? (
              <>from {site.google_review_count.toLocaleString()} Google reviews</>
            ) : (
              <>on Google</>
            )}
          </p>
        ) : (
          <p className="text-sm text-neutral-600">See what our customers say.</p>
        )}

        <a
          href={readUrl ?? reviewLinks[0]?.url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-bold underline-offset-4 hover:underline"
          style={{ color: accent }}
        >
          Read our reviews <ArrowRight className="h-3.5 w-3.5" />
        </a>
      </div>
    </section>
  );
}

function NeighbourLink({
  slug,
  item,
  direction,
  accent,
}: {
  slug: string;
  item: { slug: string; title: string; cover_image_url: string | null } | null;
  direction: "prev" | "next";
  accent: string;
}) {
  // An empty cell keeps "next" hard-right when there is no previous project,
  // so the pair never collapses into a lone centred link.
  if (!item) return <div className="hidden bg-white sm:block" />;

  const isNext = direction === "next";
  return (
    <Link
      to="/p/$slug/$showcaseSlug"
      params={{ slug, showcaseSlug: item.slug }}
      className="group flex items-center gap-4 bg-white p-6 transition hover:bg-neutral-50 lg:p-8"
    >
      {!isNext &&
        (item.cover_image_url ? (
          <img
            src={item.cover_image_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg object-cover lg:h-20 lg:w-20"
          />
        ) : null)}
      <div className={isNext ? "ml-auto min-w-0 text-right" : "min-w-0"}>
        <span
          className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em]"
          style={{ color: accent }}
        >
          {!isNext && <ArrowLeft className="h-3.5 w-3.5" />}
          {isNext ? "Next project" : "Previous project"}
          {isNext && <ArrowRight className="h-3.5 w-3.5" />}
        </span>
        <p className="mt-1.5 truncate text-lg font-extrabold tracking-tight text-neutral-900 group-hover:underline lg:text-xl">
          {item.title}
        </p>
      </div>
      {isNext &&
        (item.cover_image_url ? (
          <img
            src={item.cover_image_url}
            alt=""
            className="h-16 w-16 shrink-0 rounded-lg object-cover lg:h-20 lg:w-20"
          />
        ) : null)}
    </Link>
  );
}

/** "2026-03-14" -> "March 2026". Day precision is noise on a portfolio. */
function formatMonth(iso: string): string {
  const [y, m] = iso.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
