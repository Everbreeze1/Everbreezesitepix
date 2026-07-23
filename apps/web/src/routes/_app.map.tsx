import { createFileRoute } from "@tanstack/react-router";
import { MapPage } from "@/features/projects/pages/MapPage";

export const Route = createFileRoute("/_app/map")({
  head: () => ({ meta: [{ title: "Project Map — Everbreeze SitePix" }] }),
  component: MapPage,
});
