import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  /** Small uppercase label above the title, e.g. "Workspace tools". */
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Renders a "← {backLabel}" link above everything else. */
  backTo?: string;
  backLabel?: string;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  backTo,
  backLabel = "Back",
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}
    >
      <div className="min-w-0">
        {backTo && (
          <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2 h-8">
            <Link to={backTo}>
              <ArrowLeft className="mr-1.5 h-4 w-4" />
              {backLabel}
            </Link>
          </Button>
        )}
        {eyebrow && (
          <p className="font-manrope text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1
          className={cn(
            "font-display text-[32px] font-bold leading-none tracking-[-1.1px] text-foreground sm:text-[38.4px] sm:tracking-[-1.344px]",
            eyebrow && "mt-3",
          )}
        >
          {title}
        </h1>
        {description && (
          <p className="mt-3 font-manrope text-sm text-muted-foreground sm:text-base">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
