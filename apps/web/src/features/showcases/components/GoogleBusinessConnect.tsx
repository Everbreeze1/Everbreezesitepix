import { useState } from "react";
import {
  Check,
  ExternalLink,
  Link2Off,
  Loader2,
  RefreshCw,
  Search,
  Star,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  connectGoogleBusiness,
  disconnectGoogleBusiness,
  lookupGoogleBusiness,
  refreshGoogleBusiness,
  type GoogleApplyField,
  type GoogleBusinessProfile,
  type PortfolioDetail,
} from "@/lib/portfolio.functions";
import type { Draft } from "@/features/showcases/site-draft";

/**
 * Paste one Google link, get most of a website.
 *
 * The client's ask: "They should be able to connect their google business
 * account URL to pull a lot of that information in about their business and use
 * that information to build their mini site without much effort."
 *
 * So this is deliberately the first thing on the first step of the guided
 * build. Everything below it in the wizard is still there and still editable -
 * the listing fills the inputs, it does not replace them - but a contractor who
 * has a Google presence should be four fields ahead of one who doesn't before
 * they type a single character.
 *
 * The confirm step is not ceremony. A text search for "Northwind Heating" will
 * happily return a company in another state, and this writes to the business's
 * live public site, so the match is shown with its address and rating and
 * nothing moves until someone says that's the one.
 */
export function GoogleBusinessConnect({
  portfolio,
  draft,
  set,
  onSaved,
  compact,
}: {
  portfolio: PortfolioDetail;
  draft: Draft;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
  /** Editor rail layout: tighter, no explanatory paragraph. */
  compact?: boolean;
}) {
  const connected = !!portfolio.google_place_id;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<null | "lookup" | "connect" | "refresh" | "disconnect">(null);
  const [match, setMatch] = useState<GoogleBusinessProfile | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [fields, setFields] = useState<Set<GoogleApplyField>>(new Set());

  const find = async () => {
    if (!query.trim() || busy) return;
    setBusy("lookup");
    setMatch(null);
    setNotFound(false);
    try {
      const res = await lookupGoogleBusiness({ data: { query: query.trim() } });
      if (!res.found || !res.profile) {
        setNotFound(true);
        return;
      }
      setMatch(res.profile);
      // Everything Google actually returned starts ticked. Someone reaching for
      // this button wants the form filled in, not a checklist to work through;
      // the boxes exist so they can protect a field they already got right.
      setFields(new Set(suggestedFields(res.profile, draft)));
    } catch (e: any) {
      toast.error(e?.message ?? "Could not reach Google");
    } finally {
      setBusy(null);
    }
  };

  const connect = async () => {
    if (!match || busy) return;
    setBusy("connect");
    try {
      const res = await connectGoogleBusiness({
        data: { placeId: match.placeId, apply: Array.from(fields) },
      });
      // The row is already written; this mirrors the same values into the
      // on-screen draft so the next save doesn't undo them.
      applyToDraft(res.values, set);
      onSaved({
        google_place_id: res.profile.placeId,
        google_maps_url: res.profile.mapsUrl,
        google_name: res.profile.name,
        google_rating: res.profile.rating,
        google_review_count: res.profile.reviewCount,
        google_reviews_url: res.profile.reviewsUrl,
        google_review_ask_url: res.profile.writeReviewUrl,
        google_synced_at: new Date().toISOString(),
      });
      setMatch(null);
      setQuery("");
      toast.success(
        res.applied.length
          ? `Connected. ${res.applied.length} ${res.applied.length === 1 ? "field" : "fields"} filled in from Google.`
          : "Connected. Your review links are live.",
      );
    } catch (e: any) {
      toast.error(e?.message ?? "Could not connect that listing");
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    if (busy) return;
    setBusy("refresh");
    try {
      const res = await refreshGoogleBusiness();
      if (res.profile) {
        onSaved({
          google_name: res.profile.name,
          google_rating: res.profile.rating,
          google_review_count: res.profile.reviewCount,
          google_synced_at: new Date().toISOString(),
        });
      }
      toast.success("Rating updated from Google");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not refresh from Google");
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    if (busy) return;
    setBusy("disconnect");
    try {
      await disconnectGoogleBusiness();
      onSaved({
        google_place_id: null,
        google_maps_url: null,
        google_name: null,
        google_rating: null,
        google_review_count: null,
        google_reviews_url: null,
        google_review_ask_url: null,
        google_synced_at: null,
      });
      toast.success("Google listing unlinked. Your review links were left as they are.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not unlink the listing");
    } finally {
      setBusy(null);
    }
  };

  /* ---- Connected ---- */
  if (connected) {
    return (
      <div className="rounded-xl border border-border bg-muted/30 p-4">
        <div className="flex flex-wrap items-start gap-3">
          <GoogleMark />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-foreground">
              {portfolio.google_name || "Google Business Profile"}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {portfolio.google_rating != null && (
                <span className="inline-flex items-center gap-1 font-bold text-foreground">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  {portfolio.google_rating.toFixed(1)}
                  {portfolio.google_review_count != null && (
                    <span className="font-medium text-muted-foreground">
                      ({portfolio.google_review_count.toLocaleString()})
                    </span>
                  )}
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-emerald-600">
                <Check className="h-3.5 w-3.5" /> Review links live
              </span>
              {portfolio.google_synced_at && (
                <span>Synced {shortDate(portfolio.google_synced_at)}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 gap-1.5">
            {portfolio.google_maps_url && (
              <Button type="button" size="sm" variant="ghost" asChild>
                <a href={portfolio.google_maps_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span className="sr-only">Open the listing on Google</span>
                </a>
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refresh()}
              disabled={!!busy}
            >
              {busy === "refresh" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">Refresh the rating</span>
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => void disconnect()}
              disabled={!!busy}
            >
              {busy === "disconnect" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Link2Off className="h-3.5 w-3.5" />
              )}
              <span className="sr-only">Unlink</span>
            </Button>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted-foreground">
          Customers who open a job report from you now get a one-tap Google review button, and your
          star rating shows on the site.
        </p>
      </div>
    );
  }

  /* ---- Not connected ---- */
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
      <div className="flex items-start gap-3">
        <GoogleMark />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-foreground">Fill this in from Google</p>
          {!compact && (
            <p className="mt-0.5 text-pretty text-xs text-muted-foreground">
              Paste your Google Business Profile link and we&rsquo;ll pull in your name, phone,
              address, trade and star rating. It also switches on the review buttons customers see
              on your job reports.
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          // Enter inside the wizard's <form> would submit the step and walk
          // away from the field they are filling, so it runs the search here.
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void find();
            }
          }}
          placeholder="Paste your Google link, or type your business name and city"
          className="h-10 min-w-[200px] flex-1"
        />
        <Button type="button" variant="outline" onClick={() => void find()} disabled={!!busy}>
          {busy === "lookup" ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
          ) : (
            <Search className="mr-1.5 h-4 w-4" />
          )}
          Find
        </Button>
      </div>

      {notFound && (
        <p className="mt-2.5 inline-flex items-start gap-1.5 text-xs text-amber-600">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          No listing matched that. Try your business name with the town, or open Google Maps, find
          yourself, and copy the link from Share.
        </p>
      )}

      {match && (
        <div className="mt-3 rounded-xl border border-border bg-card p-4">
          <p className="text-sm font-bold text-foreground">{match.name || "Unnamed listing"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {match.rating != null && (
              <span className="inline-flex items-center gap-1 font-bold text-foreground">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {match.rating.toFixed(1)}
                {match.reviewCount != null && (
                  <span className="font-medium text-muted-foreground">
                    ({match.reviewCount.toLocaleString()} reviews)
                  </span>
                )}
              </span>
            )}
            {match.category && <span>{match.category}</span>}
          </div>
          {match.address && <p className="mt-1 text-xs text-muted-foreground">{match.address}</p>}

          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
            Copy onto your site
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {appliable(match).map((f) => {
              const on = fields.has(f.key);
              return (
                <button
                  key={f.key}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    setFields((prev) => {
                      const next = new Set(prev);
                      if (next.has(f.key)) next.delete(f.key);
                      else next.add(f.key);
                      return next;
                    })
                  }
                  className={cn(
                    "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition",
                    on
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-dashed border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {on && <Check className="h-3 w-3 shrink-0" />}
                  <span className="truncate">
                    {f.label}
                    <span className="ml-1 font-medium opacity-70">{f.preview}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void connect()} disabled={!!busy}>
              {busy === "connect" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Use this listing
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setMatch(null)}
              disabled={!!busy}
              className="text-muted-foreground"
            >
              Not us
            </Button>
            {match.mapsUrl && (
              <a
                href={match.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-muted-foreground underline-offset-4 hover:underline"
              >
                Check on Google <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** The Google G, inline so the card renders with no external request. */
function GoogleMark() {
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-border bg-background">
      <svg viewBox="0 0 48 48" className="h-4.5 w-4.5" aria-hidden="true" width="18" height="18">
        <path
          fill="#4285F4"
          d="M45.1 24.5c0-1.6-.1-3.2-.4-4.7H24v8.9h11.8a10 10 0 0 1-4.4 6.6v5.5h7.1c4.2-3.8 6.6-9.5 6.6-16.3z"
        />
        <path
          fill="#34A853"
          d="M24 46c6 0 11-2 14.5-5.2l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7A22 22 0 0 0 24 46z"
        />
        <path
          fill="#FBBC05"
          d="M11.8 28.4a13 13 0 0 1 0-8.4v-5.7H4.5a22 22 0 0 0 0 19.8l7.3-5.7z"
        />
        <path
          fill="#EA4335"
          d="M24 9.5c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3A22 22 0 0 0 4.5 14.3l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"
        />
      </svg>
    </span>
  );
}

/** One togglable field, with a truncated look at what would land in it. */
function appliable(p: GoogleBusinessProfile): Array<{
  key: GoogleApplyField;
  label: string;
  preview: string;
}> {
  const out: Array<{ key: GoogleApplyField; label: string; preview: string }> = [];
  if (p.name) out.push({ key: "businessName", label: "Name", preview: p.name });
  if (p.phone) out.push({ key: "phone", label: "Phone", preview: p.phone });
  if (p.address) out.push({ key: "address", label: "Address", preview: p.address });
  if (p.website) out.push({ key: "websiteUrl", label: "Website", preview: hostOf(p.website) });
  if (p.category) out.push({ key: "services", label: "Trade", preview: p.category });
  if (p.city) {
    out.push({
      key: "serviceAreas",
      label: "Area",
      preview: p.state ? `${p.city}, ${p.state}` : p.city,
    });
  }
  if (p.summary) out.push({ key: "heroSubhead", label: "Sub-headline", preview: p.summary });
  return out;
}

/**
 * Which boxes start ticked.
 *
 * A field the contractor has already filled in stays theirs: overwriting the
 * sub-headline someone wrote by hand with Google's boilerplate is the kind of
 * "helpful" that loses trust. Empty fields default to on.
 */
function suggestedFields(p: GoogleBusinessProfile, draft: Draft): GoogleApplyField[] {
  const keys = appliable(p).map((f) => f.key);
  const filled: Record<GoogleApplyField, boolean> = {
    businessName: !!draft.businessName.trim(),
    phone: !!draft.phone.trim(),
    address: !!draft.address.trim(),
    websiteUrl: !!draft.websiteUrl.trim(),
    // Lists merge rather than replace, so a non-empty one is not a conflict.
    services: false,
    serviceAreas: false,
    heroSubhead: !!draft.heroSubhead.trim(),
  };
  return keys.filter((k) => !filled[k]);
}

/** Mirrors the server's write into the in-memory draft the builder will save. */
function applyToDraft(
  values: Partial<Record<GoogleApplyField, string | string[]>>,
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void,
): void {
  if (typeof values.businessName === "string") set("businessName", values.businessName);
  if (typeof values.phone === "string") set("phone", values.phone);
  if (typeof values.address === "string") set("address", values.address);
  if (typeof values.websiteUrl === "string") set("websiteUrl", values.websiteUrl);
  if (typeof values.heroSubhead === "string") set("heroSubhead", values.heroSubhead);
  if (Array.isArray(values.services)) set("services", values.services);
  if (Array.isArray(values.serviceAreas)) set("serviceAreas", values.serviceAreas);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
