import { createFileRoute } from "@tanstack/react-router";
import { GalleryPage } from "@/features/gallery/pages/GalleryPage";

export type GallerySearch = {
  project?: string;
  photo?: string;
  /** Which of the gallery's two views to open on. Also where /timeline lands. */
  view?: "grid" | "calendar";
  /** Seeds the search box. The global search palette's "Photos matching" lands here. */
  q?: string;
};

export const Route = createFileRoute("/_app/gallery")({
  head: () => ({ meta: [{ title: "Gallery - Everlumen" }] }),
  validateSearch: (s: Record<string, unknown>): GallerySearch => ({
    project: typeof s.project === "string" ? s.project : undefined,
    photo: typeof s.photo === "string" ? s.photo : undefined,
    view: s.view === "calendar" || s.view === "grid" ? s.view : undefined,
    q: typeof s.q === "string" && s.q.trim() ? s.q : undefined,
  }),
  component: GalleryPage,
});
