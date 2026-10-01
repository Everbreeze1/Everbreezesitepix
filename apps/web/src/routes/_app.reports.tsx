import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Retired from the navigation. Reports belong to a job, and each project's
 * own Reports tab is where they are made, opened and shared; a workspace-wide
 * list in the sidebar read as a second home for them. The route stays as a
 * redirect so old links and bookmarks land on the projects list rather than a
 * 404. Individual reports keep their own addresses under /projects/$projectId.
 */
export const Route = createFileRoute("/_app/reports")({
  beforeLoad: () => {
    throw redirect({ to: "/projects", replace: true });
  },
});
