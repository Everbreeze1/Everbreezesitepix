import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/*
 * Shared primitives for the Main-html design reference.
 *
 * The mockups in apps/web/public/Main-html define a precise page language:
 * a 32px/40px inset on a 1200px column, 24px / 700 titles, 13.5px muted
 * subtitles, 13px-radius surface cards with a 1px border, 11px chips on a
 * secondary fill, rounded-full status pills with soft tints, 2.5px underline
 * tabs, and uppercase letter-spaced eyebrow labels. These constants carry
 * exactly those values into the Tailwind codebase so every screen reads as
 * one product instead of each page hand-rolling its own numbers.
 */

/** Page scaffold: the mockup pages sit on a 32px top / 40px side+bottom inset, capped at 1200px. */
export const REFERENCE_PAGE = "mx-auto w-full max-w-[1200px] px-6 pb-10 pt-8 sm:px-10";

/** Page title: 24px / 700 / -0.01em tracking, as in "Blueprints", "Projects". */
export const REFERENCE_TITLE = "text-2xl font-bold tracking-[-0.01em] text-foreground";

/** Page subtitle: 13.5px muted copy under the title. */
export const REFERENCE_SUBTITLE = "text-[13.5px] leading-snug text-muted-foreground";

/** Card body: 13px radius, 1px border, surface fill (mockup .bp-card / .doc-card / .cl-card). */
export const REFERENCE_CARD =
  "rounded-[13px] border border-border bg-card transition-colors hover:border-primary/70";

/** Card with the mockup's poised hover (border turns accent). */
export const REFERENCE_CARD_INTERACTIVE = cn(REFERENCE_CARD, "cursor-pointer");

/** Mockup card padding: 20px for a card body, 18px for a row. */
export const REFERENCE_CARD_PADDING = "p-5";

/** Small muted meta line at the foot of a card (used on "X projects"). */
export const REFERENCE_CARD_META = "border-t border-border pb-0.5 pt-3 text-xs text-faint";

/** Chip: 11px muted on a secondary fill (mockup .chip). */
export const REFERENCE_CHIP =
  "inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground";

/** Eyebrow / section label: 12px / 600 faint uppercase (mockup section headers). */
export const REFERENCE_EYEBROW =
  "text-xs font-semibold uppercase tracking-[0.05em] text-faint";

/** Primary action button: amber pill, 9px radius (mockup "New blueprint"). */
export const REFERENCE_BUTTON_PRIMARY =
  "inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-[13.5px] font-semibold text-primary-foreground";

/** Secondary action: 1px border, no fill (mockup Cancel / Edit template). */
export const REFERENCE_BUTTON_SECONDARY =
  "inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-[13px] font-semibold text-muted-foreground";

/** Mono count used beside titles and chips (Space Mono numerals). */
export const REFERENCE_MONO = "font-mono text-[11px] text-faint";

/**
 * Status pill, the round badge every list screen shares. `tone` maps to the
 * same active / hold / complete / archived hues as the mockup.
 */
export function ReferencePill({
  tone,
  children,
  className,
}: {
  tone: "active" | "hold" | "complete" | "archived" | "review";
  children: ReactNode;
  className?: string;
}) {
  const cls = {
    active: "bg-status-active-soft text-status-active",
    hold: "bg-status-hold-soft text-status-hold",
    complete: "bg-status-complete-soft text-status-complete",
    archived: "bg-status-archived-soft text-status-archived",
    review: "bg-status-complete-soft text-status-complete",
  }[tone];
  return (
    <span
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        cls,
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Page hero: title + subtitle on the left, primary action on the right. */
export function ReferenceHero({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-4", className)}>
      <div className="min-w-0 max-w-[560px]">
        <h1 className={REFERENCE_TITLE}>{title}</h1>
        {subtitle && <p className={cn(REFERENCE_SUBTITLE, "mt-1")}>{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-9">{actions}</div>}
    </div>
  );
}

/**
 * Underline tab strip, the mockup's `.tab` / `.tab.active`. Tabs are 14px / 600
 * with a 2.5px amber underline and the same 26px gap the mockup uses.
 */
export type ReferenceTabItem = { key: string; label: ReactNode };

export function ReferenceTabStrip({
  items,
  value,
  onChange,
  className,
}: {
  items: ReferenceTabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-[26px] overflow-x-auto border-b border-border", className)}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "shrink-0 whitespace-nowrap border-b-[2.5px] pb-2.5 pt-2.5 text-sm font-semibold transition-colors",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-faint hover:text-muted-foreground",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}