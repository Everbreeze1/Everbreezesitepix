import { useMemo, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, Save, Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { updateShowcaseSite } from "@/lib/portfolio.functions";
import type { ShowcaseDetail } from "@/lib/showcases.functions";
import { TagInput } from "./TagInput";

interface SiteDraft {
  slug: string;
  serviceType: string;
  productsUsed: string[];
  summary: string;
  city: string;
  state: string;
  completedOn: string;
  onSite: boolean;
  featured: boolean;
}

function toDraft(s: ShowcaseDetail): SiteDraft {
  return {
    slug: s.slug ?? "",
    serviceType: s.service_type ?? "",
    productsUsed: s.products_used ?? [],
    summary: s.summary ?? "",
    city: s.city ?? "",
    state: s.state ?? "",
    completedOn: s.completed_on ?? "",
    onSite: s.on_site,
    featured: s.featured,
  };
}

/**
 * The fields that only exist because this showcase now lives on a site: its
 * URL, the facets a visitor filters by, its map pin, and whether it is listed.
 *
 * Saved independently of the document above it. The builder's dirty flag covers
 * title/copy/sections and nothing here, so a user who only wants to re-file a
 * project under a different service doesn't have to re-save its whole body —
 * and, more importantly, can't accidentally publish half-finished copy while
 * doing it.
 */
export function ShowcaseSiteCard({
  showcase,
  portfolioSlug,
  portfolioPublished,
  serviceTypeSuggestions,
  onSaved,
}: {
  showcase: ShowcaseDetail;
  portfolioSlug: string | null;
  portfolioPublished: boolean;
  serviceTypeSuggestions: string[];
  onSaved: (patch: Partial<ShowcaseDetail>) => void;
}) {
  const [draft, setDraft] = useState<SiteDraft>(() => toDraft(showcase));
  const [saving, setSaving] = useState(false);
  const savedRef = useRef(JSON.stringify(toDraft(showcase)));

  const snapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const dirty = snapshot !== savedRef.current;
  const set = <K extends keyof SiteDraft>(key: K, value: SiteDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const res = await updateShowcaseSite({
        data: {
          id: showcase.id,
          slug: draft.slug || null,
          serviceType: draft.serviceType || null,
          productsUsed: draft.productsUsed,
          summary: draft.summary || null,
          city: draft.city || null,
          state: draft.state || null,
          completedOn: draft.completedOn || null,
          onSite: draft.onSite,
          featured: draft.featured,
        },
      });
      // The server slugifies, so echo its answer back into the form rather than
      // leaving the user looking at what they typed.
      const nextDraft = { ...draft, slug: res.slug ?? "" };
      setDraft(nextDraft);
      savedRef.current = JSON.stringify(nextDraft);
      onSaved({
        slug: res.slug,
        service_type: draft.serviceType || null,
        products_used: draft.productsUsed,
        summary: draft.summary || null,
        city: draft.city || null,
        state: draft.state || null,
        completed_on: draft.completedOn || null,
        on_site: draft.onSite,
        featured: draft.featured,
      });
      toast.success("Site details saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save site details");
    } finally {
      setSaving(false);
    }
  };

  const liveUrl =
    portfolioPublished && portfolioSlug && showcase.slug && showcase.on_site && !showcase.revoked_at
      ? `/p/${portfolioSlug}/${showcase.slug}`
      : null;

  return (
    <div className="h-fit rounded-2xl border border-border bg-card p-6">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-extrabold text-foreground">On your site</p>
          <p className="mt-1 text-xs text-muted-foreground">
            How this project appears in your portfolio's grid, filters and map.
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            draft.onSite && !showcase.revoked_at
              ? "bg-emerald-500/15 text-emerald-600"
              : "bg-muted text-muted-foreground",
          )}
        >
          {showcase.revoked_at ? "Draft" : draft.onSite ? "Listed" : "Hidden"}
        </span>
      </div>

      <div className="mt-4 space-y-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-foreground">Show on my site</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Appears in the grid, the map and your website embeds.
            </p>
          </div>
          <Switch checked={draft.onSite} onCheckedChange={(v) => set("onSite", v)} />
        </div>

        <button
          type="button"
          onClick={() => set("featured", !draft.featured)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-lg border p-3 text-left transition",
            draft.featured
              ? "border-amber-400/60 bg-amber-400/10"
              : "border-border hover:border-amber-400/40",
          )}
        >
          <Star
            className={cn(
              "h-4 w-4 shrink-0",
              draft.featured ? "fill-amber-400 text-amber-500" : "text-muted-foreground",
            )}
          />
          <span className="min-w-0">
            <span className="block text-sm font-bold text-foreground">Feature this project</span>
            <span className="block text-xs text-muted-foreground">
              Featured projects lead the grid.
            </span>
          </span>
        </button>

        <div>
          <Label>Page address</Label>
          <Input
            value={draft.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase())}
            placeholder="oak-street-reroof"
            className="font-mono text-xs"
          />
          <p className="mt-1.5 break-all text-[11px] text-muted-foreground">
            /p/{portfolioSlug ?? "your-site"}/{draft.slug || "…"}
          </p>
        </div>

        <div>
          <Label>Service type</Label>
          <Input
            value={draft.serviceType}
            onChange={(e) => set("serviceType", e.target.value)}
            placeholder="Roof replacement"
            list="showcase-service-types"
          />
          <datalist id="showcase-service-types">
            {serviceTypeSuggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Becomes a filter on your site — reuse the same wording across jobs.
          </p>
        </div>

        <div>
          <Label>Card summary</Label>
          <Textarea
            value={draft.summary}
            onChange={(e) => set("summary", e.target.value)}
            rows={2}
            maxLength={300}
            placeholder="Full tear-off and re-roof on a 1960s ranch."
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            One line, shown under the title on the grid and in search results.
          </p>
        </div>

        <div>
          <Label>Products used</Label>
          <TagInput
            value={draft.productsUsed}
            onChange={(v) => set("productsUsed", v)}
            placeholder="GAF Timberline HDZ"
          />
        </div>

        <div className="grid grid-cols-[1fr_88px] gap-2">
          <div>
            <Label>City</Label>
            <Input
              value={draft.city}
              onChange={(e) => set("city", e.target.value)}
              placeholder="Sacramento"
            />
          </div>
          <div>
            <Label>State</Label>
            <Input
              value={draft.state}
              onChange={(e) => set("state", e.target.value)}
              placeholder="CA"
            />
          </div>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          Used for the map pin and the “areas served” list.
        </p>

        <div>
          <Label>Completed</Label>
          <Input
            type="date"
            value={draft.completedOn}
            onChange={(e) => set("completedOn", e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2 border-t border-border pt-4">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-bold",
              dirty ? "text-amber-600" : "text-muted-foreground",
            )}
          >
            {dirty ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Unsaved
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" /> Saved
              </>
            )}
          </span>
          <Button size="sm" className="ml-auto" onClick={save} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save
          </Button>
        </div>

        {liveUrl && (
          <Button variant="outline" size="sm" className="w-full" asChild>
            <a href={liveUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> View live page
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
