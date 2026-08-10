import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  variant?: "card" | "plain";
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  variant = "card",
}: EmptyStateProps) {
  const inner = (
    <div className="flex flex-col items-center text-center">
      {Icon && (
        <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );

  // `className` belongs on whatever the caller actually sees. It used to land
  // on the inner stack even in card mode, so every `className="mt-6"` call site
  // was padding the inside of the card instead of spacing it from what's above.
  if (variant === "plain") return <div className={className}>{inner}</div>;

  return (
    <Card className={cn("flex flex-col items-center border-dashed p-10 md:p-12", className)}>
      {inner}
    </Card>
  );
}
