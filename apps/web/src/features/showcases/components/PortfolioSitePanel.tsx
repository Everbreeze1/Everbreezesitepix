import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, Save, TriangleAlert, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RichTextEditor } from "@/components/RichTextEditor";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/sitepix/client";
import {
  checkPortfolioSlug,
  updatePortfolio,
  type MyPortfolio,
  type PortfolioDetail,
} from "@/lib/portfolio.functions";
import { ShowcasePhotoPickerDialog } from "./ShowcasePhotoPickerDialog";
import { TagInput } from "./TagInput";

const DEFAULT_ACCENT = "#2563eb";

/** Everything the form owns, in the shape the save call wants. */
interface Draft {
  slug: string;
  businessName: string;
  logoUrl: string;
  accentColor: string;
  heroHeadline: string;
  heroSubhead: string;
  heroPhotoId: string | null;
  aboutHtml: string;
  services: string[];
  serviceAreas: string[];
  phone: string;
  email: string;
  address: string;
  websiteUrl: string;
  ctaLabel: string;
  ctaUrl: string;
  showMap: boolean;
  showReviews: boolean;
  seoTitle: string;
  seoDescription: string;
}

function toDraft(p: PortfolioDetail): Draft {
  return {
    slug: p.slug,
    businessName: p.business_name ?? "",
    logoUrl: p.logo_url ?? "",
    accentColor: p.accent_color || DEFAULT_ACCENT,
    heroHeadline: p.hero_headline ?? "",
    heroSubhead: p.hero_subhead ?? "",
    heroPhotoId: p.hero_photo_id,
    aboutHtml: p.about_html ?? "",
    services: p.services ?? [],
    serviceAreas: p.service_areas ?? [],
    phone: p.phone ?? "",
    email: p.email ?? "",
    address: p.address ?? "",
    websiteUrl: p.website_url ?? "",
    ctaLabel: p.cta_label ?? "",
    ctaUrl: p.cta_url ?? "",
    showMap: p.show_map,
    showReviews: p.show_reviews,
    seoTitle: p.seo_title ?? "",
    seoDescription: p.seo_description ?? "",
  };
}

/**
 * Editor for the site *around* the showcases — the brand, the copy, the
 * contact details and the address it lives at.
 *
 * Mirrors the showcase builder's save model on purpose: no autosave, an
 * explicit dirty flag derived from a serialized snapshot, and one Save. Two
 * surfaces in the same feature behaving differently is worse than either
 * behaviour on its own.
 */
export function PortfolioSitePanel({
  portfolio,
  onSaved,
  serviceTypes,
}: {
  portfolio: PortfolioDetail;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
  serviceTypes: string[];
}) {
  const { user } = useAuth();
  const [draft, setDraft] = useState<Draft>(() => toDraft(portfolio));
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(JSON.stringify(toDraft(portfolio)));
  const [slugState, setSlugState] = useState<{
    checking: boolean;
    available: boolean;
    reason: string | null;
  }>({ checking: false, available: true, reason: null });

  // Hero preview is tracked separately from the id: the picker hands back a
  // signed URL we can show immediately, while `hero_image_url` from the server
  // only refreshes on the next load.
  const [heroPreview, setHeroPreview] = useState<string | null>(portfolio.hero_image_url);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInput = useRef<HTMLInputElement | null>(null);

  const snapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = snapshot !== savedRef.current;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  // Debounced availability check. Changing the address breaks every link the
  // contractor has already handed out, so it is worth telling them it's free
  // *before* they press Save rather than rejecting the save afterwards.
  useEffect(() => {
    if (draft.slug === portfolio.slug) {
      setSlugState({ checking: false, available: true, reason: null });
      return;
    }
    setSlugState((s) => ({ ...s, checking: true }));
    const timer = window.setTimeout(async () => {
      try {
        const res = await checkPortfolioSlug({ data: { slug: draft.slug } });
        setSlugState({ checking: false, available: res.available, reason: res.reason });
      } catch {
        setSlugState({ checking: false, available: true, reason: null });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [draft.slug, portfolio.slug]);

  /**
   * Uploaded to the same `company-logos` bucket Settings uses, but stored on
   * the portfolio rather than the profile — the marketing site's logo and the
   * one stamped on reports are allowed to differ.
   */
  const onLogoUpload = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Logo must be an image");
      return;
    }
    setUploadingLogo(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/portfolio-logo-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("company-logos")
        .upload(path, file, { contentType: file.type, upsert: true });
      if (upErr) {
        toast.error(upErr.message);
        return;
      }
      const { data: pub } = supabase.storage.from("company-logos").getPublicUrl(path);
      set("logoUrl", pub.publicUrl);
      toast.success("Logo uploaded — press Save to publish it.");
    } finally {
      setUploadingLogo(false);
      if (logoInput.current) logoInput.current.value = "";
    }
  };

  const save = async () => {
    if (!slugState.available) {
      toast.error(slugState.reason ?? "Pick a different address.");
      return;
    }
    setSaving(true);
    try {
      const res = await updatePortfolio({
        data: {
          slug: draft.slug,
          businessName: draft.businessName || null,
          logoUrl: draft.logoUrl || null,
          accentColor: draft.accentColor,
          heroHeadline: draft.heroHeadline || null,
          heroSubhead: draft.heroSubhead || null,
          heroPhotoId: draft.heroPhotoId,
          aboutHtml: draft.aboutHtml || null,
          services: draft.services,
          serviceAreas: draft.serviceAreas,
          phone: draft.phone || null,
          email: draft.email || null,
          address: draft.address || null,
          websiteUrl: draft.websiteUrl || null,
          ctaLabel: draft.ctaLabel || null,
          ctaUrl: draft.ctaUrl || null,
          showMap: draft.showMap,
          showReviews: draft.showReviews,
          seoTitle: draft.seoTitle || null,
          seoDescription: draft.seoDescription || null,
        },
      });
      savedRef.current = snapshot;
      onSaved({
        slug: res.slug,
        business_name: draft.businessName || null,
        logo_url: draft.logoUrl || null,
        accent_color: draft.accentColor,
        hero_photo_id: draft.heroPhotoId,
        hero_image_url: heroPreview,
        show_map: draft.showMap,
        show_reviews: draft.showReviews,
      });
      toast.success("Site saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the site");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sticky save bar — same affordance as the showcase builder, so "did
          that save?" is never a question on either screen. */}
      <div className="sticky top-[82px] z-20 -mx-6 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-6 py-3 backdrop-blur sm:-mx-10 sm:px-10">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-bold",
            dirty ? "text-amber-600" : "text-muted-foreground",
          )}
        >
          {dirty ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved changes
            </>
          ) : (
            <>
              <Check className="h-3.5 w-3.5" /> All changes saved
            </>
          )}
        </span>
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving || !dirty}>
          {saving ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1.5 h-3.5 w-3.5" />
          )}
          Save site
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <Card title="Address" hint="Where your site lives. Anyone with this link can visit it.">
            <div>
              <Label>Site address</Label>
              <div className="flex items-center gap-0 rounded-lg border border-input bg-background focus-within:ring-1 focus-within:ring-ring">
                <span className="shrink-0 py-2 pl-3 text-sm text-muted-foreground">
                  {typeof window !== "undefined" ? window.location.host : "sitepix"}/p/
                </span>
                <Input
                  value={draft.slug}
                  onChange={(e) => set("slug", e.target.value.toLowerCase())}
                  className="border-0 pl-0 shadow-none focus-visible:ring-0"
                  placeholder="acme-roofing"
                />
              </div>
              <SlugStatus changed={draft.slug !== portfolio.slug} state={slugState} />
            </div>
          </Card>

          <Card
            title="Cover"
            hint="The first thing a prospect sees — full-bleed, with your headline over it."
          >
            <div>
              <Label>Hero photo</Label>
              {/* The single biggest lever on whether the site reads as premium,
                  so it gets a real preview at roughly the ratio it renders at
                  rather than a filename and a hope. */}
              <div className="relative overflow-hidden rounded-xl border border-border bg-muted">
                {heroPreview ? (
                  <img src={heroPreview} alt="" className="aspect-[21/9] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[21/9] flex-col items-center justify-center gap-2 text-muted-foreground">
                    <ImagePlus className="h-7 w-7 opacity-60" />
                    <p className="px-6 text-center text-xs">
                      No hero chosen — your newest project&rsquo;s cover is used instead.
                    </p>
                  </div>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setHeroPickerOpen(true)}>
                  <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
                  {draft.heroPhotoId ? "Change hero photo" : "Choose hero photo"}
                </Button>
                {draft.heroPhotoId && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => {
                      set("heroPhotoId", null);
                      setHeroPreview(null);
                    }}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Use newest project
                  </Button>
                )}
              </div>
            </div>

            <div>
              <Label>Business name</Label>
              <Input
                value={draft.businessName}
                onChange={(e) => set("businessName", e.target.value)}
                placeholder="Acme Roofing"
              />
            </div>

            <div>
              <Label>Logo</Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-border bg-muted">
                  {draft.logoUrl ? (
                    <img src={draft.logoUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-lg font-black text-muted-foreground">
                      {(draft.businessName || "?").slice(0, 1).toUpperCase()}
                    </span>
                  )}
                </div>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => onLogoUpload(e.target.files)}
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={uploadingLogo}
                  onClick={() => logoInput.current?.click()}
                >
                  {uploadingLogo ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {draft.logoUrl ? "Replace" : "Upload"}
                </Button>
                {draft.logoUrl && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    onClick={() => set("logoUrl", "")}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Sits in the site header and footer. Separate from the logo stamped on reports.
              </p>
            </div>
            <div>
              <Label>Headline</Label>
              <Input
                value={draft.heroHeadline}
                onChange={(e) => set("heroHeadline", e.target.value)}
                placeholder="Roofing done right, the first time."
              />
            </div>
            <div>
              <Label>Sub-headline (optional)</Label>
              <Textarea
                value={draft.heroSubhead}
                onChange={(e) => set("heroSubhead", e.target.value)}
                rows={2}
                placeholder="Family-run and serving the Sacramento area since 2009."
              />
            </div>
          </Card>

          <Card
            title="What you do"
            hint="Listed under the cover. These are the trades you want to be known for."
          >
            <TagInput
              value={draft.services}
              onChange={(v) => set("services", v)}
              placeholder="Roofing, Siding, Gutters — press Enter after each"
              suggestions={serviceTypes}
            />
          </Card>

          <Card
            title="About"
            hint="Who you are and why someone should call you rather than the next listing."
          >
            <RichTextEditor
              value={draft.aboutHtml}
              onChange={(html) => set("aboutHtml", html)}
              placeholder="We're a family-run crew of six…"
              minHeight={140}
            />
          </Card>

          <Card
            title="Areas served"
            hint="Shown as chips beside the map. Leave empty to use the cities from your portfolios."
          >
            <TagInput
              value={draft.serviceAreas}
              onChange={(v) => set("serviceAreas", v)}
              placeholder="Sacramento, Elk Grove, Roseville"
              max={40}
            />
          </Card>

          <Card
            title="Search engines"
            hint="How your site appears in Google results. Optional — sensible defaults are generated."
          >
            <div>
              <Label>Page title</Label>
              <Input
                value={draft.seoTitle}
                onChange={(e) => set("seoTitle", e.target.value)}
                maxLength={70}
                placeholder="Acme Roofing — Roof replacement in Sacramento"
              />
              <CharCount value={draft.seoTitle.length} max={70} />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                value={draft.seoDescription}
                onChange={(e) => set("seoDescription", e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="See completed roofing projects across the Sacramento area, photographed on site."
              />
              <CharCount value={draft.seoDescription.length} max={200} />
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Brand">
            <div>
              <Label>Brand colour</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={draft.accentColor}
                  onChange={(e) => set("accentColor", e.target.value)}
                  className="h-9 w-12 cursor-pointer rounded border border-input bg-background p-1"
                  aria-label="Brand colour"
                />
                <Input
                  value={draft.accentColor}
                  onChange={(e) => set("accentColor", e.target.value)}
                  className="h-9 font-mono text-xs"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Used for buttons, filters, map pins and the contact band.
              </p>
            </div>
          </Card>

          <Card title="Contact" hint="Shown in the header button, the contact band and the footer.">
            <div>
              <Label>Phone</Label>
              <Input
                value={draft.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="(916) 555-0142"
              />
            </div>
            <div>
              <Label>Email</Label>
              <Input
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="hello@acmeroofing.com"
              />
            </div>
            <div>
              <Label>Address</Label>
              <Input
                value={draft.address}
                onChange={(e) => set("address", e.target.value)}
                placeholder="1200 J St, Sacramento, CA"
              />
            </div>
            <div>
              <Label>Your main website (optional)</Label>
              <Input
                value={draft.websiteUrl}
                onChange={(e) => set("websiteUrl", e.target.value)}
                placeholder="https://acmeroofing.com"
              />
            </div>
          </Card>

          <Card
            title="Call to action"
            hint="The button in the site header. Falls back to your phone number."
          >
            <div>
              <Label>Button label</Label>
              <Input
                value={draft.ctaLabel}
                onChange={(e) => set("ctaLabel", e.target.value)}
                placeholder="Get a free estimate"
              />
            </div>
            <div>
              <Label>Button link (optional)</Label>
              <Input
                value={draft.ctaUrl}
                onChange={(e) => set("ctaUrl", e.target.value)}
                placeholder="https://acmeroofing.com/quote"
              />
              <p className="mt-2 text-xs text-muted-foreground">
                Leave empty to make the button dial your phone number.
              </p>
            </div>
          </Card>

          <Card title="Sections">
            <Toggle
              label="Project map"
              hint="Shows where you've worked. Needs projects with an address."
              checked={draft.showMap}
              onChange={(v) => set("showMap", v)}
            />
            <Toggle
              label="Review links"
              hint="Adds your Settings review links to the site."
              checked={draft.showReviews}
              onChange={(v) => set("showReviews", v)}
            />
          </Card>
        </div>
      </div>

      <ShowcasePhotoPickerDialog
        open={heroPickerOpen}
        onClose={() => setHeroPickerOpen(false)}
        singleSelect
        title="Choose your hero photo"
        description="The full-width shot at the top of your site. Pick your most impressive finished job."
        confirmLabel="Use this photo"
        onPick={(picked) => {
          setHeroPickerOpen(false);
          const photo = picked[0];
          if (!photo) return;
          set("heroPhotoId", photo.id);
          setHeroPreview(photo.image_url);
        }}
      />
    </div>
  );
}

function SlugStatus({
  changed,
  state,
}: {
  changed: boolean;
  state: { checking: boolean; available: boolean; reason: string | null };
}) {
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
      Available — but changing this breaks links you've already shared.
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

function Card({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <p className="text-sm font-extrabold text-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

function Toggle({
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
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-bold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
