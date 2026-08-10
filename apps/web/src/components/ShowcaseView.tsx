import { Link } from "@tanstack/react-router";
import { Mail, MapPin, Phone, Star } from "lucide-react";
import { richIsEmpty } from "@sitepix/shared";
import { RichText } from "@/components/RichText";
import { cn } from "@/lib/utils";

export interface ShowcaseViewItem {
  photo_id: string;
  caption: string | null;
  image_url: string;
}

export interface ShowcaseViewSection {
  id: string;
  project_name?: string | null;
  title: string | null;
  body_html: string | null;
  items: ShowcaseViewItem[];
}

export interface ShowcaseViewData {
  title: string;
  tagline: string | null;
  layout: string;
  intro_html: string | null;
  outro_html: string | null;
  accent_color: string | null;
  show_contact: boolean;
  show_reviews: boolean;
  cover_image_url: string | null;
  sections: ShowcaseViewSection[];
}

export interface ShowcaseViewCompany {
  name: string | null;
  logo_url: string | null;
  phone: string | null;
  address: string | null;
  email: string | null;
}

export interface ShowcaseReviewLink {
  url: string;
  label: string | null;
  platform: string;
}

const DEFAULT_ACCENT = "#2563eb";

/** Friendly name for a review platform, for the default button label. */
function platformLabel(platform: string): string {
  if (platform === "google") return "Google";
  if (platform === "nicejob") return "NiceJob";
  return "our page";
}

/**
 * The showcase itself — a marketing piece for the company's work.
 *
 * Design rule this follows throughout: borders and boxes read as a *document*,
 * whitespace and full-bleed photography read as *editorial*. So there is almost
 * no chrome here — photos sit directly on the page, type carries the hierarchy,
 * and the only strong colour is the company's own accent. That is the whole
 * difference between this and a report.
 *
 * Shared by the public share page (routes/share.showcases.$token.tsx), the
 * builder's live preview, and the portfolio site's project pages — so what the
 * user edits is exactly what a prospect sees. Never fork these call sites.
 *
 * Rich text goes through <RichText>, which parses a small known tag subset into
 * React elements rather than injecting HTML — this page is served to anonymous
 * visitors, so dangerouslySetInnerHTML is deliberately avoided.
 */
export function ShowcaseView({
  showcase,
  company,
  reviewLinks = [],
  footer = true,
  brandInMasthead = true,
  minHeight = true,
}: {
  showcase: ShowcaseViewData;
  company?: ShowcaseViewCompany | null;
  /** Team review links; rendered only when the showcase has the CTA enabled. */
  reviewLinks?: ShowcaseReviewLink[];
  footer?: boolean;
  /**
   * Logo + company name over the cover photo. Off inside the portfolio site,
   * where the sticky site header already carries the brand a few pixels above —
   * repeating it makes the masthead look like a duplicated banner.
   */
  brandInMasthead?: boolean;
  /** Off when embedded in a page that owns its own full-height layout. */
  minHeight?: boolean;
}) {
  const s = showcase;
  const accent = s.accent_color || DEFAULT_ACCENT;
  const showReviewCta = s.show_reviews && reviewLinks.length > 0;
  const hasContact =
    s.show_contact && !!company && !!(company.phone || company.address || company.email);
  const visibleSections = s.sections.filter(
    (sec) => sec.items.length > 0 || sec.title?.trim() || !richIsEmpty(sec.body_html),
  );

  return (
    <div className={cn("bg-white text-neutral-900 antialiased", minHeight && "min-h-screen")}>
      {/* Masthead. Full-bleed photography with the headline sitting on it —
          the single biggest lever on whether this reads as premium. */}
      <header className="relative isolate overflow-hidden">
        {s.cover_image_url ? (
          <>
            <img
              src={s.cover_image_url}
              alt=""
              className="h-[68vh] min-h-[420px] w-full object-cover"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-black/10" />
          </>
        ) : (
          <div className="h-[42vh] min-h-[300px] w-full" style={{ backgroundColor: accent }} />
        )}

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-6xl px-6 pb-12 lg:px-10 lg:pb-16">
            {brandInMasthead && (company?.logo_url || company?.name) && (
              <div className="mb-6 flex items-center gap-3">
                {company.logo_url && (
                  <img
                    src={company.logo_url}
                    alt=""
                    className="h-10 w-10 rounded-md bg-white/95 object-cover p-0.5"
                  />
                )}
                {company.name && (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/85">
                    {company.name}
                  </span>
                )}
              </div>
            )}
            <h1 className="font-display max-w-4xl text-balance text-5xl font-bold uppercase leading-[0.92] tracking-[-0.01em] text-white sm:text-7xl lg:text-8xl">
              {s.title || "Untitled project"}
            </h1>
            {s.tagline && (
              <p className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-white/80 lg:text-xl">
                {s.tagline}
              </p>
            )}
          </div>
        </div>
      </header>

      <main>
        {!richIsEmpty(s.intro_html) && (
          <section className="mx-auto max-w-3xl px-6 py-20 lg:px-10 lg:py-28">
            {/* Lead copy gets a genuinely larger measure and looser leading —
                magazine standfirst, not body text. */}
            <RichText
              html={s.intro_html}
              className="text-pretty [&_p]:text-xl [&_p]:leading-[1.7] [&_p]:text-neutral-700 lg:[&_p]:text-2xl"
            />
          </section>
        )}

        {visibleSections.length === 0 ? (
          <p className="py-28 text-center text-sm text-neutral-400">
            This project doesn&rsquo;t have any work in it yet.
          </p>
        ) : (
          visibleSections.map((section, i) => (
            <ShowcaseSection
              key={section.id}
              section={section}
              layout={s.layout}
              accent={accent}
              index={i}
              total={visibleSections.length}
            />
          ))
        )}

        {!richIsEmpty(s.outro_html) && (
          <section className="mx-auto max-w-3xl px-6 py-20 text-center lg:px-10 lg:py-28">
            <RichText
              html={s.outro_html}
              className="text-pretty [&_p]:text-xl [&_p]:leading-[1.7] [&_p]:text-neutral-700 lg:[&_p]:text-2xl"
            />
          </section>
        )}
        {/* The ask sits right after the work, while the customer is still
            looking at what they paid for — the whole reason review links
            belong on this page rather than in a follow-up email. */}
        {showReviewCta && (
          <section className="mx-auto max-w-3xl px-6 pb-20 text-center lg:px-10 lg:pb-28">
            <div className="rounded-2xl border border-neutral-200 px-8 py-12">
              <p
                className="text-[11px] font-semibold uppercase tracking-[0.24em]"
                style={{ color: accent }}
              >
                One small favour
              </p>
              <h2 className="font-display mt-3 text-balance text-3xl font-bold uppercase tracking-[-0.01em] text-neutral-900 lg:text-4xl">
                Happy with the work?
              </h2>
              <p className="mx-auto mt-3 max-w-md text-pretty text-base leading-relaxed text-neutral-600">
                A quick review makes a real difference to a small business. It takes about a minute.
              </p>
              <div className="mt-7 flex flex-wrap justify-center gap-3">
                {reviewLinks.map((link, i) => (
                  <a
                    key={`${link.url}-${i}`}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition hover:opacity-90"
                    style={{ backgroundColor: accent }}
                  >
                    <Star className="h-4 w-4" />
                    {link.label?.trim() || `Review us on ${platformLabel(link.platform)}`}
                  </a>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>

      {hasContact && (
        <section style={{ backgroundColor: accent }}>
          <div className="mx-auto max-w-6xl px-6 py-20 text-center text-white lg:px-10 lg:py-24">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/65">
              Get in touch
            </p>
            {company?.name && (
              <p className="font-display mt-4 text-balance text-4xl font-bold uppercase tracking-[-0.01em] lg:text-6xl">
                {company.name}
              </p>
            )}
            <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-x-10 gap-y-4 text-base font-medium">
              {company?.phone && (
                <a
                  href={`tel:${company.phone}`}
                  className="inline-flex items-center gap-2.5 border-b border-white/30 pb-0.5 transition hover:border-white"
                >
                  <Phone className="h-4 w-4 shrink-0" /> {company.phone}
                </a>
              )}
              {company?.email && (
                <a
                  href={`mailto:${company.email}`}
                  className="inline-flex items-center gap-2.5 border-b border-white/30 pb-0.5 transition hover:border-white"
                >
                  <Mail className="h-4 w-4 shrink-0" /> {company.email}
                </a>
              )}
              {company?.address && (
                <span className="inline-flex items-center gap-2.5 text-white/85">
                  <MapPin className="h-4 w-4 shrink-0" /> {company.address}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {footer && (
        <p className="py-10 text-center text-xs text-neutral-400">
          Built with{" "}
          <Link to="/" className="underline-offset-2 hover:underline">
            SitePix
          </Link>
        </p>
      )}
    </div>
  );
}

function ShowcaseSection({
  section,
  layout,
  accent,
  index,
  total,
}: {
  section: ShowcaseViewSection;
  layout: string;
  accent: string;
  index: number;
  total: number;
}) {
  const hasHeading = !!section.title?.trim() || !!section.project_name;
  const hasBody = !richIsEmpty(section.body_html);

  return (
    <section className="py-14 lg:py-20">
      {(hasHeading || hasBody) && (
        <div className="mx-auto max-w-6xl px-6 lg:px-10">
          {hasHeading && (
            <div className="flex items-baseline gap-4">
              {/* Numbered rail — a small magazine cue that costs nothing and
                  instantly reads as "designed" rather than "generated". */}
              {total > 1 && (
                <span
                  className="shrink-0 text-[11px] font-semibold tabular-nums tracking-[0.2em]"
                  style={{ color: accent }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              )}
              <div className="min-w-0">
                {section.project_name && (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-neutral-400">
                    {section.project_name}
                  </p>
                )}
                {section.title?.trim() && (
                  <h2 className="font-display mt-1.5 text-balance text-4xl font-bold uppercase tracking-[-0.01em] text-neutral-900 lg:text-6xl">
                    {section.title}
                  </h2>
                )}
              </div>
            </div>
          )}

          {hasBody && (
            <RichText
              html={section.body_html}
              className={cn(
                "mt-5 max-w-2xl text-pretty [&_p]:text-lg [&_p]:leading-[1.7] [&_p]:text-neutral-600",
                total > 1 && "lg:pl-10",
              )}
            />
          )}
        </div>
      )}

      {section.items.length > 0 && (
        <div className={cn(hasHeading || hasBody ? "mt-10 lg:mt-12" : "")}>
          <PhotoGallery items={section.items} layout={layout} />
        </div>
      )}
    </section>
  );
}

function PhotoGallery({ items, layout }: { items: ShowcaseViewItem[]; layout: string }) {
  // A single photo earns the full width of the page — cropping it into a
  // one-third grid cell is what made this feel like a report.
  if (items.length === 1) {
    return (
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <Figure item={items[0]} imgClassName="max-h-[78vh] w-full object-cover" />
      </div>
    );
  }

  // Exactly two reads as a comparison — before/after, or a detail pair. Tight
  // gap and equal heights so the eye moves between them rather than down.
  if (items.length === 2) {
    return (
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="grid gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <Figure
              key={item.photo_id}
              item={item}
              imgClassName="aspect-[4/5] w-full object-cover"
            />
          ))}
        </div>
      </div>
    );
  }

  if (layout === "masonry") {
    return (
      <div className="mx-auto max-w-6xl px-6 lg:px-10">
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {items.map((item) => (
            <Figure key={item.photo_id} item={item} />
          ))}
        </div>
      </div>
    );
  }

  // "featured" leads with one photo bled to the full viewport width — the most
  // dramatic move available and the clearest signal this is a designed page.
  if (layout === "featured") {
    const [lead, ...rest] = items;
    return (
      <div className="space-y-4">
        {/* Shorter than the masthead on purpose: a section lead should punctuate
            the scroll, not compete with the cover. */}
        <Figure item={lead} rounded={false} imgClassName="max-h-[70vh] w-full object-cover" />
        {rest.length > 0 && (
          <div className="mx-auto max-w-6xl px-6 pt-6 lg:px-10">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map((item) => (
                <Figure key={item.photo_id} item={item} />
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-6 lg:px-10">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Figure key={item.photo_id} item={item} />
        ))}
      </div>
    </div>
  );
}

function Figure({
  item,
  imgClassName,
  rounded = true,
}: {
  item: ShowcaseViewItem;
  imgClassName?: string;
  rounded?: boolean;
}) {
  return (
    <figure>
      <div className={cn("overflow-hidden bg-neutral-100", rounded && "rounded-lg")}>
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.caption ?? ""}
            loading="lazy"
            className={cn("w-full object-cover", imgClassName ?? "aspect-[4/3]")}
          />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center text-xs text-neutral-400">
            Photo unavailable
          </div>
        )}
      </div>
      {item.caption && (
        <figcaption className="mt-3 text-sm leading-relaxed text-neutral-500">
          {item.caption}
        </figcaption>
      )}
    </figure>
  );
}
