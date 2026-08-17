import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Mail, MapPin, Menu, Phone, Star, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { readableTextOn } from "@/lib/contrast";
import type { PublicPortfolioSite } from "@/lib/portfolio.functions";

export const DEFAULT_ACCENT = "#2563eb";

/**
 * The site shell: persistent header and footer wrapped around every portfolio
 * page.
 *
 * This component is the actual answer to "it looks like a report, it should be
 * a mini site". A document has a beginning and an end; a site has a masthead
 * that stays with you, a way to reach any room from any other room, and a
 * footer that repeats the important things. Nothing below is decorative - the
 * nav is what makes the project pages feel like part of something rather than
 * separate PDFs that happen to share a colour.
 *
 * Rendered on both the home page and each project page, so the two can never
 * drift into looking like different websites.
 */
export function PortfolioChrome({
  site,
  /** True on the site's home page: nav uses in-page anchors instead of links. */
  isHome,
  /**
   * Whether the home page draws a reviews section. Only the home page knows -
   * it owns the review links - so the nav row is opt-in rather than guessed,
   * and a link to an anchor that isn't on the page never gets rendered.
   */
  hasReviews,
  children,
}: {
  site: PublicPortfolioSite;
  isHome: boolean;
  hasReviews?: boolean;
  children: ReactNode;
}) {
  const accent = site.accent_color || DEFAULT_ACCENT;
  const base = `/p/${site.slug}`;
  const name = site.business_name?.trim() || "Our work";
  const showReviews = hasReviews ?? !!(site.show_reviews && site.google_reviews_url);

  const sections = [
    { id: "work", label: "Work", show: true },
    { id: "about", label: "About", show: !!site.about_html?.trim() },
    { id: "areas", label: "Areas served", show: site.service_areas.length > 0 || site.show_map },
    { id: "reviews", label: "Reviews", show: showReviews },
    { id: "contact", label: "Contact", show: !!(site.phone || site.email || site.address) },
  ].filter((s) => s.show);

  return (
    <div className="flex min-h-screen flex-col bg-white text-neutral-900 antialiased">
      <SiteHeader site={site} accent={accent} base={base} isHome={isHome} sections={sections} />
      <main className="flex-1">{children}</main>
      <SiteFooter site={site} accent={accent} base={base} name={name} />
    </div>
  );
}

function SiteHeader({
  site,
  accent,
  base,
  isHome,
  sections,
}: {
  site: PublicPortfolioSite;
  accent: string;
  base: string;
  isHome: boolean;
  sections: Array<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  // Transparent over the hero, solid once you scroll - the header has to be
  // legible over both a dark photo and white page body, and swapping at the
  // fold is cheaper than compositing a permanent scrim over the artwork.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Only the home page has anchor targets; from a project page the same label
  // has to navigate home first, or the link silently does nothing.
  const href = (id: string) => (isHome ? `#${id}` : `${base}#${id}`);
  const solid = scrolled || !isHome || open;
  const fg = solid ? "text-neutral-900" : "text-white";

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-colors duration-200",
        solid ? "border-b border-neutral-200/80 bg-white/90 backdrop-blur-md" : "bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-6 lg:h-20 lg:px-10">
        <Link
          to="/p/$slug"
          params={{ slug: site.slug }}
          className={cn("flex min-w-0 items-center gap-2.5", fg)}
        >
          {site.logo_url ? (
            <img
              src={site.logo_url}
              alt=""
              className={cn(
                "h-9 w-9 shrink-0 rounded-md object-cover",
                solid ? "" : "bg-white/95 p-0.5",
              )}
            />
          ) : (
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-sm font-black"
              style={{ backgroundColor: accent, color: readableTextOn(accent) }}
            >
              {(site.business_name?.trim() || "W").slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="font-portfolio-display truncate text-lg font-extrabold uppercase tracking-tight lg:text-xl">
            {site.business_name?.trim() || "Our work"}
          </span>
        </Link>

        <nav className="ml-auto hidden items-center gap-7 md:flex">
          {sections.map((s) => (
            <a
              key={s.id}
              href={href(s.id)}
              className={cn(
                "text-sm font-semibold transition-opacity hover:opacity-70",
                solid ? "text-neutral-600" : "text-white/90",
              )}
            >
              {s.label}
            </a>
          ))}
          <HeaderCta site={site} accent={accent} />
        </nav>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className={cn("ml-auto grid h-10 w-10 place-items-center rounded-lg md:hidden", fg)}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-neutral-200 bg-white px-6 pb-6 pt-2 md:hidden">
          <nav className="flex flex-col">
            {sections.map((s) => (
              <a
                key={s.id}
                href={href(s.id)}
                onClick={() => setOpen(false)}
                className="border-b border-neutral-100 py-3.5 text-base font-bold text-neutral-800"
              >
                {s.label}
              </a>
            ))}
          </nav>
          <div className="mt-5">
            <HeaderCta site={site} accent={accent} full />
          </div>
        </div>
      )}
    </header>
  );
}

/**
 * The single most valuable pixel on a contractor's site is the one that starts
 * a phone call, so an explicit CTA wins, then the phone number, and only then
 * do we fall back to email.
 */
function HeaderCta({
  site,
  accent,
  full,
}: {
  site: PublicPortfolioSite;
  accent: string;
  full?: boolean;
}) {
  const cls = cn(
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-bold shadow-sm transition hover:opacity-90",
    full && "w-full",
  );
  const style = { backgroundColor: accent, color: readableTextOn(accent) };

  if (site.cta_url?.trim()) {
    return (
      <a href={site.cta_url} target="_blank" rel="noreferrer" className={cls} style={style}>
        {site.cta_label?.trim() || "Get a free estimate"}
      </a>
    );
  }
  if (site.phone?.trim()) {
    return (
      <a href={`tel:${site.phone}`} className={cls} style={style}>
        <Phone className="h-3.5 w-3.5" />
        {site.cta_label?.trim() || site.phone}
      </a>
    );
  }
  if (site.email?.trim()) {
    return (
      <a href={`mailto:${site.email}`} className={cls} style={style}>
        <Mail className="h-3.5 w-3.5" />
        {site.cta_label?.trim() || "Email us"}
      </a>
    );
  }
  return null;
}

function SiteFooter({
  site,
  accent,
  base,
  name,
}: {
  site: PublicPortfolioSite;
  accent: string;
  base: string;
  name: string;
}) {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-neutral-200 bg-neutral-50">
      <div className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              {site.logo_url ? (
                <img src={site.logo_url} alt="" className="h-9 w-9 rounded-md object-cover" />
              ) : (
                <span
                  className="grid h-9 w-9 place-items-center rounded-md text-sm font-black"
                  style={{ backgroundColor: accent, color: readableTextOn(accent) }}
                >
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="font-portfolio-display text-xl font-extrabold uppercase tracking-tight">
                {name}
              </span>
            </div>

            {/*
              The hero sub-headline used to be repeated here, and the client
              caught it: they had written a job title into that field and found
              it presented as the company's strapline at the bottom of every
              page. It is copy written for one specific spot - big type over a
              photograph - and it does not survive being moved. The trades list
              is what a footer actually wants in that slot, and it is the only
              place on the page where it reads as a summary rather than a menu.
            */}
            {site.services.length > 0 && (
              <p className="mt-4 max-w-sm text-pretty text-sm leading-relaxed text-neutral-500">
                {site.services.join(" · ")}
              </p>
            )}

            {site.google_rating != null && (
              <a
                href={site.google_reviews_url ?? "#reviews"}
                target={site.google_reviews_url ? "_blank" : undefined}
                rel={site.google_reviews_url ? "noreferrer" : undefined}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-neutral-700 hover:text-neutral-950"
              >
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                {site.google_rating.toFixed(1)}
                <span className="font-semibold text-neutral-400">
                  {site.google_review_count
                    ? `(${site.google_review_count.toLocaleString()} Google reviews)`
                    : "on Google"}
                </span>
              </a>
            )}
          </div>

          {(site.phone || site.email || site.address) && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                Contact
              </p>
              <div className="mt-4 space-y-2.5 text-sm">
                {site.phone && (
                  <a
                    href={`tel:${site.phone}`}
                    className="flex items-center gap-2 font-semibold text-neutral-700 hover:text-neutral-950"
                  >
                    <Phone className="h-3.5 w-3.5 shrink-0 text-neutral-400" /> {site.phone}
                  </a>
                )}
                {site.email && (
                  <a
                    href={`mailto:${site.email}`}
                    className="flex items-center gap-2 break-all font-semibold text-neutral-700 hover:text-neutral-950"
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0 text-neutral-400" /> {site.email}
                  </a>
                )}
                {site.address && (
                  <p className="flex items-start gap-2 text-neutral-500">
                    <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-400" />
                    {site.address}
                  </p>
                )}
              </div>
            </div>
          )}

          {site.service_areas.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-400">
                Areas served
              </p>
              <p className="mt-4 text-sm leading-relaxed text-neutral-500">
                {site.service_areas.join(" · ")}
              </p>
            </div>
          )}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-neutral-200 pt-6">
          <p className="text-xs text-neutral-400">
            © {year} {name}
            {site.website_url?.trim() && (
              <>
                {" · "}
                <a
                  href={site.website_url}
                  target="_blank"
                  rel="noreferrer"
                  className="underline-offset-2 hover:underline"
                >
                  Main site
                </a>
              </>
            )}
          </p>
          <div className="flex items-center gap-4 text-xs text-neutral-400">
            <a href={base} className="underline-offset-2 hover:underline">
              All work
            </a>
            <Link to="/" className="underline-offset-2 hover:underline">
              Built with SitePix
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
