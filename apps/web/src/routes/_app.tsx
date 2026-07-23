import { createFileRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { AppHeader } from "@/components/AppHeader";
import { MobileTabBar } from "@/components/MobileTabBar";
import { FloatingCameraButton } from "@/components/FloatingCameraButton";
import { useAuth } from "@/hooks/use-auth";
import { OfflineIndicator } from "@/components/OfflineIndicator";
import { PageLoader } from "@/components/PageLoader";

export const Route = createFileRoute("/_app")({
  component: AppLayout,
});

function AppLayout() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/login", replace: true });
  }, [loading, user, navigate]);

  if (loading || !user) {
    return <PageLoader fullScreen />;
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
