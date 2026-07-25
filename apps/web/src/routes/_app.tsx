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
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { PageLoader } from "@/components/PageLoader";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

/** Just back from Stripe Checkout — give the webhook a few seconds to land
 * before bouncing the user to /pricing. */
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
    // A genuine failure to check the subscription is not the same as
    // "not subscribed" — don't bounce a real paying customer to /pricing
    // over a network blip. Show a retry state instead (below).
    if (loading || !user || subLoading || isActive || subErrored) return;
    if (!justCheckedOut || checkoutAttempts >= 6) {
      navigate({ to: "/pricing", replace: true });
      return;
    }
    const t = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["my-team"] });
      setCheckoutAttempts((n) => n + 1);
    }, 2000);
    return () => clearTimeout(t);
  }, [loading, user, subLoading, isActive, subErrored, justCheckedOut, checkoutAttempts, qc, navigate]);

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

  if (!subLoading && !isActive) {
    return (
      <PageLoader
        fullScreen
        label={justCheckedOut && checkoutAttempts < 6 ? "Activating your subscription" : "Redirecting"}
      />
    );
  }

  return (
    <SidebarProvider>
      <OfflineIndicator />
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0 bg-background">
          <AppHeader />
          <main className="flex-1 min-w-0 pb-20 md:pb-0">
            <Outlet />
          </main>
          <MobileTabBar />
          <FloatingCameraButton />
        </div>
      </div>
    </SidebarProvider>
  );
}
