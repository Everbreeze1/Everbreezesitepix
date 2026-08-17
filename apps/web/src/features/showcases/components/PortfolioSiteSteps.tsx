import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import {
  Building2,
  Check,
  ExternalLink,
  Hammer,
  ImagePlus,
  Link2,
  Loader2,
  MapPin,
  MessageSquareText,
  PhoneCall,
  Plus,
  Sparkles,
  Star,
  TriangleAlert,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { richIsEmpty } from "@sitepix/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/RichTextEditor";
import { cn } from "@/lib/utils";
import { listReviewLinks, setReviewLinks, type ReviewLink } from "@/lib/review-links.functions";
import type { PortfolioDetail } from "@/lib/portfolio.functions";
import type { Draft, PortfolioSiteDraft, SlugState } from "@/features/showcases/site-draft";
import { GoogleBusinessConnect } from "./GoogleBusinessConnect";
import { ShowcasePhotoPickerDialog } from "./ShowcasePhotoPickerDialog";
import { TagInput } from "./TagInput";

/**
 * The site editor, cut into one question per screen.
 *
 * The client's note on the old panel was that it "has very crowded page and
 * information scattered having to scroll down… too overwhelming to fill in all
 * details". Nineteen fields on one scroll is a form; the same nineteen fields
 * behind seven prompts is a build. So the fields live here as small, ordered
 * steps, and the two surfaces that show them - the guided wizard and the
 * section editor - are chrome around this list rather than copies of it.
 *
 * Order is the argument the site makes: who you are, what you do, the proof
 * photo, where you work, why you, how to reach you, and finally the address it
 * all lives at. Only the first three carry weight; the rest can be skipped and
 * finished later, because a site that goes live today beats a form abandoned
 * at field twelve.
 */

export interface StepCtx extends PortfolioSiteDraft {
  serviceTypes: string[];
  /**
   * The saved row, not the draft.
   *
   * The Google connection is the one thing on these screens that writes
   * straight to the row instead of through the draft - it has to, because the
   * server is the only side that ever sees Google's answers. So the steps that
   * show it need the persisted values and a way to report the write back up.
   */
  portfolio: PortfolioDetail;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
  /**
   * Which surface is drawing the fields.
   *
   * Only the cover step reads it, and only to decide one thing: the wizard has
   * a wide column and a hard requirement that Continue stay above the fold, so
   * it splits photo and words side by side. The editor's column is half that
   * width, where the same split would squeeze the headline input to nothing.
   */
  layout: "wizard" | "editor";
}

export interface SiteStep {
  id: string;
  /** Short label, for the rail and the wizard's step dots. */
  label: string;
  /** The prompt itself, asked as a question. */
  question: string;
  /** One line of why it matters, under the question. */
  hint: string;
  icon: LucideIcon;
  /** Steps that may be passed without an answer. */
  optional?: boolean;
  /** Which block of the live preview this step is writing. */
  previewFocus: "hero" | "services" | "areas" | "about" | "reviews" | "contact" | "address";
  /**
   * Whether Enter in this step's fields submits the step.
   *
   * True only where a plain text input is the answer. The tag inputs and the
   * rich text editor bind Enter themselves (add a chip, start a paragraph), so
   * a step made of those never submits - and promising "press Enter" under one
   * of them teaches people the shortcut is broken.
   */
  enterAdvances: boolean;
  /**
   * Whether this step has been answered.
   *
   * `portfolio` is the saved row, and only the Reviews step reads it - the
   * Google connection is the one answer that never passes through the draft.
   * Optional so the pre-draft callers (needsGuidedSetup, which runs before
   * anything is loaded) keep working unchanged.
   */
  isDone: (d: Draft, portfolio?: PortfolioDetail) => boolean;
  Fields: ComponentType<{ ctx: StepCtx }>;
}

const ACCENT_PRESETS = [
  "#2563eb",
  "#0f766e",
  "#b91c1c",
  "#ea580c",
  "#ca8a04",
  "#15803d",
  "#7c3aed",
  "#111827",
];

/* ------------------------------------------------------------------ */
/* Step 1 - the business                                               */
/* ------------------------------------------------------------------ */

function BusinessFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set, logoUploading, uploadLogo, removeLogo } = ctx;
  const logoInput = useRef<HTMLInputElement | null>(null);

  return (
    <>
      {/* First, because the fastest way through this whole wizard is to not
          type any of it. */}
      <GoogleBusinessConnect
        portfolio={ctx.portfolio}
        draft={draft}
        set={set}
        onSaved={ctx.onSaved}
        compact={ctx.layout === "editor"}
      />

      <Field label="Business name">
        <Input
          value={draft.businessName}
          onChange={(e) => set("businessName", e.target.value)}
          placeholder="Acme Roofing"
          autoFocus
          className="h-11 text-base"
        />
      </Field>

      <Field
        label="Logo"
        hint="Sits in the site header and footer. Separate from your report logo."
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted">
            {draft.logoUrl ? (
              <img src={draft.logoUrl} alt="" className="h-full w-full object-contain" />
            ) : (
              <span className="text-xl font-black text-muted-foreground">
                {(draft.businessName || "?").slice(0, 1).toUpperCase()}
              </span>
            )}
          </div>
          <input
            ref={logoInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              void uploadLogo(e.target.files);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            disabled={logoUploading}
            onClick={() => logoInput.current?.click()}
          >
            {logoUploading ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-4 w-4" />
            )}
            {draft.logoUrl ? "Replace logo" : "Upload logo"}
          </Button>
          {draft.logoUrl && (
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              onClick={removeLogo}
            >
              Remove
            </Button>
          )}
        </div>
      </Field>

      <Field label="Brand colour" hint="Used for buttons, filters, map pins and the contact band.">
        <div className="flex flex-wrap items-center gap-2">
          {ACCENT_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Use ${c}`}
              aria-pressed={draft.accentColor.toLowerCase() === c}
              onClick={() => set("accentColor", c)}
              className={cn(
                "h-8 w-8 rounded-full border-2 transition",
                draft.accentColor.toLowerCase() === c
                  ? "border-foreground"
                  : "border-transparent hover:scale-110",
              )}
              style={{ backgroundColor: c }}
            />
          ))}
          <label className="ml-1 inline-flex cursor-pointer items-center gap-2 rounded-full border border-input px-3 py-1.5 text-xs font-bold text-muted-foreground">
            <input
              type="color"
              value={draft.accentColor}
              onChange={(e) => set("accentColor", e.target.value)}
              className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0"
              aria-label="Custom brand colour"
            />
            Custom
          </label>
        </div>
      </Field>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 2 - what you do                                                */
/* ------------------------------------------------------------------ */

function ServicesFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set, serviceTypes } = ctx;
  return (
    <Field
      label="Your trades"
      hint="Type one and press Enter. These become the filter buttons on your site."
    >
      <TagInput
        value={draft.services}
        onChange={(v) => set("services", v)}
        placeholder="Roofing, Siding, Gutters"
        suggestions={serviceTypes}
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Step 3 - the cover                                                  */
/* ------------------------------------------------------------------ */

function CoverFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set, heroPreview, openHeroPicker, clearHero } = ctx;
  const suggestions = headlineSuggestions(draft);

  return (
    // Stacked, this is the one step whose answer runs past the fold and puts
    // Continue out of sight, handing back the scrolling the rest of this
    // rewrite removed. Side by side, the photo and the words that sit on top of
    // it are also the truer picture of what is being composed.
    <div className={cn("grid gap-6", ctx.layout === "wizard" && "sm:grid-cols-2 sm:items-start")}>
      <Field label="Hero photo" hint="Your most impressive finished job, shot on site.">
        {/* The single biggest lever on whether the site reads as premium, so it
            gets a real preview at the ratio it renders at rather than a
            filename and a hope. Capped in the editor, whose single column is
            wide enough for a 21:9 box to push the headline field off screen. */}
        <div
          className={cn(
            "relative aspect-[21/9] w-full overflow-hidden rounded-xl border border-border bg-muted",
            ctx.layout === "editor" && "max-h-[200px]",
          )}
        >
          {heroPreview ? (
            <img src={heroPreview} alt="" className="h-full w-full object-cover" />
          ) : (
            <button
              type="button"
              onClick={openHeroPicker}
              className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground transition hover:bg-muted/60"
            >
              <ImagePlus className="h-7 w-7 opacity-60" />
              <p className="px-6 text-center text-xs">
                Tap to pick one. Without a hero, your newest project&rsquo;s cover is used.
              </p>
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={openHeroPicker}>
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
            {draft.heroPhotoId ? "Change photo" : "Choose photo"}
          </Button>
          {draft.heroPhotoId && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={clearHero}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Use newest project
            </Button>
          )}
        </div>
      </Field>

      <div className="space-y-5">
        <Field label="Headline" hint="Big type over the photo. Leave it blank to use your name.">
          <Input
            value={draft.heroHeadline}
            onChange={(e) => set("heroHeadline", e.target.value)}
            placeholder="Roofing done right, the first time."
            className="h-11 text-base"
          />
          {suggestions.length > 0 && !draft.heroHeadline.trim() && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => set("heroHeadline", s)}
                  className="rounded-full border border-dashed border-border px-2.5 py-1 text-left text-xs font-semibold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </Field>

        {/* The label used to just say "one line of context", and people filled
            it with the name of a job ("LED lighting upgrade"), which then read
            as the whole company's strapline. It is a line about the business,
            and saying where it lands is what makes that obvious. */}
        <Field
          label="Sub-headline"
          hint="Optional. One line about the business, under the headline on your cover."
        >
          <Textarea
            value={draft.heroSubhead}
            onChange={(e) => set("heroSubhead", e.target.value)}
            rows={2}
            maxLength={160}
            placeholder="Family-run and serving the Sacramento area since 2009."
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Not a project title. Individual jobs get their own titles under Projects.
          </p>
        </Field>
      </div>
    </div>
  );
}

/** Two ready-made headlines built from answers already given. */
function headlineSuggestions(d: Draft): string[] {
  const trade = d.services[0]?.trim();
  const area = d.serviceAreas[0]?.trim();
  const name = d.businessName.trim();
  const out: string[] = [];
  if (trade && area) out.push(`${trade} done right in ${area}.`);
  if (trade) out.push(`${trade} done right, the first time.`);
  if (name && out.length < 2) out.push(`${name}. Work you can point at.`);
  return out.slice(0, 2);
}

/* ------------------------------------------------------------------ */
/* Step 4 - where you work                                             */
/* ------------------------------------------------------------------ */

function AreasFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set } = ctx;
  return (
    <>
      <Field
        label="Towns and cities"
        hint="Leave empty and the cities on your projects are used instead."
      >
        <TagInput
          value={draft.serviceAreas}
          onChange={(v) => set("serviceAreas", v)}
          placeholder="Sacramento, Elk Grove, Roseville"
          max={40}
        />
      </Field>

      <ToggleRow
        label="Show the project map"
        hint="Drops a pin for every project that has an address."
        checked={draft.showMap}
        onChange={(v) => set("showMap", v)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 5 - about                                                      */
/* ------------------------------------------------------------------ */

function AboutFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set } = ctx;
  return (
    <Field
      label="About your business"
      hint="Why someone should call you rather than the next listing."
    >
      <RichTextEditor
        value={draft.aboutHtml}
        onChange={(html) => set("aboutHtml", html)}
        placeholder="We're a family-run crew of six…"
        minHeight={160}
      />
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Step 6 - reviews                                                    */
/* ------------------------------------------------------------------ */

/**
 * Reviews, given a step of their own.
 *
 * They used to be a single switch buried at the bottom of the About step, whose
 * hint pointed at a Settings page most people never opened - so the site
 * shipped with the reviews section silently empty and the client's read was
 * simply "there is no google reviews link".
 *
 * The step earns its place twice over, because the same links do two jobs. On
 * the portfolio they are proof for a prospect who hasn't hired anyone yet. On a
 * finished job report they are the ask, sent to a customer who just watched you
 * work - and the job report is the only thing this business ever sends a
 * customer, so it is the only place that ask can be made.
 */
function ReviewsFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set, portfolio } = ctx;
  // Re-reads the table whenever the connection changes, because connecting
  // writes a Google row this hook has not seen. See useTeamReviewLinks.
  const links = useTeamReviewLinks(portfolio.google_review_ask_url);

  return (
    <>
      <GoogleBusinessConnect
        portfolio={portfolio}
        draft={draft}
        set={set}
        onSaved={ctx.onSaved}
        compact={ctx.layout === "editor"}
      />

      {portfolio.google_reviews_url && (
        <div className="grid gap-3 sm:grid-cols-2">
          <LinkPreviewRow
            title="Prospects see"
            label="Read our Google reviews"
            hint="On your site, under the projects."
            url={portfolio.google_reviews_url}
          />
          <LinkPreviewRow
            title="Customers see"
            label="Leave us a review"
            hint="On every job report you share."
            url={portfolio.google_review_ask_url ?? portfolio.google_reviews_url}
          />
        </div>
      )}

      <Field
        label="Other places you collect reviews"
        hint="Facebook, Yelp, NiceJob, anywhere with a public page. Saved as you type."
      >
        <ExtraReviewLinks state={links} />
      </Field>

      <ToggleRow
        label="Show reviews on my site"
        hint="Turn off to hide the rating and the review buttons from the public site. Job reports still ask."
        checked={draft.showReviews}
        onChange={(v) => set("showReviews", v)}
      />
    </>
  );
}

function LinkPreviewRow({
  title,
  label,
  hint,
  url,
}: {
  title: string;
  label: string;
  hint: string;
  url: string;
}) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-[10.5px] font-extrabold uppercase tracking-[0.14em] text-muted-foreground">
        {title}
      </p>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-bold text-foreground underline-offset-4 hover:underline"
      >
        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
        {label}
        <ExternalLink className="h-3 w-3 text-muted-foreground" />
      </a>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

interface ReviewLinksState {
  rows: Array<{ platform: ReviewLink["platform"]; url: string; label: string }>;
  loading: boolean;
  saving: boolean;
  add: () => void;
  update: (index: number, patch: Partial<{ url: string; label: string }>) => void;
  remove: (index: number) => void;
}

/**
 * The non-Google review links, loaded and saved on their own.
 *
 * They live in `team_review_links`, not on the portfolio row, so they cannot
 * ride along on the draft's save. Autosaved on a debounce instead, because the
 * wizard's whole promise is "saved automatically as you go" and one step
 * needing a Save button people have not been trained to look for is how links
 * get lost.
 *
 * The Google row is filtered out of the editor but carried through every write.
 * That is not cosmetic: setReviewLinks replaces the team's whole list, so a
 * save built from a stale read would delete the Google row and take the review
 * ask off every future job report with it. `syncKey` is what closes that
 * window - connecting a listing changes it, which re-reads the table before the
 * next autosave can be composed from the wrong picture.
 */
function useTeamReviewLinks(syncKey: string | null): ReviewLinksState {
  const [rows, setRows] = useState<ReviewLinksState["rows"]>([]);
  const [google, setGoogle] = useState<ReviewLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  // Nothing is written until the user touches something, so simply loading the
  // step can never rewrite the table.
  const touched = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listReviewLinks()
      .then((res) => {
        if (cancelled) return;
        setGoogle(res.links.filter((l) => l.platform === "google"));
        // A re-read triggered by connecting must not throw away rows the user
        // is halfway through typing, so the editable half is only seeded once.
        if (!touched.current) {
          setRows(
            res.links
              .filter((l) => l.platform !== "google")
              .map((l) => ({ platform: l.platform, url: l.url, label: l.label ?? "" })),
          );
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [syncKey]);

  useEffect(() => {
    if (!touched.current || loading) return;
    const timer = window.setTimeout(async () => {
      setSaving(true);
      try {
        await setReviewLinks({
          data: {
            links: [
              ...google.map((l) => ({
                platform: l.platform,
                url: l.url,
                label: l.label,
              })),
              ...rows
                .filter((r) => /^https?:\/\//i.test(r.url.trim()))
                .map((r) => ({
                  platform: r.platform,
                  url: r.url.trim(),
                  label: r.label.trim() || null,
                })),
            ],
          },
        });
      } catch (e: any) {
        toast.error(e?.message ?? "Could not save the review links");
      } finally {
        setSaving(false);
      }
    }, 900);
    return () => window.clearTimeout(timer);
  }, [rows, google, loading]);

  const mark = () => {
    touched.current = true;
  };

  return {
    rows,
    loading,
    saving,
    add: () => {
      mark();
      setRows((prev) => [...prev, { platform: "custom", url: "", label: "" }]);
    },
    update: (index, patch) => {
      mark();
      setRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    },
    remove: (index) => {
      mark();
      setRows((prev) => prev.filter((_, i) => i !== index));
    },
  };
}

function ExtraReviewLinks({ state }: { state: ReviewLinksState }) {
  if (state.loading) {
    return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
  }

  return (
    <div className="space-y-2">
      {state.rows.map((row, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Input
            value={row.label}
            onChange={(e) => state.update(i, { label: e.target.value })}
            placeholder="Yelp"
            className="h-10 w-full sm:w-32"
          />
          <Input
            value={row.url}
            onChange={(e) => state.update(i, { url: e.target.value })}
            placeholder="https://…"
            className="h-10 min-w-[180px] flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground hover:text-destructive"
            onClick={() => state.remove(i)}
            aria-label="Remove this link"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" onClick={state.add}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a link
        </Button>
        {state.saving ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Saving
          </span>
        ) : (
          state.rows.length > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Check className="h-3 w-3" /> Saved
            </span>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Step 7 - contact                                                    */
/* ------------------------------------------------------------------ */

function ContactFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set } = ctx;
  return (
    <>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Phone">
          <Input
            value={draft.phone}
            onChange={(e) => set("phone", e.target.value)}
            placeholder="(916) 555-0142"
            className="h-11 text-base"
          />
        </Field>
        <Field label="Email">
          <Input
            value={draft.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="hello@acmeroofing.com"
            className="h-11 text-base"
          />
        </Field>
      </div>

      <Field label="Address" hint="Optional. Shown under the contact band.">
        <Input
          value={draft.address}
          onChange={(e) => set("address", e.target.value)}
          placeholder="1200 J St, Sacramento, CA"
        />
      </Field>

      <Field
        label="Button label"
        hint="The button in the site header. Falls back to your phone number."
      >
        <Input
          value={draft.ctaLabel}
          onChange={(e) => set("ctaLabel", e.target.value)}
          placeholder="Get a free estimate"
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Button link" hint="Optional. Empty means the button dials you.">
          <Input
            value={draft.ctaUrl}
            onChange={(e) => set("ctaUrl", e.target.value)}
            placeholder="https://acmeroofing.com/quote"
          />
        </Field>
        <Field label="Your main website" hint="Optional.">
          <Input
            value={draft.websiteUrl}
            onChange={(e) => set("websiteUrl", e.target.value)}
            placeholder="https://acmeroofing.com"
          />
        </Field>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Step 8 - the address it lives at                                    */
/* ------------------------------------------------------------------ */

function AddressFields({ ctx }: { ctx: StepCtx }) {
  const { draft, set, slugState, savedSlug } = ctx;
  const [seoOpen, setSeoOpen] = useState(false);

  return (
    <>
      <Field label="Site address" hint="Anyone with this link can visit your site.">
        <div className="flex items-center gap-0 rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
          <span className="shrink-0 py-2.5 pl-3 text-sm text-muted-foreground">
            {typeof window !== "undefined" ? window.location.host : "sitepix"}/p/
          </span>
          <Input
            value={draft.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase())}
            className="h-11 border-0 pl-0 text-base shadow-none focus-visible:ring-0"
            placeholder="acme-roofing"
          />
        </div>
        <SlugStatus changed={draft.slug !== savedSlug} state={slugState} />
      </Field>

      <div>
        <button
          type="button"
          onClick={() => setSeoOpen((v) => !v)}
          className="text-xs font-bold text-muted-foreground underline-offset-4 hover:underline"
        >
          {seoOpen ? "Hide" : "Set"} how you appear in Google
        </button>
        {seoOpen && (
          <div className="mt-4 space-y-5 rounded-xl border border-border bg-muted/30 p-4">
            <Field label="Page title">
              <Input
                value={draft.seoTitle}
                onChange={(e) => set("seoTitle", e.target.value)}
                maxLength={70}
                placeholder="Acme Roofing - Roof replacement in Sacramento"
              />
              <CharCount value={draft.seoTitle.length} max={70} />
            </Field>
            <Field label="Description">
              <Textarea
                value={draft.seoDescription}
                onChange={(e) => set("seoDescription", e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="See completed roofing projects across the Sacramento area, photographed on site."
              />
              <CharCount value={draft.seoDescription.length} max={200} />
            </Field>
            <p className="text-xs text-muted-foreground">
              Both are optional. Leave them empty and sensible defaults are generated from your name
              and trades.
            </p>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */

export const SITE_STEPS: SiteStep[] = [
  {
    id: "business",
    label: "Business",
    question: "What's your business called?",
    hint: "Your name, mark and colour set the tone for every page on the site.",
    icon: Building2,
    previewFocus: "hero",
    enterAdvances: true,
    isDone: (d) => d.businessName.trim().length > 0,
    Fields: BusinessFields,
  },
  {
    id: "services",
    label: "What you do",
    question: "What work do you want to be known for?",
    hint: "These become the headline trades and the filters over your projects.",
    icon: Hammer,
    previewFocus: "services",
    enterAdvances: false,
    isDone: (d) => d.services.length > 0,
    Fields: ServicesFields,
  },
  {
    id: "cover",
    label: "Cover",
    question: "Which photo should greet a visitor?",
    hint: "The full-bleed shot at the top of the site, with your headline over it.",
    icon: ImagePlus,
    previewFocus: "hero",
    enterAdvances: true,
    isDone: (d) => !!d.heroPhotoId || d.heroHeadline.trim().length > 0,
    Fields: CoverFields,
  },
  {
    id: "areas",
    label: "Where you work",
    question: "Where do you work?",
    hint: "Shown as chips beside the map, and it is what wins local searches.",
    icon: MapPin,
    optional: true,
    previewFocus: "areas",
    enterAdvances: false,
    isDone: (d) => d.serviceAreas.length > 0,
    Fields: AreasFields,
  },
  {
    id: "about",
    label: "About",
    question: "Who's behind the work?",
    hint: "A short paragraph does more than a long one. Crew, years, what you care about.",
    icon: MessageSquareText,
    optional: true,
    previewFocus: "about",
    enterAdvances: false,
    isDone: (d) => !richIsEmpty(d.aboutHtml),
    Fields: AboutFields,
  },
  {
    id: "reviews",
    label: "Reviews",
    question: "Where do people review you?",
    hint: "Connect Google once and it feeds both your site and the review ask on every job report.",
    icon: Star,
    optional: true,
    previewFocus: "reviews",
    enterAdvances: false,
    // Done means "there is something to show". The switch alone isn't enough:
    // reviews turned on with nowhere to send anyone renders as nothing, which
    // is exactly the empty section this step exists to stop shipping.
    isDone: (d, p) => !!p?.google_place_id,
    Fields: ReviewsFields,
  },
  {
    id: "contact",
    label: "Contact",
    question: "How should they reach you?",
    hint: "This fills the header button, the contact band and the footer.",
    icon: PhoneCall,
    previewFocus: "contact",
    enterAdvances: true,
    isDone: (d) => !!(d.phone.trim() || d.email.trim()),
    Fields: ContactFields,
  },
  {
    id: "address",
    label: "Web address",
    question: "Where should your site live?",
    hint: "This is the link you'll text to customers. It's yours to change until you share it.",
    icon: Link2,
    previewFocus: "address",
    enterAdvances: true,
    isDone: () => true,
    Fields: AddressFields,
  },
];

/** The steps a site really needs before it is worth publishing. */
export const REQUIRED_STEP_IDS = ["business", "services", "cover"] as const;

export function siteProgress(
  draft: Draft,
  portfolio?: PortfolioDetail,
): { done: number; total: number; percent: number } {
  const counted = SITE_STEPS.filter((s) => s.id !== "address");
  const done = counted.filter((s) => s.isDone(draft, portfolio)).length;
  return { done, total: counted.length, percent: Math.round((done / counted.length) * 100) };
}

/**
 * Whether to open the guided build rather than the editor.
 *
 * Deliberately strict: a site missing any of the three load-bearing answers has
 * nothing worth showing a prospect, and dropping that person into a rail of
 * eight sections is the exact overwhelm the wizard exists to remove.
 */
export function needsGuidedSetup(draft: Draft): boolean {
  return SITE_STEPS.filter((s) => (REQUIRED_STEP_IDS as readonly string[]).includes(s.id)).some(
    (s) => !s.isDone(draft),
  );
}

/* ------------------------------------------------------------------ */
/* Small shared pieces                                                 */
/* ------------------------------------------------------------------ */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label className="text-sm font-bold text-foreground">{label}</Label>
      {hint && <p className="mb-2 mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className={cn(!hint && "mt-1.5")}>{children}</div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SlugStatus({ changed, state }: { changed: boolean; state: SlugState }) {
  if (!changed) return null;
  if (state.checking) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> Checking…
      </p>
    );
  }
  if (!state.available) {
    return (
      <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-destructive">
        <TriangleAlert className="h-3 w-3" /> {state.reason}
      </p>
    );
  }
  return (
    <p className="mt-2 inline-flex items-center gap-1.5 text-xs text-amber-600">
      <TriangleAlert className="h-3 w-3" />
      Available - but changing this breaks links you&rsquo;ve already shared.
    </p>
  );
}

function CharCount({ value, max }: { value: number; max: number }) {
  return (
    <p
      className={cn(
        "mt-1 text-right text-[11px] tabular-nums",
        value > max * 0.9 ? "text-amber-600" : "text-muted-foreground",
      )}
    >
      {value}/{max}
    </p>
  );
}

/**
 * The hero picker, rendered once by whichever surface is on screen.
 *
 * It lives here rather than in the step body because the dialog has to sit
 * outside the wizard's <form> - a photo grid inside a form is one stray Enter
 * away from submitting the step.
 */
export function HeroPickerDialog({ ctx }: { ctx: StepCtx }) {
  return (
    <ShowcasePhotoPickerDialog
      open={ctx.heroPickerOpen}
      onClose={ctx.closeHeroPicker}
      singleSelect
      title="Choose your hero photo"
      description="The full-width shot at the top of your site. Pick your most impressive finished job."
      confirmLabel="Use this photo"
      onPick={(picked) => {
        ctx.closeHeroPicker();
        const photo = picked[0];
        if (photo) ctx.pickHero(photo);
      }}
    />
  );
}
