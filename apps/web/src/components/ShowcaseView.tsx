import { Link } from "@tanstack/react-router";
import { Mail, MapPin, Phone } from "lucide-react";
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

const DEFAULT_ACCENT = "#2563eb";

/**
 * The showcase itself — a marketing brochure for the company's work, not a
 * document. Shared by the public share page (routes/share.showcases.$token.tsx)
 * and the builder's live preview so what the user edits is exactly what a
 * prospect sees. Never fork these two call sites.
 *
 * Rich text goes through <RichText>, which parses a small known tag subset into
 * React elements rather than injecting HTML — this page is served to anonymous
 * visitors, so dangerouslySetInnerHTML is deliberately avoided.
 */
export function ShowcaseView({
  showcase,
  company,
  footer = true,
}: {
  showcase: ShowcaseViewData;
  company?: ShowcaseViewCompany | null;
  footer?: boolean;
}) {
  const s = showcase;
  const accent = s.accent_color || DEFAULT_ACCENT;
  const hasContact =
    s.show_contact && !!company && !!(company.phone || company.address || company.email);
  const visibleSections = s.sections.filter(
    (sec) => sec.items.length > 0 || sec.title?.trim() || !richIsEmpty(sec.body_html),
  );

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      {/* Masthead — cover photo behind the company mark and headline. */}
      <header className="relative overflow-hidden">
        {s.cover_image_url ? (
          <>
            <img src={s.cover_image_url} alt="" className="h-[46vh] min-h-[320px] w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/20" />
          </>
        ) : (
          <div className="h-[34vh] min-h-[240px] w-full" style={{ backgroundColor: accent }} />
        )}

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-5xl px-6 pb-10">
            {(company?.logo_url || company?.name) && (
              <div className="mb-4 flex items-center gap-3">
                {company.logo_url && (
                  <img
                    src={company.logo_url}
                    alt=""
                    className="h-11 w-11 rounded-lg bg-white/90 object-cover p-0.5"
                  />
                )}
                {company.name && (
                  <span className="text-sm font-bold uppercase tracking-[0.14em] text-white/90">
                    {company.name}
                  </span>
                )}
              </div>
            )}
            <h1 className="max-w-3xl text-4xl font-extrabold leading-[1.05] tracking-tight text-white sm:text-5xl">
              {s.title || "Untitled showcase"}
            </h1>
            <div className="mt-4 h-1.5 w-16 rounded-full" style={{ backgroundColor: accent }} />
            {s.tagline && (
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/85 sm:text-lg">
                {s.tagline}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6">
        {!richIsEmpty(s.intro_html) && (
          <section className="border-b border-neutral-200 py-12">
            <RichText html={s.intro_html} className="mx-auto max-w-3xl text-lg [&_p]:text-lg" />
          </section>
        )}

        {visibleSections.length === 0 ? (
          <p className="py-20 text-center text-sm text-neutral-500">
            This showcase doesn't have any work in it yet.
          </p>
        ) : (
          visibleSections.map((section, i) => (
            <ShowcaseSection
              key={section.id}
              section={section}
              layout={s.layout}
              accent={accent}
              index={i}
            />
          ))
        )}

        {!richIsEmpty(s.outro_html) && (
          <section className="border-t border-neutral-200 py-12">
            <RichText html={s.outro_html} className="mx-auto max-w-3xl text-lg [&_p]:text-lg" />
          </section>
        )}
      </main>

      {hasContact && (
        <section className="mt-4" style={{ backgroundColor: accent }}>
          <div className="mx-auto max-w-5xl px-6 py-12 text-center text-white">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-white/70">
              Get in touch
            </p>
            {company?.name && (
              <p className="mt-2 text-2xl font-extrabold tracking-tight">{company.name}</p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm font-medium">
              {company?.phone && (
                <a href={`tel:${company.phone}`} className="inline-flex items-center gap-2 hover:underline">
                  <Phone className="h-4 w-4" /> {company.phone}
                </a>
              )}
              {company?.email && (
                <a
                  href={`mailto:${company.email}`}
                  className="inline-flex items-center gap-2 hover:underline"
                >
                  <Mail className="h-4 w-4" /> {company.email}
                </a>
              )}
              {company?.address && (
                <span className="inline-flex items-center gap-2">
                  <MapPin className="h-4 w-4" /> {company.address}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {footer && (
        <p className="py-8 text-center text-xs text-neutral-400">
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
}: {
  section: ShowcaseViewSection;
  layout: string;
  accent: string;
  index: number;
}) {
  const hasHeading = !!section.title?.trim() || !!section.project_name;
  const hasBody = !richIsEmpty(section.body_html);

  return (
    <section className={cn("py-12", index > 0 && "border-t border-neutral-200")}>
      {hasHeading && (
        <div className="mb-5">
          {section.project_name && (
            <p
              className="text-[11px] font-bold uppercase tracking-[0.18em]"
              style={{ color: accent }}
            >
              {section.project_name}
            </p>
          )}
          {section.title?.trim() && (
            <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-neutral-900 sm:text-3xl">
              {section.title}
            </h2>
          )}
        </div>
      )}

      {hasBody && <RichText html={section.body_html} className="mb-6 max-w-3xl" />}

      {section.items.length > 0 && <PhotoGallery items={section.items} layout={layout} />}
    </section>
  );
}

function PhotoGallery({ items, layout }: { items: ShowcaseViewItem[]; layout: string }) {
  // "featured" gives the section's first photo a full-width lead slot; the rest
  // fall back into the standard grid beneath it.
  if (layout === "featured" && items[0]) {
    return (
      <div className="space-y-4">
        <Figure item={items[0]} className="w-full" imgClassName="max-h-[520px] w-full object-cover" />
        {items.length > 1 && <GridOrMasonry items={items.slice(1)} layout="grid" />}
      </div>
    );
  }
  return <GridOrMasonry items={items} layout={layout} />;
}

function GridOrMasonry({ items, layout }: { items: ShowcaseViewItem[]; layout: string }) {
  const cls =
    layout === "masonry"
      ? "columns-1 gap-4 sm:columns-2 lg:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid"
      : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div className={cls}>
      {items.map((item) => (
        <Figure key={item.photo_id} item={item} />
      ))}
    </div>
  );
}

function Figure({
  item,
  className,
  imgClassName,
}: {
  item: ShowcaseViewItem;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <figure className={cn("overflow-hidden rounded-xl bg-neutral-100 shadow-sm", className)}>
      {item.image_url ? (
        <img
          src={item.image_url}
          alt={item.caption ?? ""}
          loading="lazy"
          className={cn("w-full object-cover", imgClassName)}
        />
      ) : (
        <div className="flex aspect-[4/3] items-center justify-center text-xs text-neutral-400">
          Photo unavailable
        </div>
      )}
      {item.caption && (
        <figcaption className="px-4 py-3 text-sm leading-relaxed text-neutral-700">
          {item.caption}
        </figcaption>
      )}
    </figure>
  );
}
