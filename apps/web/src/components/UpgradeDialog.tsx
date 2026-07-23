import { Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: string;
  description?: string;
  /** Suggested plan to upgrade to, defaults to Pro. */
  recommendedPlan?: "pro" | "team";
}

/**
 * Shown when a user tries to use a gated feature (Walkthroughs, Watermark,
 * Team collaboration, long videos, premium voice, etc.).
 */
export function UpgradeDialog({
  open,
  onOpenChange,
  feature,
  description,
  recommendedPlan = "pro",
}: Props) {
  const planLabel = recommendedPlan === "team" ? "Team" : "Pro";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Unlock {feature}</DialogTitle>
          <DialogDescription className="text-center">
            {description ??
              `${feature} is included in the ${planLabel} plan. Upgrade to unlock it for your projects.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button asChild onClick={() => onOpenChange(false)}>
            <Link to="/pricing">See plans</Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
