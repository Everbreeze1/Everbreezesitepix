import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface PageTabStripItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Omit or pass null to render the pill without a number. */
  count?: number | null;
}

/**
 * The product's page-level tab strip.
 *
 * The projects index and the project home page shipped character-identical
 * copies of this markup, and the client still read the two screens as different
 * products. A comment saying "the same control the project home page uses" is
 * not the same control — this is. Anything that should be true of both strips
 * gets changed here once.
 */
export function PageTabStrip({
  items,
  value,
  onChange,
  className,
}: {
  items: PageTabStripItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-x-auto rounded-2xl border border-border bg-card/80 p-2 shadow-[0px_16px_32px_-28px_rgba(16,25,41,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      <div className="flex min-w-max items-center gap-1">
        {items.map((item) => {
          const active = value === item.key;
          const Icon = item.icon;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onChange(item.key)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-xs font-extrabold transition",
                active
                  ? "bg-primary text-primary-foreground shadow-lg"
                  : "text-muted-foreground hover:bg-accent",
              )}
            >
              <span
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-lg",
                  active ? "bg-primary-foreground/20" : "bg-muted",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              {item.label}
              {item.count !== null && item.count !== undefined && (
                <span className={active ? "text-primary-foreground/70" : "text-muted-foreground"}>
                  {item.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
