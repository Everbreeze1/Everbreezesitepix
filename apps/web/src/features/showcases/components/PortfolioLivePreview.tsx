import { useEffect, useRef } from "react";
import { Mail, MapPin, Phone, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { readableTextOn, withAlpha } from "@/lib/contrast";
import { DEFAULT_ACCENT, type Draft } from "@/features/showcases/site-draft";

type Focus = "hero" | "services" | "areas" | "about" | "reviews" | "contact" | "address";

/**
 * A living thumbnail of the public site, wired straight to the draft.
 *
 * This is the half of the redesign that answers "so the user feels like they
 * are building something fast". A form tells you what you typed; this shows you
 * what you made, and the block you are editing lights up and scrolls itself
 * into view as you move between steps. It is a likeness, not an iframe of the
 * real page: fidelity here costs more than it buys, and a preview that has to
 * fetch and re-render the whole site would lag behind every keystroke.
 */
export function PortfolioLivePreview({
  draft,
  heroPreview,
  focus,
  projectCount,
  googleRating,
  googleReviewCount,
  className,
}: {
  draft: Draft;
  heroPreview: string | null;
  focus?: Focus;
  /** Real project count, so the placeholder grid tells the truth. */
  projectCount?: number;
  /** From the connected Google listing, so the reviews band shows the real star. */
  googleRating?: number | null;
  googleReviewCount?: number | null;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement | null>(null);

  // Driving scrollTop by hand rather than scrollIntoView: the preview sits
  // inside a page that scrolls too, and scrollIntoView would happily drag the
  // whole wizard up to satisfy a 200px thumbnail.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !focus) return;
    const block = el.querySelector<HTMLElement>(`[data-preview-block="${focus}"]`);
    if (!block) {
      el.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    el.scrollTo({ top: Math.max(0, block.offsetTop - 8), behavior: "smooth" });
  }, [focus]);

  const accent = draft.accentColor || DEFAULT_ACCENT;
  const onAccent = readableTextOn(accent);
  const name = draft.businessName.trim() || "Your business";
  const headline = draft.heroHeadline.trim() || name;
  const about = plainText(draft.aboutHtml);
  const host = typeof window !== "undefined" ? window.location.host : "sitepix";
  const hasContact = !!(draft.phone.trim() || draft.email.trim() || draft.address.trim());
  const cards = Math.min(Math.max(projectCount ?? 0, 3), 6);

  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)}>
      {/* Browser chrome. The address bar is a field on the last step, so it is
          part of the preview rather than decoration. */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <div className="flex gap-1">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
          <span className="h-2 w-2 rounded-full bg-muted-foreground/30" />
        </div>
        <div
          className={cn(
            "min-w-0 flex-1 truncate rounded-full bg-background px-3 py-1 text-[10px] text-muted-foreground transition",
            focus === "address" && "ring-2 ring-primary",
          )}
        >
          {host}/p/{draft.slug || "your-site"}
        </div>
      </div>

      <div ref={scroller} className="relative h-[420px] overflow-y-auto bg-white xl:h-[520px]">
        {/* ---- Hero ---- */}
        <Block focus={focus} id="hero">
          <div className="relative">
            {heroPreview ? (
              <img src={heroPreview} alt="" className="h-40 w-full object-cover" />
            ) : (
              <div className="h-40 w-full" style={{ backgroundColor: accent }} />
            )}
            {heroPreview && (
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-black/25" />
            )}

            <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 py-2.5">
              {draft.logoUrl ? (
                <img src={draft.logoUrl} alt="" className="h-5 w-5 rounded object-contain" />
              ) : (
                <span className="grid h-5 w-5 place-items-center rounded bg-white/20 text-[9px] font-black text-white">
                  {name.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="truncate text-[10px] font-black uppercase tracking-wide text-white">
                {name}
              </span>
              <span className="ml-auto rounded-full bg-white/20 px-2 py-0.5 text-[8px] font-bold text-white">
                {draft.ctaLabel.trim() || draft.phone.trim() || "Contact"}
              </span>
            </div>

            <div className="absolute inset-x-0 bottom-0 px-3 pb-3">
              <p className="line-clamp-3 text-balance text-lg font-black uppercase leading-[0.95] tracking-tight text-white">
                {headline}
              </p>
              {draft.heroSubhead.trim() && (
                <p className="mt-1.5 line-clamp-2 text-[9px] leading-snug text-white/85">
                  {draft.heroSubhead}
                </p>
              )}
              <div className="mt-2.5 flex gap-1.5">
                <span
                  className="rounded-full px-2.5 py-1 text-[8px] font-bold"
                  style={{ backgroundColor: accent, color: onAccent }}
                >
                  See our work
                </span>
                {draft.phone.trim() && (
                  <span className="rounded-full border border-white/40 px-2.5 py-1 text-[8px] font-bold text-white">
                    {draft.phone}
                  </span>
                )}
              </div>
            </div>
          </div>
        </Block>

        {/* ---- What we do ---- */}
        {draft.services.length > 0 && (
          <Block focus={focus} id="services">
            <div className="border-b border-neutral-100 px-3 py-3">
              <p className="text-[8px] font-bold uppercase tracking-[0.2em] text-neutral-400">
                What we do
              </p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                {draft.services.slice(0, 6).map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 text-[11px] font-extrabold tracking-tight text-neutral-800"
                  >
                    <span
                      className="h-1 w-1 shrink-0 rounded-full"
                      style={{ backgroundColor: accent }}
                    />
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </Block>
        )}

        {/* ---- Work ---- */}
        <div className="border-b border-neutral-100 px-3 py-4">
          <p className="text-[8px] font-bold uppercase tracking-[0.24em]" style={{ color: accent }}>
            Our work
          </p>
          <p className="mt-1 text-sm font-black uppercase leading-tight tracking-tight text-neutral-900">
            Projects we&rsquo;ve finished
          </p>
          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            {Array.from({ length: cards }).map((_, i) => (
              <div key={i} className="aspect-[4/3] rounded bg-neutral-100" />
            ))}
          </div>
          {!projectCount && (
            <p className="mt-2 text-[9px] text-neutral-400">
              Your projects fill this grid from the Projects tab.
            </p>
          )}
        </div>

        {/* ---- About ---- */}
        {about && (
          <Block focus={focus} id="about">
            <div className="border-b border-neutral-100 bg-neutral-50 px-3 py-4">
              <p
                className="text-[8px] font-bold uppercase tracking-[0.24em]"
                style={{ color: accent }}
              >
                About us
              </p>
              <p className="mt-1 text-sm font-black uppercase leading-tight tracking-tight text-neutral-900">
                Why {name}
              </p>
              <p className="mt-1.5 line-clamp-4 text-[10px] leading-relaxed text-neutral-600">
                {about}
              </p>
            </div>
          </Block>
        )}

        {/* ---- Areas ---- */}
        {(draft.serviceAreas.length > 0 || draft.showMap) && (
          <Block focus={focus} id="areas">
            <div className="border-b border-neutral-100 px-3 py-4">
              <p
                className="text-[8px] font-bold uppercase tracking-[0.24em]"
                style={{ color: accent }}
              >
                Areas served
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {draft.serviceAreas.slice(0, 8).map((a) => (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold"
                    style={{ backgroundColor: withAlpha(accent, 0.09), color: accent }}
                  >
                    <MapPin className="h-2 w-2" />
                    {a}
                  </span>
                ))}
                {draft.serviceAreas.length === 0 && (
                  <span className="text-[9px] text-neutral-400">
                    Cities from your projects appear here.
                  </span>
                )}
              </div>
              {draft.showMap && (
                <div className="mt-2 grid h-16 place-items-center rounded bg-neutral-100 text-[9px] text-neutral-400">
                  Project map
                </div>
              )}
            </div>
          </Block>
        )}

        {/* ---- Reviews ---- */}
        {draft.showReviews && (
          <Block focus={focus} id="reviews">
            <div className="border-b border-neutral-100 bg-neutral-900 px-3 py-4 text-center">
              <p className="text-[8px] font-bold uppercase tracking-[0.24em] text-white/50">
                Reviews
              </p>
              {googleRating != null ? (
                <>
                  <p className="mt-1.5 inline-flex items-center gap-1 text-lg font-black leading-none tracking-tight text-white">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    {googleRating.toFixed(1)}
                  </p>
                  <p className="mt-1 text-[9px] text-white/60">
                    {googleReviewCount
                      ? `${googleReviewCount.toLocaleString()} Google reviews`
                      : "on Google"}
                  </p>
                </>
              ) : (
                <p className="mt-1.5 text-[9px] leading-snug text-white/60">
                  Connect Google and your star rating lands here.
                </p>
              )}
            </div>
          </Block>
        )}

        {/* ---- Contact ---- */}
        <Block focus={focus} id="contact">
          <div
            className="px-3 py-5 text-center"
            style={{ backgroundColor: accent, color: onAccent }}
          >
            <p className="text-[8px] font-bold uppercase tracking-[0.24em] opacity-70">
              Get in touch
            </p>
            <p className="mt-1.5 text-balance text-sm font-black uppercase leading-tight tracking-tight">
              {draft.ctaLabel.trim() || "Let's talk about your project"}
            </p>
            <div className="mt-2.5 flex flex-wrap justify-center gap-1.5">
              {draft.phone.trim() && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[9px] font-bold"
                  style={{ backgroundColor: onAccent, color: accent }}
                >
                  <Phone className="h-2.5 w-2.5" /> {draft.phone}
                </span>
              )}
              {draft.email.trim() && (
                <span className="inline-flex items-center gap-1 rounded-full border border-current px-2.5 py-1 text-[9px] font-bold opacity-90">
                  <Mail className="h-2.5 w-2.5" /> {draft.email}
                </span>
              )}
              {!hasContact && (
                <span className="text-[9px] opacity-75">
                  Add a phone or email on the next step.
                </span>
              )}
            </div>
            {draft.address.trim() && (
              <p className="mt-2 inline-flex items-center gap-1 text-[9px] opacity-75">
                <MapPin className="h-2.5 w-2.5" /> {draft.address}
              </p>
            )}
          </div>
        </Block>
      </div>
    </div>
  );
}

/** One highlightable band of the preview. */
function Block({ id, focus, children }: { id: Focus; focus?: Focus; children: React.ReactNode }) {
  return (
    <div
      data-preview-block={id}
      className={cn(
        "relative transition",
        focus === id && "z-10 rounded-lg ring-2 ring-primary ring-offset-1",
      )}
    >
      {children}
    </div>
  );
}

/** Rich text down to a sentence or two, for a thumbnail that can't lay out HTML. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}
