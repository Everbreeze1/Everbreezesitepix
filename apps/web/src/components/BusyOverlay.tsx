import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface BusyOverlayProps {
  open: boolean;
  title?: string;
  description?: string;
  variant?: "upload" | "analyze";
}

/**
 * Full-screen polished spinner overlay for long-running tasks (uploads, analysis).
 * Pure presentational - render conditionally from a parent.
 */
export function BusyOverlay({
  open,
  title = "Working…",
  description,
  variant = "upload",
}: BusyOverlayProps) {
  if (!open) return null;
  const Icon = variant === "analyze" ? Sparkles : Loader2;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-background/70 backdrop-blur-sm"
    >
      <div className="mx-4 flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 shadow-2xl animate-scale-in">
        <div className="relative flex h-14 w-14 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
          <span className="absolute inset-1 rounded-full bg-primary/10" />
          <Icon
            className={cn(
              "relative h-7 w-7 text-primary",
              variant === "analyze" ? "animate-pulse" : "animate-spin",
            )}
          />
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold">{title}</p>
          {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
    </div>
  );
}
