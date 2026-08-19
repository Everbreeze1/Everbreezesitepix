import { useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Layers,
  Loader2,
  PartyPopper,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
 * The guided build: one question a screen, saved as you go.
 *
 * Replaces filling in a nineteen-field page. Everything here is aimed at the
 * feeling the client asked for - "so the user feels like they are building
 * something fast":
 *
 *   - one prompt on screen at a time, phrased as a question, no scrolling;
 *   - the answer lands in a live preview of the real site, immediately;
 *   - Continue saves, so leaving halfway loses nothing and nobody hunts for a
 *     Save button;
 *   - Enter moves on, because the fastest path through a form is the keyboard;
 *   - every step past the third can be skipped, and the finish screen offers
 *     the skipped ones back rather than trapping anyone in a queue.
 *
 * The second pass over this screen was about air, not structure. The client's
 * note on the first version was "improve the look and feel... we can make this
 * set up page more spacious", and the crowding had three causes, all fixed
 * here: the guided step list was a strip of eight tight pills that scrolled
 * sideways, the question sat squashed into the top of the same card as the
 * fields, and the whole thing was a white card on a white page with nothing
 * separating them. So the trail is now a full-width numbered stepper, the
 * question is a page-sized heading above the card, and the page sits on a
 * tinted ground the card floats off.
 */
export function PortfolioSetupWizard({
  portfolio,
  serviceTypes,
  projectCount,
  published,
  publishing,
  onPublish,
  onSaved,
  onExit,
  onGoToProjects,
}: {
  portfolio: PortfolioDetail;
  serviceTypes: string[];
  projectCount: number;
  published: boolean;
  publishing: boolean;
  onPublish: (published: boolean) => void;
  onSaved: (patch: Partial<PortfolioDetail>) => void;
  onExit: () => void;
  onGoToProjects: () => void;
}) {
  const site = usePortfolioSiteDraft(portfolio, onSaved);
  const ctx: StepCtx = { ...site, serviceTypes, layout: "wizard", portfolio, onSaved };
  const { draft, dirty, save, saving } = site;

  // Resume where they stopped: the first unanswered step, not step one. A
  // returning contractor should never re-confirm their own business name.
  const [index, setIndex] = useState(() => {
    const first = SITE_STEPS.findIndex((s) => !s.isDone(draft, portfolio));
    return first === -1 ? SITE_STEPS.length : first;
  });
  const [furthest, setFurthest] = useState(index);
  const [everSaved, setEverSaved] = useState(false);
  const topRef = useRef<HTMLDivElement | null>(null);

  const done = index >= SITE_STEPS.length;
  const step = done ? null : SITE_STEPS[index];
  const progress = siteProgress(draft, portfolio);

  const goTo = (next: number) => {
    setIndex(next);
    setFurthest((f) => Math.max(f, next));
    topRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  };

  /** Saves whatever changed, then moves. A failed save keeps you on the step. */
  const commitAnd = async (next: number) => {
    if (dirty) {
      const ok = await save({ quiet: true });
      if (!ok) return;
      setEverSaved(true);
    }
    goTo(next);
  };

  const exit = async () => {
    if (dirty) await save({ quiet: true });
    onExit();
  };

  const siteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/p/${draft.slug}`
      : `/p/${draft.slug}`;

  const missing = useMemo(
    () => SITE_STEPS.filter((s) => !s.isDone(draft, portfolio)),
    [draft, portfolio],
  );

  return (
    // A tinted ground under the whole build. The card was white on a white
    // page before, which is what made a screen with plenty of padding still
    // read as one undifferentiated sheet.
    <div className="min-h-full bg-muted/30 px-4 pb-32 pt-6 sm:px-8 sm:pt-10 lg:px-12">
      <div ref={topRef} className="mx-auto max-w-6xl scroll-mt-6">
        {/* ---- Header: where am I, and how do I get out ---- */}
        <header className="flex flex-wrap items-start gap-x-6 gap-y-4">
          <div className="min-w-0 flex-1">
            <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
              Build your site
            </p>
            <h1 className="mt-2 font-display text-[32px] font-bold leading-none tracking-[-1.1px] text-foreground sm:text-[38.4px] sm:tracking-[-1.344px]">
              {done ? "You're all set" : `Step ${index + 1} of ${SITE_STEPS.length}`}
            </h1>
            <p className="mt-3 font-manrope text-sm text-muted-foreground">
              {progress.done} of {progress.total} sections filled in. Everything saves as you go.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(dirty || saving || everSaved) && (
              <span
                className={cn(
                  "hidden items-center gap-1.5 text-xs font-bold sm:inline-flex",
                  dirty ? "text-amber-600" : "text-muted-foreground",
                )}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving
                  </>
                ) : dirty ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" /> Not saved yet
                  </>
                ) : (
                  <>
                    <Check className="h-3.5 w-3.5" /> Saved
                  </>
                )}
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              className="bg-card"
              onClick={() => void exit()}
              disabled={saving}
            >
              <X className="mr-1.5 h-4 w-4" /> Save and exit
            </Button>
          </div>
        </header>

        <StepTrail
          index={index}
          furthest={furthest}
          draft={draft}
          portfolio={portfolio}
          onJump={(i) => void commitAnd(i)}
        />

        {/* ---- The step itself ---- */}
        {/* The preview waits for xl. It used to appear at lg, where it left the
            form a 270px gutter and put a truncated site address next to a
            thumbnail nobody asked for yet. Below xl the questions get the whole
            width instead, which is the point of this pass. */}
        <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px] 2xl:gap-12">
          <div className="min-w-0">
            {step ? (
              <StepScreen
                key={step.id}
                ctx={ctx}
                step={step}
                index={index}
                saving={saving}
                onBack={index > 0 ? () => void commitAnd(index - 1) : undefined}
                onNext={() => void commitAnd(index + 1)}
              />
            ) : (
              <FinishScreen
                missing={missing.map((s) => ({ id: s.id, label: s.label }))}
                onJump={(id) => {
                  const i = SITE_STEPS.findIndex((s) => s.id === id);
                  if (i >= 0) goTo(i);
                }}
                published={published}
                publishing={publishing}
                onPublish={onPublish}
                siteUrl={siteUrl}
                onGoToProjects={() => void exit().then(onGoToProjects)}
                onEdit={() => onExit()}
              />
            )}
          </div>

          {/* Hidden on small screens on purpose: the point of this rewrite is to
              stop making people scroll, and on a phone the preview would sit a
              screen and a half below the field it is previewing. */}
          <div className="hidden xl:block">
            <div className="sticky top-24">
              <div className="mb-3 flex items-baseline justify-between gap-3">
                <p className="text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
                  Live preview
                </p>
                <span className="text-[11px] text-muted-foreground">Updates as you type</span>
              </div>
              <PortfolioLivePreview
                draft={draft}
                heroPreview={site.heroPreview}
                focus={step?.previewFocus}
                projectCount={projectCount}
                googleRating={portfolio.google_rating}
                googleReviewCount={portfolio.google_review_count}
                className="shadow-sm"
              />
            </div>
          </div>
        </div>
      </div>

      <HeroPickerDialog ctx={ctx} />
    </div>
  );
}

function StepScreen({
  ctx,
  step,
  index,
  saving,
  onBack,
  onNext,
}: {
  ctx: StepCtx;
  step: (typeof SITE_STEPS)[number];
  index: number;
  saving: boolean;
  onBack?: () => void;
  onNext: () => void;
}) {
  const Fields = step.Fields;
  const filled = step.isDone(ctx.draft, ctx.portfolio);

  return (
    // A real <form> rather than a div of inputs: it is what makes Enter advance
    // the step for free, while the tag inputs and the rich text editor keep
    // Enter for themselves because they already swallow the key.
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
    >
      {/* The question owns the page rather than a strip inside the card. That
          is most of what "more spacious" means here: asked at heading size,
          with the card below holding nothing but the answer. */}
      <div className="flex items-start gap-4">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <step.icon className="h-6 w-6" />
        </span>
        <div className="min-w-0">
          <h2 className="text-balance font-display text-[28px] font-bold leading-[1.05] tracking-[-0.8px] text-foreground sm:text-[34px]">
            {step.question}
          </h2>
          <p className="mt-2.5 max-w-xl text-pretty text-sm text-muted-foreground sm:text-base">
            {step.hint}
          </p>
        </div>
      </div>

      <div className="mt-7 rounded-3xl border border-border bg-card p-6 shadow-sm sm:p-9">
        <div className="space-y-8">
          <Fields ctx={ctx} />
        </div>
      </div>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack} disabled={saving}>
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {step.optional && !filled && (
            <Button type="button" variant="ghost" onClick={onNext} disabled={saving}>
              Skip for now
            </Button>
          )}
          <Button type="submit" size="lg" className="h-12 px-8" disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <ArrowRight className="mr-1.5 h-4 w-4" />
            )}
            {index === SITE_STEPS.length - 1 ? "Finish" : "Continue"}
          </Button>
        </div>
      </div>

      <p className="mt-3.5 text-right text-[11px] text-muted-foreground">
        Saved automatically as you go.
        {step.enterAdvances && " Press Enter to continue."}
      </p>
    </form>
  );
}

function FinishScreen({
  missing,
  onJump,
  published,
  publishing,
  onPublish,
  siteUrl,
  onGoToProjects,
  onEdit,
}: {
  missing: Array<{ id: string; label: string }>;
  onJump: (id: string) => void;
  published: boolean;
  publishing: boolean;
  onPublish: (published: boolean) => void;
  siteUrl: string;
  onGoToProjects: () => void;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(siteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
      toast.success("Link copied");
    } catch {
      toast.error("Could not copy the link");
    }
  };

  return (
    <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-sm sm:p-12">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
        <PartyPopper className="h-8 w-8" />
      </span>
      <h2 className="mt-6 text-balance font-display text-[30px] font-bold leading-none tracking-[-0.9px] text-foreground sm:text-[34px]">
        Your site is built
      </h2>
      <p className="mx-auto mt-3 max-w-md text-pretty text-sm text-muted-foreground sm:text-base">
        {published
          ? "It's live. Send the link to your next prospect."
          : "Publish it to get a shareable link, then add the projects that fill it."}
      </p>

      <div className="mx-auto mt-8 flex max-w-md items-center gap-2 rounded-xl border border-border bg-muted/40 p-2 pl-4">
        <span className="min-w-0 flex-1 truncate text-left text-sm font-bold text-foreground">
          {siteUrl}
        </span>
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="mt-7 flex flex-wrap justify-center gap-3">
        {!published ? (
          <Button
            type="button"
            size="lg"
            className="h-12 px-8"
            disabled={publishing}
            onClick={() => onPublish(true)}
          >
            {publishing ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-4 w-4" />
            )}
            Publish my site
          </Button>
        ) : (
          <Button type="button" size="lg" className="h-12 px-8" asChild>
            <a href={siteUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="mr-1.5 h-4 w-4" /> View my site
            </a>
          </Button>
        )}
        <Button
          type="button"
          size="lg"
          variant="outline"
          className="h-12 px-8"
          onClick={onGoToProjects}
        >
          <Layers className="mr-1.5 h-4 w-4" /> Add projects
        </Button>
      </div>

      {missing.length > 0 && (
        <div className="mx-auto mt-10 max-w-md rounded-2xl border border-dashed border-border p-5 text-left">
          <p className="text-xs font-bold text-foreground">
            {missing.length === 1 ? "One thing left" : `${missing.length} things left`}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Skipped, not lost. Each one makes the site read better to a prospect.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {missing.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => onJump(m.id)}
                className="rounded-full border border-dashed border-border px-3.5 py-2 text-xs font-bold text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onEdit}
        className="mt-9 text-xs font-bold text-muted-foreground underline-offset-4 hover:underline"
      >
        Open the full editor instead
      </button>
    </div>
  );
}
