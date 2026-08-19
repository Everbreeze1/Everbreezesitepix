import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { usePortfolioSiteDraft } from "@/features/showcases/site-draft";
import type { PortfolioDetail } from "@/lib/portfolio.functions";
import {
  HeroPickerDialog,
  SITE_STEPS,
  StepTrail,
  siteProgress,
  type StepCtx,
} from "./PortfolioSiteSteps";
import { PortfolioLivePreview } from "./PortfolioLivePreview";

/**
 * The site editor for someone who already built it and wants to change one
 * thing.
 *
 * Same steps as the guided build, minus the queue: the same trail across the
 * top, one section on screen at a time, and the same live preview beside it.
 * The old version stacked all nineteen fields into one long scroll, which the
 * client called "very crowded… information scattered having to scroll down".
 * Nothing was removed to fix that - it is the same form, shown one answer at a
 * time, so finding the field you came for is a click instead of a hunt.
 *
 * Saving stays explicit, matching the showcase builder: a dirty flag derived
 * from a serialised snapshot and one Save. The guided build saves per step
 * because it is a queue you walk once; this is a desk you keep coming back to.
 *
 * There is deliberately no "Guided setup" button here any more. Once this
 * screen grew the same trail, the same questions and the same ticks, that
 * button swapped you to a near-identical page - which is the "bolted together"
 * feeling the client kept naming, now with a control inviting you into it. The
 * guided build still exists and still opens by itself for a portfolio that has
 * not been started; it is a first run, not a mode you toggle.
 */
export function PortfolioSitePanel({
  portfolio,
  onSaved,
  serviceTypes,
  projectCount,
}: {
  portfolio: PortfolioDetail;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
  serviceTypes: string[];
  projectCount?: number;
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

      {/* The same trail the guided build draws, doing the same job.

          There used to be two of these: the wizard's stepper and this panel's
          own rail of eight rows, listing the same eight sections with the same
          ticks in a different shape. The client's read was exactly that - "there
          is a guided set up flow and there is a list that shows the same things
          kinda bolted together" - and that the guided steps were the half worth
          keeping. So the rail is gone and the trail is shared. The difference
          between the two screens is now what it should have been: the wizard
          walks you through in order, this one lets you jump straight to the
          section you came for. */}
      <StepTrail
        index={index}
        draft={draft}
        portfolio={portfolio}
        onJump={(i) => setActiveId(SITE_STEPS[i].id)}
        className="mt-2"
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_320px] 2xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="flex items-start gap-3.5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <step.icon className="h-[18px] w-[18px]" />
              </span>
              <div className="min-w-0">
                <h2 className="text-balance text-lg font-extrabold leading-tight text-foreground">
                  {step.question}
                </h2>
                <p className="mt-1.5 text-pretty text-sm text-muted-foreground">{step.hint}</p>
              </div>
            </div>

            <div className="mt-7 space-y-7">
              <Fields ctx={ctx} />
            </div>
          </section>

          {/* Named after where they go, and absent when there is nowhere to go.
              The last section used to end on a disabled button reading "Next",
              which reads as something broken rather than as the end of the
              list. Saving is the sticky bar's job on this screen, so the end of
              the sections needs no button at all. */}
          <div className="mt-4 flex items-center justify-between gap-3">
            {index > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveId(SITE_STEPS[index - 1].id)}
              >
                <ArrowLeft className="mr-1.5 h-4 w-4" />
                {SITE_STEPS[index - 1].label}
              </Button>
            ) : (
              <span />
            )}
            {index < SITE_STEPS.length - 1 ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setActiveId(SITE_STEPS[index + 1].id)}
              >
                {SITE_STEPS[index + 1].label}
                <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <span className="text-xs font-bold text-muted-foreground">
                That&rsquo;s every section
              </span>
            )}
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
