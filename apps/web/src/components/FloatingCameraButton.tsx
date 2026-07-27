import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Camera } from "lucide-react";
import { useLastProjectId } from "@/hooks/use-last-project";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";
import { cn } from "@/lib/utils";

/**
 * Persistent floating action button that opens the camera for the active
 * (most-recently-visited) project. Hidden on routes where it would be
 * redundant or distracting (camera dialogs, auth pages, project creation).
 */
export function FloatingCameraButton() {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const lastProjectId = useLastProjectId();
  const { guard } = useSubscriptionGate();

  // Hide on routes where a camera FAB would be noisy or duplicated. Also hide
  // on individual project detail pages because the page already renders its own
  // camera floating button with upload / video options.
  const isProjectDetailPage =
    pathname.startsWith("/projects/") &&
    pathname !== "/projects/new" &&
    pathname.split("/").filter(Boolean).length === 2;

  const hidden =
    pathname.startsWith("/login") ||
    pathname.startsWith("/signup") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/invite") ||
    pathname.startsWith("/share/") ||
    pathname === "/projects/new" ||
    pathname.startsWith("/walkthroughs/") ||
    isProjectDetailPage;

  if (hidden) return null;

  // Visually stronger when there's an active project to shoot into.
  const onActiveProjectPage = !!lastProjectId && pathname === `/projects/${lastProjectId}`;

  const handleClick = () =>
    guard(() => {
      if (lastProjectId) {
        navigate({
          to: "/projects/$projectId",
          params: { projectId: lastProjectId },
          search: { camera: 1 } as any,
        });
      } else {
        // No active project yet — send to the new-project flow; user can shoot
        // immediately after creating it.
        navigate({ to: "/projects/new" });
      }
    }, "Subscribe to capture new photos.");

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={lastProjectId ? "Open camera" : "Create a project to start shooting"}
      className={cn(
        "fixed right-4 z-40 flex items-center justify-center rounded-full shadow-xl ring-4 ring-background transition active:scale-95",
        // Sit just above the mobile tab bar; lower on desktop.
        "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] md:bottom-6",
        onActiveProjectPage
          ? "h-16 w-16 bg-primary text-primary-foreground animate-fade-in"
          : "h-14 w-14 bg-primary/95 text-primary-foreground",
      )}
    >
      <Camera className={onActiveProjectPage ? "h-7 w-7" : "h-6 w-6"} />
      {onActiveProjectPage && (
        <span className="pointer-events-none absolute -inset-1 -z-10 rounded-full bg-primary/40 blur-md" />
      )}
    </button>
  );
}
