import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageLoaderProps {
  label?: string;
  fullScreen?: boolean;
  className?: string;
}

export function PageLoader({ label = "Loading", fullScreen, className }: PageLoaderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 text-sm text-muted-foreground",
        fullScreen ? "min-h-screen bg-background" : "py-16",
        className,
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      <span>{label}…</span>
    </div>
  );
}
