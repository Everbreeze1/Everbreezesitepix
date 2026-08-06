import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { Check, ChevronLeft, GripVertical, Loader2, Search, TriangleAlert } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { quietFieldClass } from "./builder-tokens";
import type { SaveState } from "./use-autosave";

/** These screens are server-rendered; useLayoutEffect warns if it runs there. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Shared chrome for the template designers (checklists, workflows).
 *
 * Both builders used to be a wall of borderless inputs sitting on a flat card:
 * nothing looked editable until you clicked it, controls for a single row were
 * strung across one cramped line, and the only reordering tool was "delete it
 * and add it again in the right place". These primitives give both screens the
 * same, deliberately physical editing surface — fields that announce
 * themselves, rows you can grab, and one status line that tells the truth.
 */

/* ------------------------------------------------------------------ layout */

/**
 * Two-pane builder. Desktop shows list + canvas side by side; small screens
 * show one at a time, driven by `pane`, so the editor gets the full width
 * instead of being buried under a stack of template buttons.
 */
export function BuilderLayout({
  rail,
  canvas,
  pane,
}: {
  rail: ReactNode;
  canvas: ReactNode;
  pane: "list" | "editor";
}) {
  return (
    <div className="mt-6 gap-5 md:grid md:grid-cols-[minmax(0,272px)_minmax(0,1fr)] md:items-start">
      <div className={cn("md:sticky md:top-4 md:block", pane === "list" ? "block" : "hidden")}>
        {rail}
      </div>
      <div className={cn("min-w-0 md:block", pane === "editor" ? "block" : "hidden")}>{canvas}</div>
    </div>
  );
}

/** Back-to-list affordance shown only on the mobile single-pane layout. */
export function BuilderBackToList({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-3 inline-flex items-center gap-1 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground md:hidden"
    >
      <ChevronLeft className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/* -------------------------------------------------------------------- rail */

export function BuilderRail({
  label,
  search,
  onSearchChange,
  searchPlaceholder = "Search…",
  showArchived,
  onToggleArchived,
  children,
  footer,
}: {
  label: string;
  search: string;
  onSearchChange: (v: string) => void;
  searchPlaceholder?: string;
  showArchived: boolean;
  onToggleArchived: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className={cn(SURFACE_CARD, "overflow-hidden p-0")}>
      <div className="border-b border-border/60 px-3 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2 px-0.5 pb-2">
          <span className="font-manrope text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-muted-foreground">
            {label}
          </span>
          <button
            type="button"
            className="text-[11px] font-bold text-muted-foreground transition-colors hover:text-foreground"
            onClick={onToggleArchived}
          >
            {showArchived ? "Hide archived" : "Archived"}
          </button>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 w-full rounded-lg border border-border/70 bg-muted/30 pl-8 pr-2 text-xs outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-primary/40 focus:bg-background focus:ring-2 focus:ring-primary/15"
          />
        </div>
      </div>
      <ul className="max-h-[min(60vh,520px)] space-y-0.5 overflow-y-auto p-2 md:max-h-[calc(100vh-14rem)]">
        {children}
      </ul>
      {footer && <div className="border-t border-border/60 p-2">{footer}</div>}
    </Card>
  );
}

export function BuilderRailItem({
  active,
  name,
  meta,
  archived,
  onSelect,
}: {
  active: boolean;
  name: string;
  meta: ReactNode;
  archived?: boolean;
  onSelect: () => void;
}) {
  return (
    <li className="relative">
      {active && (
        <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-primary" aria-hidden />
      )}
      <button
        type="button"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left transition-colors",
          active ? "bg-primary/[0.07]" : "hover:bg-muted/60",
        )}
      >
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm",
              active ? "font-bold text-foreground" : "font-medium",
            )}
          >
            {name || "Untitled"}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{meta}</span>
        </span>
        {archived && (
          <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-muted-foreground">
            Arch
          </span>
        )}
      </button>
    </li>
  );
}

/* ------------------------------------------------------------------ canvas */

export function BuilderCanvas({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <Card className={cn(SURFACE_CARD, "overflow-hidden p-0", className)}>{children}</Card>;
}

/**
 * Sticky editor header: the template's identity, its live stats, the save
 * state, and the destructive-ish actions — all in one bar that stays put while
 * you scroll a long template, so "did that save?" is never a scroll away.
 */
export function BuilderTitleBar({
  icon,
  title,
  description,
  stats,
  actions,
  saveState,
  onTitleChange,
  onDescriptionChange,
  titlePlaceholder = "Untitled",
  descriptionPlaceholder = "Add a description…",
  banner,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  stats: ReactNode;
  actions: ReactNode;
  saveState: SaveState;
  onTitleChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  titlePlaceholder?: string;
  descriptionPlaceholder?: string;
  banner?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-20 border-b border-border/60 bg-gradient-to-b from-card via-card to-card/95 px-4 pb-3 pt-4 backdrop-blur sm:px-6 sm:pt-5">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <QuietInput
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder={titlePlaceholder}
            aria-label="Template name"
            className="font-display text-[26px] font-bold leading-tight tracking-[-0.7px] sm:text-[30px]"
          />
          <QuietTextarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={descriptionPlaceholder}
            aria-label="Template description"
            className="mt-0.5 text-[13px] text-muted-foreground"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1">{actions}</div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-12">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{stats}</div>
        <div className="ml-auto">
          <SaveStatus state={saveState} />
        </div>
      </div>
      {banner}
    </div>
  );
}

export function StatChip({
  icon: Icon,
  children,
}: {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

export function SaveStatus({ state }: { state: SaveState }) {
  if (state === "saving")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Saving…
      </span>
    );
  if (state === "error")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2 py-0.5 text-[11.5px] font-bold text-destructive">
        <TriangleAlert className="h-3.5 w-3.5" />
        Not saved — check your connection
      </span>
    );
  if (state === "saved")
    return (
      <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
        <Check className="h-3.5 w-3.5" />
        Saved
      </span>
    );
  return (
    <span className="text-[11.5px] font-semibold text-muted-foreground/80">
      Changes save automatically
    </span>
  );
}

/* ------------------------------------------------------------------ fields */

export const QuietInput = forwardRef<HTMLInputElement, ComponentProps<"input">>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(quietFieldClass, "text-sm", className)} {...props} />
  ),
);
QuietInput.displayName = "QuietInput";

/** Textarea that grows with its content — no scrollbars inside a one-line note. */
export const QuietTextarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(
  ({ className, value, ...props }, ref) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    const resize = () => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "0px";
      el.style.height = `${el.scrollHeight}px`;
    };
    useIsomorphicLayoutEffect(resize, [value]);
    useEffect(() => {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }, []);
    return (
      <textarea
        ref={(node) => {
          innerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) (ref as { current: HTMLTextAreaElement | null }).current = node;
        }}
        rows={1}
        value={value}
        onInput={resize}
        className={cn(
          quietFieldClass,
          "resize-none overflow-hidden text-sm leading-snug",
          className,
        )}
        {...props}
      />
    );
  },
);
QuietTextarea.displayName = "QuietTextarea";

/* ------------------------------------------------------------------- parts */

export function DragHandle({
  className,
  ...props
}: ComponentProps<"button"> & { className?: string }) {
  return (
    <button
      type="button"
      aria-label="Drag to reorder"
      className={cn(
        "flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/40 transition-opacity hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 active:cursor-grabbing",
        // Hidden until the row is hovered or the handle is tabbed to; always
        // visible on touch, where there is no hover to reveal it.
        "opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-60",
        className,
      )}
      {...props}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
}

/** A dashed "add something here" target — the row-level counterpart to EmptyState. */
export function AddTarget({
  children,
  onClick,
  className,
}: {
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border bg-transparent px-3 py-2.5 text-xs font-bold text-muted-foreground transition-colors hover:border-primary/45 hover:bg-primary/[0.04] hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

/**
 * A required/optional toggle that reads at a glance. A bare Switch next to the
 * abbreviation "Req." told you nothing about which state you were looking at.
 */
export function RequiredToggle({
  required,
  onToggle,
  className,
}: {
  required: boolean;
  onToggle: (next: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onToggle(!required)}
      aria-pressed={required}
      title={required ? "Required — crews can't finish without it" : "Optional"}
      className={cn(
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide transition-colors",
        required
          ? "border-amber-500/40 bg-amber-500/12 text-amber-700 dark:text-amber-300"
          : "border-border bg-transparent text-muted-foreground/70 hover:border-amber-500/40 hover:text-amber-600 dark:hover:text-amber-300",
        className,
      )}
    >
      {required ? "Required" : "Optional"}
    </button>
  );
}
