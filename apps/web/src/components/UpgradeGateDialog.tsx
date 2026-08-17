import { Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";

/** Single shared "you need a subscription for this" dialog, driven by
 * SubscriptionGateProvider - rendered once at the app layout level so any
 * page can gate an action via useSubscriptionGate().guard(fn) without each
 * page owning its own dialog instance. */
export function UpgradeGateDialog() {
  const { gateState, closeGate } = useSubscriptionGate();

  return (
    <Dialog open={gateState.open} onOpenChange={(open) => !open && closeGate()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            Subscribe to unlock this
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {gateState.reason ?? "This action needs an active plan."} Choose a plan to keep creating
          and uploading - you can keep browsing your existing projects for free.
        </p>
        <Button asChild className="w-full">
          <Link to="/pricing" onClick={closeGate}>
            View plans
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}
