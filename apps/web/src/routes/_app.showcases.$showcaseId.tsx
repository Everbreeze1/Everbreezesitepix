import { createFileRoute } from "@tanstack/react-router";
import { ShowcaseBuilderPage } from "@/features/showcases/pages/ShowcaseBuilderPage";

export const Route = createFileRoute("/_app/showcases/$showcaseId")({
  head: () => ({ meta: [{ title: "Edit Showcase — SitePix" }] }),
  component: ShowcaseBuilderPage,
});
