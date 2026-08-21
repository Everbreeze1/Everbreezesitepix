import { Link } from "@tanstack/react-router";
import { Clapperboard, ImageOff, Loader2, Share2, Sparkles } from "lucide-react";
import { relativeTime } from "@sitepix/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectSummaryListItem } from "@/lib/summaries.functions";

/**
 * The Summaries half of the Walkthroughs tab.
 *
 * "Under WT tab should be two sub sections for WT videos alone and another for
 * Summaries generated for each walkthrough. The videos and the WT will be
 * related but separated so the video can be shared and the summary can be
 * generated and shared."
 *
 * So this lists summaries and only summaries. A row links to `/summaries/{id}`,
 * never to a walkthrough, and carries its own share state: a summary can go to
 * a client without the footage going with it.
 */
export function ProjectSummaries({
  summaries,
  loading,
  generating,
  onGenerateFromPhotos,
}: {
  summaries: ProjectSummaryListItem[];
  loading?: boolean;
  generating?: boolean;
  /** Opens the photo picker for a summary with no walk behind it. */
  onGenerateFromPhotos: () => void;
}) {
  if (loading && !summaries.length) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading summaries…
      </p>
    );
  }

  if (!summaries.length) {
    return (
      <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground" />
        <p className="mt-3 max-w-sm text-sm text-muted-foreground">
          No summaries yet. Record a walkthrough and one is written for you automatically, or
          generate one from photos you already have.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={generating}
          onClick={onGenerateFromPhotos}
          className="mt-4 rounded-lg px-4 text-xs font-bold"
        >
          {generating ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          Generate from photos
        </Button>
      </div>
    );
  }

  return (
    <ul className="mt-6 grid gap-4 sm:grid-cols-2">
      {summaries.map((s) => (
        <li key={s.id}>
          <Link
            to="/summaries/$summaryId"
            params={{ summaryId: s.id }}
            className={cn(
              "group flex h-full gap-4 overflow-hidden rounded-3xl border border-border bg-card/80 p-4 transition",
              "hover:-translate-y-0.5 hover:border-primary/30",
            )}
          >
            <span className="relative h-24 w-24 shrink-0 overflow-hidden rounded-2xl bg-muted">
              {s.thumbUrl ? (
                <img
                  src={s.thumbUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-muted-foreground">
                  <ImageOff className="h-5 w-5" />
                </span>
              )}
            </span>

            <span className="flex min-w-0 flex-1 flex-col">
              <span className="flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-primary">
                <Sparkles className="h-3 w-3" strokeWidth={2.25} />
                AI Summary
              </span>
              <span className="mt-1 line-clamp-2 font-display text-lg font-bold leading-tight tracking-tight text-foreground">
                {s.title}
              </span>
              <span className="mt-1 text-xs font-bold text-muted-foreground">
                {relativeTime(s.createdAt)} · {s.photoCount}{" "}
                {s.photoCount === 1 ? "photo" : "photos"}
              </span>

              <span className="mt-auto flex flex-wrap items-center gap-2 pt-2">
                {/* Which of the two artefacts this one came from. A summary
                    with no walk behind it says nothing rather than implying a
                    recording that does not exist. */}
                {s.walkthroughId && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                    <Clapperboard className="h-3 w-3" strokeWidth={2.25} />
                    From a walkthrough
                  </span>
                )}
                {s.shareToken && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-emerald-600">
                    <Share2 className="h-3 w-3" strokeWidth={2.25} />
                    Shared
                  </span>
                )}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
