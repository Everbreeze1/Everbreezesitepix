import type { ComponentType, ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SURFACE_CARD, SURFACE_CARD_INTERACTIVE } from "@/components/ui/surface";
import { SaveStatus } from "@/components/builder/builder-ui";
import type { SaveState } from "@/components/builder/use-autosave";
import { cn } from "@/lib/utils";
import { TONES, type RunTone } from "./runner-tokens";

/**
 * Shared chrome for the two in-project runners — Checklists and Workflows.
 *
 * The template designers were rebuilt against one language
 * (`@/components/builder/builder-ui`); the screens where crews actually *use*
 * those templates were not, and they had drifted into two different products
 * bolted onto one tab bar. Checklists painted status with six hardcoded hex
 * values; Workflows painted cards dark/blue/light by `index % 3`, so colour
 * carried position instead of meaning and one variant used the sidebar's
 * pinned-navy token — invisible against a dark page.
 *
 * These primitives fix the root cause rather than the symptoms: there is
 * exactly one place that decides what "in progress" looks like, and the pill,
 * the icon tile and the progress bar physically cannot disagree about it.
 */

/* ------------------------------------------------------------------ header */

/**
 * The heading for a project-detail panel.
 *
 * Checklists and Workflows each hand-rolled this and drifted apart — one at a
 * fixed `text-[40px]` that overflows a 360px phone, one at `text-4xl sm:text-5xl`,
 * with eyebrow tracking rounded to `1.52px` in one and `1.5232px` in the other.
 * One component, one responsive scale, both panels.
 *
 * The scale deliberately matches the sibling panels (Tasks, Documents) rather
 * than shrinking to `SectionHeading` — a heading that changes size as you move
 * along the tab bar is its own kind of unfinished.
 */
export function RunnerPanelHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end sm:gap-5">
      <div className="min-w-0">
        <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
          {eyebrow}
        </p>
        <h2 className="font-display mt-2.5 text-[32px] font-bold leading-none tracking-[-1.2px] text-foreground sm:text-[40px] sm:tracking-[-1.68px] lg:text-[48px]">
          {title}
        </h2>
        <p className="font-manrope mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */

export function RunnerStatusPill({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: RunTone;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 font-manrope text-[10px] font-extrabold uppercase tracking-wide",
        TONES[tone].pill,
        className,
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

/**
 * One progress bar for the whole feature.
 *
 * Hand-rolled rather than the shadcn `Progress` because the fill has to carry
 * tone, and because a bar reporting compliance progress needs to announce
 * itself to a screen reader — the previous two implementations were
 * decorative `<div>`s with no role and no value.
 */
export function RunnerProgress({
  done,
  total,
  tone,
  label,
  className,
}: {
  done: number;
  total: number;
  tone: RunTone;
  /** Accessible name, e.g. "Roof inspection progress". */
  label: string;
  className?: string;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-valuetext={`${done} of ${total} complete`}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
    >
      <div
        className={cn("h-full rounded-full transition-[width] duration-300", TONES[tone].bar)}
        // A 0% bar with a visible sliver reads as "started"; keep it truly
        // empty until something is actually done.
        style={{ width: pct === 0 ? "0%" : `${Math.max(3, pct)}%` }}
      />
    </div>
  );
}

/** A single fact in a header — count of phases, steps, sign-offs. */
export function RunnerStat({
  icon: Icon,
  tone,
  children,
}: {
  icon?: ComponentType<{ className?: string }>;
  tone?: RunTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11.5px] font-semibold",
        tone ? TONES[tone].text : "text-muted-foreground",
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------- cards */

export function RunnerGrid({ children }: { children: ReactNode }) {
  return <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</ul>;
}

/**
 * The one card shape for "a thing being run on this project".
 *
 * Whole-card button: on a phone, a 12px "Open workflow →" text link at the
 * bottom of a card is a miss waiting to happen, and the checklist grid had
 * already settled on making the entire card the target.
 */
export function RunnerCard({
  icon: Icon,
  tone,
  title,
  statusLabel,
  meta,
  detail,
  done,
  total,
  progressLabel,
  onOpen,
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: RunTone;
  title: string;
  /**
   * Optional. Omit it when the progress bar and `meta` already say the same
   * thing — a card that reports "In progress", "3 of 8 items complete" and a
   * 37%-filled bar is three renderings of two integers, which is most of what
   * made these grids read as generated rather than designed.
   */
  statusLabel?: string;
  /** One line of counts under the title. */
  meta: ReactNode;
  /** Optional richer body — a next-step line, a phase pipeline. */
  detail?: ReactNode;
  done: number;
  total: number;
  progressLabel: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          SURFACE_CARD_INTERACTIVE,
          "flex h-full w-full flex-col rounded-[22px] p-5 text-left",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <span
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              TONES[tone].tile,
            )}
          >
            <Icon className="h-5 w-5" strokeWidth={1.75} />
          </span>
          {statusLabel && <RunnerStatusPill tone={tone}>{statusLabel}</RunnerStatusPill>}
        </div>

        <p className="mt-5 line-clamp-2 font-manrope text-base font-extrabold leading-snug text-foreground">
          {title}
        </p>
        <p className="mt-1.5 font-manrope text-[11.5px] font-semibold text-muted-foreground">
          {meta}
        </p>

        {/* Pushed to the bottom so cards of differing body length still line
            their progress bars up across the row. */}
        <div className="mt-auto w-full pt-5">
          {detail}
          <RunnerProgress
            done={done}
            total={total}
            tone={tone}
            label={progressLabel}
            className={detail ? "mt-4" : undefined}
          />
        </div>
      </button>
    </li>
  );
}

/** Placeholder cards with the real geometry, so the grid doesn't jump. */
export function RunnerCardSkeleton() {
  return (
    <li>
      <Card className={cn(SURFACE_CARD, "flex h-full flex-col rounded-[22px] p-5")}>
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="mt-5 h-4 w-3/4" />
        <Skeleton className="mt-2 h-3 w-1/2" />
        <Skeleton className="mt-auto h-2 w-full rounded-full" />
      </Card>
    </li>
  );
}

/* ------------------------------------------------------------------ detail */

/**
 * The card a run is edited inside.
 *
 * Deliberately NOT `overflow-hidden`. The header inside it is `position: sticky`
 * against the page scroll, and `overflow: hidden` on any ancestor silently
 * turns that ancestor into the sticky container — the header would scroll away
 * with the card instead of holding the workflow name, progress and save state
 * in view while you work down a long list of phases. The header rounds its own
 * top corners instead, which is what the clip was there for.
 */
export function RunnerDetailShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <Card className={cn(SURFACE_CARD, "mt-6 p-0", className)}>{children}</Card>;
}

/**
 * Sticky detail header: identity, live counts, save state and actions in one
 * bar that stays put while you scroll a long run.
 *
 * Deliberately the same shape as the designer's `BuilderTitleBar` — the crew
 * filling a workflow in and the manager who authored it should recognise the
 * same screen.
 */
export function RunnerDetailHeader({
  icon: Icon,
  tone,
  title,
  description,
  stats,
  actions,
  saveState,
  onBack,
  backLabel,
  done,
  total,
  progressLabel,
  banner,
}: {
  icon: ComponentType<{ className?: string }>;
  tone: RunTone;
  title: string;
  description?: string | null;
  stats: ReactNode;
  actions?: ReactNode;
  saveState: SaveState;
  onBack: () => void;
  backLabel: string;
  done: number;
  total: number;
  progressLabel: string;
  banner?: ReactNode;
}) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    // top-[82px] clears the app header (AppHeader is `sticky top-0 h-[82px]`,
    // and the page itself is the scroll container). z-10 keeps this under it.
    <div className="sticky top-[82px] z-10 rounded-t-2xl border-b border-border/60 bg-gradient-to-b from-card via-card to-card/95 px-4 pb-3 pt-3.5 backdrop-blur sm:px-6">
      <button
        type="button"
        onClick={onBack}
        className="mb-2.5 -ml-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-[11.5px] font-extrabold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      >
        <ChevronLeft className="h-4 w-4" />
        {backLabel}
      </button>

      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
            TONES[tone].tile,
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display truncate text-[22px] font-bold leading-tight tracking-[-0.6px] text-foreground sm:text-[26px]">
            {title}
          </h3>
          {description && (
            <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{stats}</div>
        <div className="ml-auto">
          <SaveStatus state={saveState} />
        </div>
      </div>

      <div className="mt-2 flex items-center gap-2.5">
        <RunnerProgress
          done={done}
          total={total}
          tone={tone}
          label={progressLabel}
          className="flex-1"
        />
        <span className="shrink-0 text-[11.5px] font-bold tabular-nums text-muted-foreground">
          {pct}%
        </span>
      </div>

      {banner}
    </div>
  );
}
