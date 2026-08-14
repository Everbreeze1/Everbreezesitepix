import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/sitepix/client";
import {
  checkPortfolioSlug,
  updatePortfolio,
  type PortfolioDetail,
} from "@/lib/portfolio.functions";

export const DEFAULT_ACCENT = "#2563eb";

/** Everything the site form owns, in the shape the save call wants. */
export interface Draft {
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

export function toDraft(p: PortfolioDetail): Draft {
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

export interface SlugState {
  checking: boolean;
  available: boolean;
  reason: string | null;
}

/**
 * The shared editing model behind both ways of building the site: the guided
 * wizard and the section editor.
 *
 * It lives outside either component because the two surfaces are the same form
 * wearing different chrome. Duplicating the draft, the slug check and the two
 * uploads once per surface is how they drift apart, and a contractor who
 * abandons the wizard halfway must find their answers already in the editor.
 */
export interface PortfolioSiteDraft {
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  dirty: boolean;
  saving: boolean;
  /**
   * Persists the whole draft. Resolves false when the save was refused, so a
   * caller advancing a step can stay put instead of walking away from an error.
   */
  save: (opts?: { quiet?: boolean }) => Promise<boolean>;
  slugState: SlugState;
  savedSlug: string;
  heroPreview: string | null;
  heroPickerOpen: boolean;
  openHeroPicker: () => void;
  closeHeroPicker: () => void;
  pickHero: (photo: { id: string; image_url: string }) => void;
  clearHero: () => void;
  logoUploading: boolean;
  uploadLogo: (files: FileList | null) => Promise<void>;
  removeLogo: () => void;
}

export function usePortfolioSiteDraft(
  portfolio: PortfolioDetail,
  onSaved: (patch: Partial<PortfolioDetail>) => void,
): PortfolioSiteDraft {
  const { user } = useAuth();
  const [draft, setDraft] = useState<Draft>(() => toDraft(portfolio));
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(JSON.stringify(toDraft(portfolio)));
  const [slugState, setSlugState] = useState<SlugState>({
    checking: false,
    available: true,
    reason: null,
  });

  // Hero preview is tracked separately from the id: the picker hands back a
  // signed URL we can show immediately, while `hero_image_url` from the server
  // only refreshes on the next load.
  const [heroPreview, setHeroPreview] = useState<string | null>(portfolio.hero_image_url);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);

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
   * the portfolio rather than the profile - the marketing site's logo and the
   * one stamped on reports are allowed to differ.
   */
  const uploadLogo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Logo must be an image");
      return;
    }
    setLogoUploading(true);
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
      // Deliberately doesn't say how it gets published: the wizard commits on
      // Continue and the editor on Save, and a message naming the wrong one is
      // worse than a message naming neither.
      toast.success("Logo uploaded");
    } finally {
      setLogoUploading(false);
    }
  };

  const save = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!slugState.available) {
      toast.error(slugState.reason ?? "Pick a different address.");
      return false;
    }
    const pending = snapshot;
    setSaving(true);
    try {
      const res = await updatePortfolio({
        data: {
          // Sending the slug only when it moved keeps every step of the wizard
          // from re-validating an address nobody touched.
          ...(draft.slug !== portfolio.slug ? { slug: draft.slug } : {}),
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
      savedRef.current = pending;
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
      if (!quiet) toast.success("Site saved");
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save the site");
      return false;
    } finally {
      setSaving(false);
    }
  };

  return {
    draft,
    set,
    dirty,
    saving,
    save,
    slugState,
    savedSlug: portfolio.slug,
    heroPreview,
    heroPickerOpen,
    openHeroPicker: () => setHeroPickerOpen(true),
    closeHeroPicker: () => setHeroPickerOpen(false),
    pickHero: (photo) => {
      set("heroPhotoId", photo.id);
      setHeroPreview(photo.image_url);
    },
    clearHero: () => {
      set("heroPhotoId", null);
      setHeroPreview(null);
    },
    logoUploading,
    uploadLogo,
    removeLogo: () => set("logoUrl", ""),
  };
}
