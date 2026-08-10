import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Retired. The company-wide timeline was the same day-by-day view of every
 * photo the gallery's calendar now gives you — with filters, a day panel you
 * can open photos from, and no Pro gate in front of it. The route stays as a
 * redirect so old links and bookmarks land somewhere sensible.
 */
export const Route = createFileRoute("/_app/timeline")({
  beforeLoad: () => {
    throw redirect({ to: "/gallery", search: { view: "calendar" }, replace: true });
  },
});
