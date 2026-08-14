import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The app's house surface language, in one place.
 *
 * The product surfaces (Projects, Project detail, Project documents) were built
 * with a distinct look - larger corner radius, a long soft shadow, translucent
 * card fill, and a lift on hover. The Settings/Templates screens were built
 * later against plain shadcn defaults (`rounded-xl` + generic `shadow`), so
 * they read as a different product. These tokens let those screens adopt the
 * house style without each one re-deriving the magic numbers.
 */
export const SURFACE_CARD =
  "rounded-2xl border border-border bg-card/80 shadow-[0px_16px_32px_-28px_rgba(16,25,41,0.6)]";

/** Same, plus the hover lift used by clickable cards in the projects grid. */
export const SURFACE_CARD_INTERACTIVE = cn(
  SURFACE_CARD,
  "transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0px_24px_44px_-30px_rgba(16,25,41,0.55)]",
);

/** Compact button sizing used across product toolbars. */
export const SURFACE_BUTTON = "h-8 gap-2 rounded-lg px-4 text-xs font-bold";

/**
 * A section title inside a page that already has a `PageHeader` - the uppercase
 * micro-eyebrow plus display-font heading used by Project documents, scaled
 * down so it reads as a section rather than competing with the page title.
 */
export function SectionHeading({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow && (
          <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h2
          className={cn(
            "font-display text-2xl font-bold leading-none tracking-[-0.9px] text-foreground",
            eyebrow && "mt-2.5",
          )}
        >
          {title}
        </h2>
        {description && (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
