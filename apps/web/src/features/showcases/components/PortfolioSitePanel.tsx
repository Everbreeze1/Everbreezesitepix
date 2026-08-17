import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Save, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolioSiteDraft } from "@/features/showcases/site-draft";
import type { PortfolioDetail } from "@/lib/portfolio.functions";
import { HeroPickerDialog, SITE_STEPS, siteProgress, type StepCtx } from "./PortfolioSiteSteps";
import { PortfolioLivePreview } from "./PortfolioLivePreview";

/**
 * The site editor for someone who already built it and wants to change one
 * thing.
 *
 * Same seven steps as the guided build, minus the queue: a rail on the left,
 * one section on screen at a time, and the same live preview on the right. The
 * old version stacked all nineteen fields into one long scroll, which the
 * client called "very crowded… information scattered having to scroll down".
 * Nothing was removed to fix that - it is the same form, shown one answer at a
 * time, so finding the field you came for is a click instead of a hunt.
 *
 * Saving stays explicit, matching the showcase builder: a dirty flag derived
 * from a serialised snapshot and one Save. The guided build saves per step
 * because it is a queue you walk once; this is a desk you keep coming back to.
 */
export function PortfolioSitePanel({
  portfolio,
  onSaved,
  serviceTypes,
  projectCount,
  onStartGuided,
}: {
  portfolio: PortfolioDetail;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
  serviceTypes: string[];
  projectCount?: number;
  onStartGuided?: () => void;
}) {
  const site = usePortfolioSiteDraft(portfolio, onSaved);
  const ctx: StepCtx = { ...site, serviceTypes, layout: "editor", portfolio, onSaved };
  const { draft, dirty, saving, save } = site;
  const [activeId, setActiveId] = useState(SITE_STEPS[0].id);

  const index = Math.max(
    0,
    SITE_STEPS.findIndex((s) => s.id === activeId),
  );
  const step = SITE_STEPS[index];
  const Fields = step.Fields;
  const progress = siteProgress(draft, portfolio);

  // The wizard builds its own draft from the saved row, so anything unsaved
  // here has to be committed on the way out or it vanishes on the hand-off.
  const startGuided = async () => {
    if (!onStartGuided) return;
    if (dirty && !(await save({ quiet: true }))) return;
    onStartGuided();
  };

  return (
    <div className="space-y-6">
      {/* Sticky save bar - same affordance as the showcase builder, so "did
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

        <span className="hidden text-xs text-muted-foreground sm:inline">
          {progress.done} of {progress.total} sections filled in
        </span>

        <div className="ml-auto flex items-center gap-2">
          {onStartGuided && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void startGuided()}
              disabled={saving}
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Guided setup
            </Button>
          )}
          <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-3.5 w-3.5" />
            )}
            Save site
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)] xl:grid-cols-[200px_minmax(0,1fr)_320px]">
        {/* Rail. Horizontal and scrollable on a phone, where a column of eight
            rows would push the fields off the screen. */}
        <nav
          aria-label="Site sections"
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0"
        >
          {SITE_STEPS.map((s) => {
            const active = s.id === activeId;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveId(s.id)}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-bold transition lg:w-full",
                  active
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <s.icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{s.label}</span>
                {s.isDone(draft, portfolio) && (
                  <Check
                    className={cn(
                      "ml-auto hidden h-3.5 w-3.5 shrink-0 lg:block",
                      active ? "text-primary" : "text-emerald-600",
                    )}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="min-w-0">
          <section className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                <step.icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-balance text-base font-extrabold leading-tight text-foreground">
                  {step.question}
                </h2>
                <p className="mt-1 text-pretty text-xs text-muted-foreground">{step.hint}</p>
              </div>
            </div>

            <div className="mt-6 space-y-6">
              <Fields ctx={ctx} />
            </div>
          </section>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              disabled={index === 0}
              onClick={() => setActiveId(SITE_STEPS[index - 1].id)}
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {index === 0 ? "Back" : SITE_STEPS[index - 1].label}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={index === SITE_STEPS.length - 1}
              onClick={() => setActiveId(SITE_STEPS[index + 1].id)}
            >
              {index === SITE_STEPS.length - 1 ? "Next" : SITE_STEPS[index + 1].label}
              <ArrowRight className="ml-1.5 h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="hidden xl:block">
          <div className="sticky top-32">
            <p className="mb-2 text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
              Live preview
            </p>
            <PortfolioLivePreview
              draft={draft}
              heroPreview={site.heroPreview}
              focus={step.previewFocus}
              projectCount={projectCount}
              googleRating={portfolio.google_rating}
              googleReviewCount={portfolio.google_review_count}
            />
          </div>
        </div>
      </div>

      <HeroPickerDialog ctx={ctx} />
    </div>
  );
}
