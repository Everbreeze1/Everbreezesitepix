import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { FloatingCameraButton } from "@/components/FloatingCameraButton";
import { FeedbackPrompt } from "@/components/FeedbackPrompt";
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

/** Just back from Stripe Checkout - the webhook needs a few seconds to
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
  const {
    isActive,
    loading: subLoading,
    hasError: subErrored,
    retry: retrySub,
  } = useSubscription();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const justCheckedOut = useJustCheckedOut();
  const [checkoutAttempts, setCheckoutAttempts] = useState(0);

  /*
   * Carry the destination across to /login.
   *
   * A bare `/login` is how a shared link became a dead end. The URL in an
   * owner's address bar while they are looking at a report or a summary is the
   * private one (`/projects/<id>/reports/<id>`, `/summaries/<id>`), not the
   * `/share/...` one, and that is the URL that gets pasted into a message to a
   * customer. The customer arrived here, got bounced to a sign-in form that
   * said nothing about where they had been going, and reported that the link
   * does not open. The owner clicking their own link fared no better: they
   * signed in and landed on the dashboard.
   *
   * `/login` already reads `?redirect=` and validates it (same-origin paths
   * only); it was simply never being told. The explanation the customer needs
   * lives there too, and only appears when this parameter is present.
   */
  useEffect(() => {
    if (loading || user) return;
    const here =
      typeof window === "undefined" ? "" : `${window.location.pathname}${window.location.search}`;
    const redirect = here.startsWith("/") && !here.startsWith("//") ? here : undefined;
    navigate({ to: "/login", search: redirect ? { redirect } : {}, replace: true });
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
          This is usually a temporary connection problem - try again.
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
            {!isActive && <UpgradeBanner activating={justCheckedOut && checkoutAttempts < 6} />}
            <AppHeader />
            {/* `flex flex-col` so a page can claim the height left under the
                header by asking for `flex-1`, without having to know how tall
                the header is - or whether the upgrade banner above it is
                showing, which changes that number per account. A page that
                does not ask still sizes to its own content, because a flex
                item's `min-height: auto` refuses to shrink below it. */}
            <main className="flex min-w-0 flex-1 flex-col pb-20 md:pb-0">
              <Outlet />
            </main>
            <MobileTabBar />
            <FloatingCameraButton />
            <FeedbackPrompt />
          </div>
        </div>
        <UpgradeGateDialog />
      </SidebarProvider>
    </SubscriptionGateProvider>
  );
}
