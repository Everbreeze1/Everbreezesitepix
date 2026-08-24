import { useMemo, useState } from "react";
import { ArrowRight, Mail, MapPin, Phone, Quote, Star } from "lucide-react";
import { richIsEmpty } from "@everlumen/shared";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";
import { readableTextOn, withAlpha } from "@/lib/contrast";
import type {
  PortfolioReviewLink,
  PortfolioShowcaseCard,
  PublicPortfolioSite,
} from "@/lib/portfolio.functions";
import { DEFAULT_ACCENT, PortfolioChrome } from "./PortfolioChrome";
import { PortfolioMap } from "./PortfolioMap";
import { ProjectCarousel } from "./ProjectCarousel";
import { ShowcaseCard } from "./ShowcaseCard";

/**
 * The portfolio home page - the front door the brochure never had.
 *
 * Section order is a sales argument, not a layout preference: prove it (hero +
 * numbers), show it (the work, full-bleed), explain it (about), localise it
 * (map and areas), corroborate it (reviews), then ask (contact).
 *
 * Two things changed after the client saw the first generated site: "there is a
 * lot of white space", and the projects deserved a slideshow rather than a
 * thumbnail grid. Both are handled the same way - by giving the photos the fold
 * and taking the padding back off everything that isn't a photo. The vertical
 * rhythm here is deliberately tighter than a marketing template's, because a
 * contractor with four projects cannot fill a page built for forty.
 */
export function PortfolioHome({
  site,
  showcases,
  serviceTypes,
  locations,
  stats,
  reviewLinks,
}: {
  site: PublicPortfolioSite;
  showcases: PortfolioShowcaseCard[];
  serviceTypes: string[];
  locations: string[];
  stats: { projects: number; photos: number; areas: number };
  reviewLinks: PortfolioReviewLink[];
}) {
  const accent = site.accent_color || DEFAULT_ACCENT;
  const [filter, setFilter] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter ? showcases.filter((s) => s.service_type === filter) : showcases),
    [showcases, filter],
  );

  const name = site.business_name?.trim() || "Our work";
  const hasContact = !!(site.phone || site.email || site.address);
  const areas = site.service_areas.length ? site.service_areas : locations;
  const hasMap = site.show_map && showcases.some((s) => s.latitude != null && s.longitude != null);
  const hasReviews = site.show_reviews && (reviewLinks.length > 0 || site.google_rating != null);

  return (
    <PortfolioChrome site={site} isHome hasReviews={hasReviews}>
      <Hero site={site} accent={accent} name={name} stats={stats} />

      {site.services.length > 0 && <ServicesStrip services={site.services} accent={accent} />}

      {/* ---- Work ---- */}
      <section id="work" className="scroll-mt-24">
        <div className="mx-auto max-w-6xl px-6 pb-8 pt-14 lg:px-10 lg:pb-10 lg:pt-20">
          <SectionHeading
            eyebrow="Our work"
            title="Projects we've finished"
            accent={accent}
            trailing={
              showcases.length > 0 ? (
                <p className="text-sm text-neutral-400">
                  {visible.length} of {showcases.length}
                </p>
              ) : null
            }
          />

          {/* Filters only appear when they'd actually narrow anything - a lone
              chip labelled with the only service is noise. */}
          {serviceTypes.length > 1 && (
            <div className="mt-6 flex flex-wrap gap-2">
              <FilterChip active={filter === null} accent={accent} onClick={() => setFilter(null)}>
                All work
              </FilterChip>
              {serviceTypes.map((t) => (
                <FilterChip
                  key={t}
                  active={filter === t}
                  accent={accent}
                  onClick={() => setFilter(filter === t ? null : t)}
                >
                  {t}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        {visible.length === 0 ? (
          <p className="mx-auto max-w-6xl px-6 pb-16 text-center text-sm text-neutral-400 lg:px-10">
            {showcases.length === 0
              ? "New projects are on the way - check back soon."
              : "No projects in that category yet."}
          </p>
        ) : (
          <>
            {/* Full-bleed on purpose: the container that keeps text readable is
                exactly what was starving the photographs. */}
            <ProjectCarousel cards={visible} portfolioSlug={site.slug} accent={accent} />

            {/* The grid survives the carousel because they answer different
                questions. The slideshow is "look at this"; the grid is "show me
                everything and let me pick". Only worth drawing when there is
                more than the one project already on screen. */}
            {visible.length > 1 && (
              <div className="mx-auto max-w-6xl px-6 py-14 lg:px-10 lg:py-16">
                <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-neutral-400">
                  Every project
                </p>
                <div className="mt-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {visible.map((card) => (
                    <ShowcaseCard
                      key={card.slug}
                      card={card}
                      portfolioSlug={site.slug}
                      accent={accent}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* ---- About ---- */}
      {!richIsEmpty(site.about_html) && (
        <section id="about" className="scroll-mt-24 border-t border-neutral-100 bg-neutral-50">
          <div className="mx-auto max-w-3xl px-6 py-16 lg:px-10 lg:py-20">
            <SectionHeading eyebrow="About us" title={`Why ${name}`} accent={accent} />
            <RichText
              html={site.about_html}
              className="mt-6 text-pretty [&_p]:text-lg [&_p]:leading-[1.7] [&_p]:text-neutral-600 lg:[&_p]:text-xl"
            />
          </div>
        </section>
      )}

      {/* ---- Areas served ---- */}
      {(hasMap || areas.length > 0) && (
        <section id="areas" className="scroll-mt-24 border-t border-neutral-100">
          <div className="mx-auto max-w-6xl px-6 py-16 lg:px-10 lg:py-20">
            <SectionHeading
              eyebrow="Areas served"
              title="Work near you"
              accent={accent}
              subtitle="Every pin is a job we've completed and photographed on site."
            />
            {areas.length > 0 && (
              <div className="mt-6 flex flex-wrap gap-2">
                {areas.map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold"
                    style={{ backgroundColor: withAlpha(accent, 0.09), color: accent }}
                  >
                    <MapPin className="h-3.5 w-3.5" />
                    {a}
                  </span>
                ))}
              </div>
            )}
            {hasMap && (
              <div className="mt-8">
                <PortfolioMap showcases={showcases} accent={accent} linkBase={`/p/${site.slug}`} />
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- Reviews ---- */}
      {hasReviews && <Reviews site={site} accent={accent} reviewLinks={reviewLinks} />}

      {/* ---- Contact ---- */}
      {hasContact && (
        <section id="contact" className="scroll-mt-24" style={{ backgroundColor: accent }}>
          <div
            className="mx-auto max-w-4xl px-6 py-16 text-center lg:px-10 lg:py-24"
            style={{ color: readableTextOn(accent) }}
          >
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] opacity-70">
              Get in touch
            </p>
            <h2 className="font-portfolio-display mt-3 text-balance text-4xl font-black uppercase leading-[0.92] tracking-tight lg:text-7xl">
              {site.cta_label?.trim() || "Let's talk about your project"}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-base leading-relaxed opacity-80 lg:text-lg">
              Tell us what you need and we'll come take a look. Estimates are free.
            </p>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {site.phone && (
                <ContactButton href={`tel:${site.phone}`} accent={accent} primary>
                  <Phone className="h-4 w-4" /> {site.phone}
                </ContactButton>
              )}
              {site.email && (
                <ContactButton href={`mailto:${site.email}`} accent={accent}>
                  <Mail className="h-4 w-4" /> {site.email}
                </ContactButton>
              )}
              {site.cta_url?.trim() && (
                <ContactButton href={site.cta_url} accent={accent} external>
                  Request an estimate <ArrowRight className="h-4 w-4" />
                </ContactButton>
              )}
            </div>

            {site.address && (
              <p className="mt-7 inline-flex items-center gap-2 text-sm opacity-75">
                <MapPin className="h-4 w-4" /> {site.address}
              </p>
            )}
          </div>
        </section>
      )}
    </PortfolioChrome>
  );
}

function Hero({
  site,
  accent,
  name,
  stats,
}: {
  site: PublicPortfolioSite;
  accent: string;
  name: string;
  stats: { projects: number; photos: number; areas: number };
}) {
  const headline = site.hero_headline?.trim() || `${name}`;
  return (
    <section className="relative isolate">
      {/* The header sits transparent over this, so the hero starts at the very
          top of the viewport and the nav floats on the photo. -mt-16/-mt-20
          cancels the sticky header's height rather than adding padding to it,
          which would leave a white band above the image. */}
      <div className="relative -mt-16 lg:-mt-20">
        {site.hero_image_url ? (
          <>
            <img
              src={site.hero_image_url}
              alt=""
              className="h-[82vh] min-h-[520px] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/35" />
          </>
        ) : (
          <div className="h-[62vh] min-h-[440px] w-full" style={{ backgroundColor: accent }} />
        )}

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-6 pb-14 lg:px-10 lg:pb-20">
            {site.google_rating != null && (
              <GoogleRatingPill
                rating={site.google_rating}
                count={site.google_review_count}
                href={site.google_reviews_url}
                className="mb-5"
              />
            )}
            <h1 className="font-portfolio-display max-w-4xl text-balance text-5xl font-black uppercase leading-[0.9] tracking-[-0.01em] text-white sm:text-7xl lg:text-8xl">
              {headline}
            </h1>
            {site.hero_subhead && (
              <p className="mt-5 max-w-2xl text-pretty text-base leading-relaxed text-white/85 lg:text-xl">
                {site.hero_subhead}
              </p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <a
                href="#work"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold shadow-lg transition hover:opacity-90"
                style={{ backgroundColor: accent, color: readableTextOn(accent) }}
              >
                See our work <ArrowRight className="h-4 w-4" />
              </a>
              {(site.phone || site.cta_url) && (
                <a
                  href={site.cta_url?.trim() || `tel:${site.phone}`}
                  target={site.cta_url?.trim() ? "_blank" : undefined}
                  rel={site.cta_url?.trim() ? "noreferrer" : undefined}
                  className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/10 px-6 py-3 text-sm font-bold text-white backdrop-blur-sm transition hover:bg-white/20"
                >
                  {site.cta_url?.trim() ? (
                    "Get an estimate"
                  ) : (
                    <>
                      <Phone className="h-4 w-4" /> {site.phone}
                    </>
                  )}
                </a>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Proof strip. Real counts from real photos - the credibility argument
          CompanyCam makes with "11,000+ showcased projects", scaled to one
          contractor. Dark rather than white: it is the seam between the hero
          photo and the page, and a white band here is the single widest piece
          of empty the old layout had. Hidden entirely when there's nothing to
          boast about. */}
      {stats.projects > 0 && (
        <div className="bg-neutral-950">
          <dl className="mx-auto grid max-w-6xl grid-cols-3 divide-x divide-white/10 px-6 lg:px-10">
            <Stat
              value={stats.projects}
              label={stats.projects === 1 ? "Project" : "Projects"}
              accent={accent}
            />
            <Stat value={stats.photos} label="Site photos" accent={accent} />
            <Stat
              value={stats.areas}
              label={stats.areas === 1 ? "Area served" : "Areas served"}
              accent={accent}
            />
          </dl>
        </div>
      )}
    </section>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent: string }) {
  return (
    <div className="py-6 text-center lg:py-8">
      <dt className="sr-only">{label}</dt>
      <dd>
        <span
          className="font-portfolio-display block text-4xl font-black tabular-nums leading-none tracking-tight lg:text-6xl"
          style={{ color: accent }}
        >
          {value.toLocaleString()}
        </span>
        <span className="mt-2 block text-[11px] font-bold uppercase tracking-[0.16em] text-white/45">
          {label}
        </span>
      </dd>
    </div>
  );
}

function ServicesStrip({ services, accent }: { services: string[]; accent: string }) {
  return (
    <section className="border-b border-neutral-100">
      <div className="mx-auto max-w-6xl px-6 py-8 lg:px-10 lg:py-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-neutral-400">
          What we do
        </p>
        <div className="mt-3 flex flex-wrap gap-x-8 gap-y-2">
          {services.map((s) => (
            <span
              key={s}
              className="font-portfolio-display inline-flex items-center gap-2.5 text-2xl font-extrabold uppercase tracking-tight text-neutral-800 lg:text-3xl"
            >
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: accent }}
              />
              {s}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * The reviews band.
 *
 * The client's note was blunt: "there is no google reviews link. No review link
 * to allow users to see their reviews on google if they have any." There was a
 * row of grey pills here, drawn only when someone had gone and filled in a
 * Settings page they had never been sent to - so in practice, nothing.
 *
 * Now the star rating is the headline, because a 4.9 from 180 people is the
 * strongest single claim on the whole page and it was being rendered as a link
 * label. Dark, so it reads as a full stop between the work and the ask.
 */
function Reviews({
  site,
  accent,
  reviewLinks,
}: {
  site: PublicPortfolioSite;
  accent: string;
  reviewLinks: PortfolioReviewLink[];
}) {
  const rating = site.google_rating;
  // The Google entry is promoted into the rating card, so repeating it in the
  // "other places" row would show the same link twice.
  const others = reviewLinks.filter((l) => l.platform !== "google" || !rating);

  return (
    <section id="reviews" className="scroll-mt-24 bg-neutral-950 text-white">
      <div className="mx-auto max-w-4xl px-6 py-16 text-center lg:px-10 lg:py-20">
        <Quote
          className="mx-auto h-7 w-7 opacity-20"
          style={{ color: accent }}
          aria-hidden="true"
        />
        <h2 className="font-portfolio-display mt-4 text-balance text-4xl font-black uppercase leading-[0.95] tracking-tight lg:text-6xl">
          Hear it from our customers
        </h2>

        {rating != null && (
          <div className="mt-8 inline-flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-8 py-6">
            <Stars rating={rating} />
            <p className="text-sm text-white/70">
              <span className="text-lg font-black text-white">{rating.toFixed(1)}</span> out of 5
              {site.google_review_count ? (
                <> from {site.google_review_count.toLocaleString()} Google reviews</>
              ) : (
                <> on Google</>
              )}
            </p>
            {site.google_reviews_url && (
              <a
                href={site.google_reviews_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-neutral-900 transition hover:bg-white/90"
              >
                Read our Google reviews <ArrowRight className="h-4 w-4" />
              </a>
            )}
          </div>
        )}

        {others.length > 0 && (
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {others.map((link, i) => (
              <a
                key={`${link.url}-${i}`}
                href={link.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-5 py-2.5 text-sm font-bold text-white/90 transition hover:border-white/60 hover:text-white"
              >
                <Star className="h-4 w-4" style={{ color: accent }} />
                {link.label?.trim() || `Reviews on ${platformLabel(link.platform)}`}
              </a>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Five stars with the fractional one clipped, rather than rounded away. */
function Stars({ rating }: { rating: number }) {
  const percent = Math.max(0, Math.min(100, (rating / 5) * 100));
  return (
    <div className="relative inline-block" aria-hidden="true">
      <div className="flex gap-0.5 text-white/20">
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} className="h-6 w-6 fill-current" />
        ))}
      </div>
      <div className="absolute inset-0 overflow-hidden" style={{ width: `${percent}%` }}>
        <div className="flex gap-0.5 text-amber-400">
          {[0, 1, 2, 3, 4].map((i) => (
            <Star key={i} className="h-6 w-6 shrink-0 fill-current" />
          ))}
        </div>
      </div>
    </div>
  );
}

/** The rating, small enough to sit over the hero photo without competing. */
export function GoogleRatingPill({
  rating,
  count,
  href,
  className,
}: {
  rating: number;
  count: number | null;
  href: string | null;
  className?: string;
}) {
  const body = (
    <>
      <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
      <span className="font-black">{rating.toFixed(1)}</span>
      <span className="opacity-70">
        {count ? `${count.toLocaleString()} Google reviews` : "on Google"}
      </span>
    </>
  );
  const cls = cn(
    "inline-flex items-center gap-2 rounded-full border border-white/25 bg-black/30 px-4 py-2 text-xs font-bold text-white backdrop-blur-sm",
    href && "transition hover:border-white/60",
    className,
  );
  if (!href) return <span className={cls}>{body}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      {body}
    </a>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  accent,
  trailing,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  accent: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.24em]" style={{ color: accent }}>
          {eyebrow}
        </p>
        <h2 className="font-portfolio-display mt-2 text-balance text-4xl font-black uppercase leading-[0.95] tracking-[-0.01em] text-neutral-900 lg:text-6xl">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-3 max-w-xl text-pretty text-base leading-relaxed text-neutral-500">
            {subtitle}
          </p>
        )}
      </div>
      {trailing}
    </div>
  );
}

function FilterChip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean;
  accent: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full px-4 py-2 text-sm font-bold transition",
        !active && "border border-neutral-200 text-neutral-600 hover:border-neutral-400",
      )}
      style={active ? { backgroundColor: accent, color: readableTextOn(accent) } : undefined}
    >
      {children}
    </button>
  );
}

function ContactButton({
  href,
  accent,
  primary,
  external,
  children,
}: {
  href: string;
  accent: string;
  primary?: boolean;
  external?: boolean;
  children: React.ReactNode;
}) {
  const onAccent = readableTextOn(accent);
  return (
    <a
      href={href}
      target={external ? "_blank" : undefined}
      rel={external ? "noreferrer" : undefined}
      className={cn(
        "inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold transition",
        primary ? "shadow-lg hover:opacity-90" : "border hover:bg-white/10",
      )}
      style={
        primary
          ? { backgroundColor: onAccent, color: accent }
          : { borderColor: withAlpha(onAccent === "#ffffff" ? "#ffffff" : "#111111", 0.4) }
      }
    >
      {children}
    </a>
  );
}

function platformLabel(platform: string): string {
  if (platform === "google") return "Google";
  if (platform === "nicejob") return "NiceJob";
  return "our page";
}
