import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { FloatingCameraButton } from "@/components/FloatingCameraButton";
import { useAuth } from "@/hooks/use-auth";
import { useSubscription } from "@/hooks/use-subscription";
import { SubscriptionGateProvider } from "@/hooks/use-subscription-gate";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { UpgradeBanner } from "@/components/UpgradeBanner";
import { UpgradeGateDialog } from "@/components/UpgradeGateDialog";
import { PageLoader } from "@/components/PageLoader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

/** Just back from Stripe Checkout — the webhook needs a few seconds to
 * land, so quietly re-check subscription status a few times instead of
 * waiting for the user to navigate away and back. */
function useJustCheckedOut() {
  const [justCheckedOut] = useState(
    () => typeof window !== "undefined" && window.location.search.includes("checkout=success"),
  );
  return justCheckedOut;
}

function AppLayout() {
  const { user, loading } = useAuth();
  const { isActive, loading: subLoading, hasError: subErrored, retry: retrySub } = useSubscription();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const justCheckedOut = useJustCheckedOut();
  const [checkoutAttempts, setCheckoutAttempts] = useState(0);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", replace: true });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (loading || !user || subLoading || isActive || subErrored) return;
    if (!justCheckedOut || checkoutAttempts >= 6) return;
    const t = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["my-team"] });
      setCheckoutAttempts((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [loading, user, subLoading, isActive, subErrored, justCheckedOut, checkoutAttempts, qc]);

  if (loading || !user) {
    return <PageLoader fullScreen />;
  }

  if (subErrored) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <p className="text-sm font-medium text-foreground">Couldn't verify your subscription.</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          This is usually a temporary connection problem — try again.
        </p>
        <Button onClick={retrySub}>Retry</Button>
      </div>
    );
  }

  if (subLoading) {
    return <PageLoader fullScreen />;
  }

  return (
    <SubscriptionGateProvider>
      <SidebarProvider>
        <OfflineIndicator />
        <div className="min-h-screen flex w-full bg-background">
          <AppSidebar />
          <div className="flex-1 flex flex-col min-w-0 bg-background">
            {!isActive && (
              <UpgradeBanner activating={justCheckedOut && checkoutAttempts < 6} />
            )}
            <AppHeader />
            <main className="flex-1 min-w-0 pb-20 md:pb-0">
              <Outlet />
            </main>
            <MobileTabBar />
            <FloatingCameraButton />
          </div>
        </div>
        <UpgradeGateDialog />
      </SidebarProvider>
    </SubscriptionGateProvider>
  );
}
