import { useRef, useState } from "react";
import {
  Frame,
  UserRound,
  Home,
  ImageIcon,
  MessageSquare,
  Mail,
  Star,
  Wrench,
  ShieldCheck,
  PhoneCall,
  MapPin,
  ArrowUpRight,
  Pencil,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PortfolioSitePanel } from "@/features/showcases/components/PortfolioSitePanel";
import {
  type PortfolioDetail,
  type PortfolioShowcaseCard,
} from "@/lib/portfolio.functions";

/*
 * The Portfolio screen, drawn exactly as the Main-html reference
 * (public/Main-html/PortfolioContent.dc.html): a Sections rail on the left
 * (Hero / About / Services / Gallery / Testimonials / Contact) with a
 * Publish-changes action, and a browser-chrome preview of the public site on
 * the right.
 *
 * Unlike the reference (a static mockup), the preview is built from the
 * account's real portfolio - business name, hero copy, about, services,
 * service areas, contact details, Google rating, and the real showcase
 * projects that fill the gallery. Fields the product does not store (years in
 * business, licence number, individual testimonial quotes) are omitted or
 * drawn as a dash rather than invented.
 */

type SectionKey = "hero" | "about" | "services" | "gallery" | "testimonials" | "contact";

const SECTIONS: Array<{ key: SectionKey; label: string; Icon: typeof Frame }> = [
  { key: "hero", label: "Hero", Icon: Frame },
  { key: "about", label: "About", Icon: UserRound },
  { key: "services", label: "Services", Icon: Home },
  { key: "gallery", label: "Gallery", Icon: ImageIcon },
  { key: "testimonials", label: "Testimonials", Icon: MessageSquare },
  { key: "contact", label: "Contact", Icon: Mail },
];

const SERVICE_ICONS = [Wrench, ShieldCheck, Home];

/** Brand palette, matching the reference's public-site styling. */
const BRAND = {
  ink: "oklch(22% 0.03 250)",
  inkMuted: "oklch(46% 0.02 250)",
  gold: "oklch(72% 0.12 80)",
  goldInk: "oklch(40% 0.09 75)",
  tint: "oklch(96% 0.016 70)",
  line: "oklch(92% 0.008 75)",
  heroText: "oklch(84% 0.02 235)",
};

function BrandMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" fill={BRAND.ink} />
      <path
        d="M8 13.5 11 16.5 16.5 9.5"
        stroke={BRAND.gold}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <div
      className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em]"
      style={{ color: BRAND.goldInk }}
    >
      {children}
    </div>
  );
}

function plainText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\n\r]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function Stars({ rating }: { rating: number }) {
  return (
    <span className="inline-flex items-center gap-[2px]" style={{ color: BRAND.gold }}>
      {Array.from({ length: 5 }).map((_, i) => (
        <Star
          key={i}
          className={cn("h-3.5 w-3.5", i >= Math.round(rating) && "opacity-30")}
          fill="currentColor"
        />
      ))}
    </span>
  );
}

export function PortfolioLibraryContent({
  portfolio,
  serviceTypes,
  showcases,
  projectCount,
  canEdit,
  published,
  publishing,
  onPublish,
  onSaved,
}: {
  portfolio: PortfolioDetail;
  serviceTypes: string[];
  showcases: PortfolioShowcaseCard[];
  projectCount: number;
  canEdit: boolean;
  published: boolean;
  publishing: boolean;
  onPublish: (published: boolean) => void;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
}) {
  const [mode, setMode] = useState<"overview" | "edit">("overview");
  const [section, setSection] = useState<SectionKey>("hero");
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const focus = (key: SectionKey) => {
    setSection(key);
    const el = scrollerRef.current?.querySelector<HTMLElement>(
      `[data-preview-block="${key}"]`,
    );
    if (el && scrollerRef.current) {
      scrollerRef.current.scrollTo({ top: Math.max(0, el.offsetTop - 8), behavior: "smooth" });
    }
  };

  // The real section editor (same steps the guided build uses) stays one click
  // away from the rail, so nothing about editing the site is lost.
  if (mode === "edit") {
    return (
      <PortfolioSitePanel
        portfolio={portfolio}
        serviceTypes={serviceTypes}
        projectCount={projectCount}
        onSaved={onSaved}
      />
    );
  }

  const gallery = showcases.filter((s) => s.cover_image_url).slice(0, 8);
  const hasContact = !!(portfolio.phone || portfolio.email || portfolio.address);
  const showReviewsBand =
    portfolio.show_reviews && portfolio.google_rating != null;

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-stretch">
      {/* Left rail */}
      <aside className="flex shrink-0 flex-col rounded-xl border border-border bg-background p-6 lg:w-[300px]">
        <div className="text-[22px] font-bold tracking-[-0.01em] text-foreground">Portfolio</div>
        <div className="mb-5 mt-1 text-[12.5px] text-muted-foreground">
          The public page customers see. Editing here changes what&rsquo;s live at your link.
        </div>

        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-faint">
          Sections
        </div>
        <div className="flex flex-1 flex-col gap-1">
          {SECTIONS.map(({ key, label, Icon }) => {
            const active = section === key;
            return (
              <button
                key={key}
                onClick={() => focus(key)}
                className={cn(
                  "flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-[11px] text-[13px] transition-colors",
                  active
                    ? "bg-muted font-semibold text-foreground"
                    : "font-medium text-foreground/80 hover:bg-muted/50",
                )}
              >
                <Icon className="h-[15px] w-[15px]" />
                {label}
              </button>
            );
          })}
        </div>

        {canEdit && (
          <button
            onClick={() => setMode("edit")}
            className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-[12.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted/40"
          >
            <Pencil className="h-3.5 w-3.5" /> Edit site
          </button>
        )}

        {canEdit ? (
          <div
            onClick={() => onPublish(!published)}
            className={cn(
              "mt-2 flex cursor-pointer items-center justify-center gap-2 rounded-[9px] px-4 py-2.5 text-[13.5px] font-semibold transition-colors",
              published
                ? "border border-border bg-background text-muted-foreground hover:bg-muted/40"
                : "bg-primary text-primary-foreground hover:bg-primary/90",
            )}
          >
            {publishing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : published ? (
              <span className="inline-flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-status-active" />
                Live - unpublish
              </span>
            ) : (
              <>Publish changes</>
            )}
          </div>
        ) : (
          <div className="mt-2 rounded-[9px] bg-muted px-4 py-2.5 text-center text-[12.5px] font-semibold text-faint">
            {published ? "Published" : "Unpublished"}
          </div>
        )}
      </aside>

      {/* Right: browser chrome + public-site preview */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-border bg-card px-3.5 py-2.5">
          <div className="flex gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ background: "oklch(75% 0.13 25)" }} />
            <span className="h-2 w-2 rounded-full" style={{ background: "oklch(80% 0.13 90)" }} />
            <span className="h-2 w-2 rounded-full" style={{ background: "oklch(72% 0.12 150)" }} />
          </div>
          <div className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-muted-foreground">
            {typeof window !== "undefined" ? window.location.host : "everlumen"}/p/
            {portfolio.slug || "your-site"}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-border bg-white shadow-[0_12px_40px_rgba(20,16,10,0.12)]">
          <div ref={scrollerRef} className="max-h-[720px] overflow-y-auto">
            {/* Public site header */}
            <div
              className="flex items-center justify-between bg-white px-8 py-[18px]"
              style={{ borderBottom: `1px solid ${BRAND.line}` }}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {portfolio.logo_url ? (
                  <img
                    src={portfolio.logo_url}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : (
                  <BrandMark />
                )}
                <span
                  className="truncate font-serif text-[16.5px] font-semibold"
                  style={{ color: BRAND.ink }}
                >
                  {portfolio.business_name?.trim() || "Your business"}
                </span>
              </div>
              <div className="flex items-center gap-6">
                <div
                  className="hidden items-center gap-[22px] text-[11px] font-semibold uppercase tracking-[0.06em] md:flex"
                  style={{ color: BRAND.inkMuted }}
                >
                  <button onClick={() => focus("services")} className="cursor-pointer hover:text-black">
                    Services
                  </button>
                  <button onClick={() => focus("gallery")} className="cursor-pointer hover:text-black">
                    Gallery
                  </button>
                  <button
                    onClick={() => focus("testimonials")}
                    className="cursor-pointer hover:text-black"
                  >
                    Reviews
                  </button>
                  <button onClick={() => focus("contact")} className="cursor-pointer hover:text-black">
                    Contact
                  </button>
                </div>
                <a
                  href={portfolio.cta_url || "#"}
                  target={portfolio.cta_url ? "_blank" : undefined}
                  rel="noreferrer"
                  className="whitespace-nowrap rounded-full px-5 py-2 text-[11px] font-bold uppercase tracking-[0.05em] text-white"
                  style={{ background: BRAND.ink }}
                >
                  {portfolio.cta_label?.trim() || "Request quote"}
                </a>
              </div>
            </div>

            {/* Hero */}
            <div
              data-preview-block="hero"
              className="relative flex flex-col items-center px-10 pb-4 pt-16 text-center"
              style={{
                background:
                  "linear-gradient(155deg, oklch(20% 0.03 250) 0%, oklch(30% 0.06 235) 55%, oklch(24% 0.045 210) 100%)",
              }}
            >
              <div
                className="mb-4 text-[11px] font-bold uppercase tracking-[0.18em]"
                style={{ color: BRAND.gold }}
              >
                Licensed &middot; Insured
              </div>
              <h1
                className="max-w-[620px] font-serif text-[34px] font-semibold leading-[1.14] text-white lg:text-[40px]"
                style={{ letterSpacing: "-0.01em" }}
              >
                {portfolio.hero_headline?.trim() ||
                  portfolio.business_name?.trim() ||
                  "Your business"}
              </h1>
              {portfolio.hero_subhead && (
                <p
                  className="mt-4 max-w-[460px] text-[14px] leading-6"
                  style={{ color: BRAND.heroText }}
                >
                  {portfolio.hero_subhead}
                </p>
              )}
              <a
                href={portfolio.cta_url || "#"}
                target={portfolio.cta_url ? "_blank" : undefined}
                rel="noreferrer"
                className="mt-7 inline-flex items-center rounded-full px-[30px] py-3 text-[12px] font-bold uppercase tracking-[0.05em]"
                style={{ background: BRAND.gold, color: "oklch(20% 0.03 250)" }}
              >
                {portfolio.cta_label?.trim() || "Request a quote"}
              </a>

              {/* Real stats: projects + Google rating (years in business are not stored) */}
              {(projectCount > 0 || portfolio.google_rating != null) && (
                <div
                  className="mt-8 flex justify-center gap-10 border-t pt-5"
                  style={{ borderColor: "oklch(50% 0.03 235 / 0.35)" }}
                >
                  {projectCount > 0 && (
                    <div>
                      <div className="font-serif text-xl font-semibold text-white">
                        {projectCount}
                      </div>
                      <div
                        className="mt-1 text-[10px] uppercase tracking-[0.06em]"
                        style={{ color: "oklch(76% 0.02 235)" }}
                      >
                        Projects shown
                      </div>
                    </div>
                  )}
                  {portfolio.google_rating != null && (
                    <div>
                      <div className="font-serif text-xl font-semibold text-white">
                        {portfolio.google_rating.toFixed(1)}{" "}
                        <span style={{ color: BRAND.gold }}>&#9733;</span>
                      </div>
                      <div
                        className="mt-1 text-[10px] uppercase tracking-[0.06em]"
                        style={{ color: "oklch(76% 0.02 235)" }}
                      >
                        Average rating
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Hero image strip - real showcase covers */}
            {gallery.length > 0 && (
              <div
                className="grid grid-cols-2 gap-[2px] sm:grid-cols-4"
                style={{ background: "oklch(92% 0.008 75)" }}
              >
                {gallery.slice(0, 4).map((s) => (
                  <div key={s.id} className="relative aspect-[5/3] overflow-hidden">
                    <img
                      src={s.cover_image_url ?? undefined}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                    <div
                      className="absolute inset-0"
                      style={{
                        background: "linear-gradient(180deg, transparent 55%, rgba(15,15,20,0.45))",
                      }}
                    />
                    <div className="absolute bottom-2 left-2.5 text-[10px] font-semibold text-white">
                      {s.title}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* About */}
            <div data-preview-block="about" className="px-10 py-14" style={{ maxWidth: 760 }}>
              <Eyebrow>Our story</Eyebrow>
              <h2
                className="mb-4 font-serif text-[26px] font-semibold"
                style={{ color: BRAND.ink, letterSpacing: "-0.005em" }}
              >
                About {portfolio.business_name?.trim() || "your business"}
              </h2>
              <p className="text-[14px] leading-7" style={{ color: BRAND.inkMuted }}>
                {portfolio.about_html
                  ? plainText(portfolio.about_html)
                  : "Tell customers what your business does and why they should choose you."}
              </p>
              <div className="mt-7 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
                <div
                  className="rounded-[10px] border p-4"
                  style={{ borderColor: BRAND.line, borderTop: `2.5px solid ${BRAND.gold}` }}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: BRAND.inkMuted }}>
                    License
                  </div>
                  <div className="mt-1 font-serif text-base font-semibold" style={{ color: BRAND.ink }}>
                    {"\u2014"}
                  </div>
                </div>
                <div
                  className="rounded-[10px] border p-4"
                  style={{ borderColor: BRAND.line, borderTop: `2.5px solid ${BRAND.gold}` }}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: BRAND.inkMuted }}>
                    Service area
                  </div>
                  <div className="mt-1 font-serif text-base font-semibold" style={{ color: BRAND.ink }}>
                    {portfolio.service_areas?.length
                      ? portfolio.service_areas.join(", ")
                      : "\u2014"}
                  </div>
                </div>
                <div
                  className="rounded-[10px] border p-4"
                  style={{ borderColor: BRAND.line, borderTop: `2.5px solid ${BRAND.gold}` }}
                >
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.04em]" style={{ color: BRAND.inkMuted }}>
                    Projects shown
                  </div>
                  <div className="mt-1 font-serif text-base font-semibold" style={{ color: BRAND.ink }}>
                    {projectCount}
                  </div>
                </div>
              </div>
            </div>

            {/* Services */}
            <div data-preview-block="services" className="px-10 py-14" style={{ background: BRAND.tint }}>
              <Eyebrow>Capabilities</Eyebrow>
              <h2
                className="mb-7 font-serif text-[26px] font-semibold"
                style={{ color: BRAND.ink }}
              >
                What we do
              </h2>
              {portfolio.services?.length ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  {portfolio.services.slice(0, 3).map((service, i) => {
                    const Icon = SERVICE_ICONS[i % SERVICE_ICONS.length];
                    return (
                      <div
                        key={service}
                        className="rounded-xl bg-white p-6 shadow-[0_6px_20px_rgba(20,20,30,0.06)]"
                      >
                        <div
                          className="mb-3.5 flex h-[38px] w-[38px] items-center justify-center rounded-[10px]"
                          style={{ background: BRAND.ink }}
                        >
                          <Icon className="h-[18px] w-[18px]" style={{ color: BRAND.gold }} />
                        </div>
                        <div className="mb-2 font-serif text-[15.5px] font-semibold" style={{ color: BRAND.ink }}>
                          {service}
                        </div>
                        <div className="text-[12.5px] leading-6" style={{ color: BRAND.inkMuted }}>
                          Detailed scope and pricing on request.
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: BRAND.inkMuted }}>
                  Add services in the site editor to fill this section.
                </p>
              )}
            </div>

            {/* Gallery */}
            <div data-preview-block="gallery" className="px-10 py-14">
              <Eyebrow>Portfolio</Eyebrow>
              <h2 className="mb-7 font-serif text-[26px] font-semibold" style={{ color: BRAND.ink }}>
                Recent work
              </h2>
              {gallery.length ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {gallery.map((s) => (
                    <div key={s.id} className="relative aspect-[4/3] overflow-hidden rounded-xl">
                      <img
                        src={s.cover_image_url ?? undefined}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                      <div
                        className="absolute inset-0"
                        style={{
                          background: "linear-gradient(180deg, transparent 55%, rgba(15,15,20,0.45))",
                        }}
                      />
                      <div className="absolute bottom-2 left-2.5 text-[11px] font-semibold text-white">
                        {s.title}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: BRAND.inkMuted }}>
                  Published projects from your team will appear here.
                </p>
              )}
            </div>

            {/* Testimonials */}
            <div
              data-preview-block="testimonials"
              className="px-10 py-14"
              style={{ background: BRAND.tint }}
            >
              <Eyebrow>Testimonials</Eyebrow>
              <h2 className="mb-7 font-serif text-[26px] font-semibold" style={{ color: BRAND.ink }}>
                What customers say
              </h2>
              {showReviewsBand ? (
                <div className="max-w-[520px] rounded-xl bg-white p-7 shadow-[0_6px_20px_rgba(20,20,30,0.06)]">
                  <div className="mb-3">
                    <Stars rating={portfolio.google_rating ?? 0} />
                  </div>
                  <div className="text-[14px] font-semibold" style={{ color: BRAND.ink }}>
                    {portfolio.google_rating?.toFixed(1)} rating on Google
                  </div>
                  <div className="mt-1 text-[12.5px]" style={{ color: BRAND.inkMuted }}>
                    {portfolio.google_review_count ?? 0} reviews
                    {portfolio.google_reviews_url ? (
                      <a
                        href={portfolio.google_reviews_url}
                        target="_blank"
                        rel="noreferrer"
                        className="ml-2 inline-flex items-center gap-1 font-semibold"
                        style={{ color: BRAND.goldInk }}
                      >
                        Read them on Google <ArrowUpRight className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: BRAND.inkMuted }}>
                  Connect your Google listing to show live reviews here.
                </p>
              )}
            </div>

            {/* Contact */}
            <div data-preview-block="contact" className="grid gap-10 px-10 py-14 lg:grid-cols-2">
              <div className="max-w-[420px]">
                <Eyebrow>Contact</Eyebrow>
                <h2 className="mb-5 font-serif text-[26px] font-semibold" style={{ color: BRAND.ink }}>
                  Get in touch
                </h2>
                <div className="flex flex-col gap-2.5 text-[13px]">
                  {portfolio.phone && (
                    <div className="flex items-center gap-2.5" style={{ color: BRAND.ink }}>
                      <PhoneCall className="h-4 w-4 text-faint" /> {portfolio.phone}
                    </div>
                  )}
                  {portfolio.email && (
                    <div className="flex items-center gap-2.5" style={{ color: BRAND.inkMuted }}>
                      <Mail className="h-4 w-4 text-faint" /> {portfolio.email}
                    </div>
                  )}
                  {portfolio.address && (
                    <div className="flex items-center gap-2.5" style={{ color: BRAND.inkMuted }}>
                      <MapPin className="h-4 w-4 text-faint" /> {portfolio.address}
                    </div>
                  )}
                  {portfolio.service_areas?.length ? (
                    <div className="flex items-center gap-2.5" style={{ color: BRAND.inkMuted }}>
                      <Home className="h-4 w-4 text-faint" /> {portfolio.service_areas.join(", ")}
                    </div>
                  ) : null}
                </div>
                {!hasContact && (
                  <p className="mt-4 text-[12.5px]" style={{ color: BRAND.inkMuted }}>
                    Add your phone, email or address in the site editor to fill this section.
                  </p>
                )}

                {portfolio.show_map && (
                  <div
                    className="mt-6 h-[150px] overflow-hidden rounded-xl"
                    style={{
                      borderColor: BRAND.line,
                      border: `1px solid ${BRAND.line}`,
                      background:
                        "repeating-linear-gradient(0deg, oklch(93% 0.012 235), oklch(93% 0.012 235) 1px, oklch(97% 0.006 235) 1px, oklch(97% 0.006 235) 26px), repeating-linear-gradient(90deg, oklch(93% 0.012 235), oklch(93% 0.012 235) 1px, oklch(97% 0.006 235) 1px, oklch(97% 0.006 235) 26px)",
                    }}
                  >
                    <div className="flex h-full items-center justify-center">
                      <div
                        className="h-4 w-4 rotate-45"
                        style={{ background: BRAND.ink, borderRadius: "999px 999px 999px 0" }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3.5">
                <div>
                  <div
                    className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
                    style={{ color: BRAND.inkMuted }}
                  >
                    Name
                  </div>
                  <div
                    className="rounded-lg border px-3.5 py-2.5 text-[12.5px]"
                    style={{ borderColor: "oklch(88% 0.012 235)", color: BRAND.inkMuted, background: "#fff" }}
                  >
                    Jane Homeowner
                  </div>
                </div>
                <div>
                  <div
                    className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
                    style={{ color: BRAND.inkMuted }}
                  >
                    Phone
                  </div>
                  <div
                    className="rounded-lg border px-3.5 py-2.5 text-[12.5px]"
                    style={{ borderColor: "oklch(88% 0.012 235)", color: BRAND.inkMuted, background: "#fff" }}
                  >
                    (916) 555-0100
                  </div>
                </div>
                <div>
                  <div
                    className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
                    style={{ color: BRAND.inkMuted }}
                  >
                    Message
                  </div>
                  <div
                    className="min-h-[64px] rounded-lg border px-3.5 py-3 text-[12.5px]"
                    style={{ borderColor: "oklch(88% 0.012 235)", color: BRAND.inkMuted, background: "#fff" }}
                  >
                    Tell us what&rsquo;s going on&hellip;
                  </div>
                </div>
                <button
                  className="mt-1.5 self-start rounded-full px-6 py-3 text-[12px] font-bold uppercase tracking-[0.04em] text-white"
                  style={{ background: BRAND.ink }}
                >
                  Send message
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
