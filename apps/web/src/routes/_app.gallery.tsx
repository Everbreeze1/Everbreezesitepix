import { createFileRoute } from "@tanstack/react-router";
import { GalleryPage } from "@/features/gallery/pages/GalleryPage";

export type GallerySearch = {
  project?: string;
  photo?: string;
  /** Which of the gallery's two views to open on. Also where /timeline lands. */
  view?: "grid" | "calendar";
};

export const Route = createFileRoute("/_app/gallery")({
  head: () => ({ meta: [{ title: "Gallery - SitePix" }] }),
  validateSearch: (s: Record<string, unknown>): GallerySearch => ({
    project: typeof s.project === "string" ? s.project : undefined,
    photo: typeof s.photo === "string" ? s.photo : undefined,
    view: s.view === "calendar" || s.view === "grid" ? s.view : undefined,
  }),
  component: GalleryPage,
});
