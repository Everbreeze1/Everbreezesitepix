import { AlertTriangle, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
  variant?: "card" | "plain";
}

export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. Please try again.",
  onRetry,
  className,
  variant = "card",
}: ErrorStateProps) {
  const inner = (
    <div className="flex flex-col items-center text-center">
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" size="sm" className="mt-5">
          <RefreshCw className="mr-2 h-4 w-4" />
          Try again
        </Button>
      )}
    </div>
  );

  // Matches EmptyState: the caller's className spaces the component, it does
  // not pad the component's insides.
  if (variant === "plain") return <div className={className}>{inner}</div>;

  return <Card className={cn("flex flex-col items-center p-10 md:p-12", className)}>{inner}</Card>;
}
