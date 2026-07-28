import { createFileRoute } from "@tanstack/react-router";
import { ShowcasesListPage } from "@/features/showcases/pages/ShowcasesListPage";

export const Route = createFileRoute("/_app/showcases")({
  head: () => ({ meta: [{ title: "Showcases — SitePix" }] }),
  component: ShowcasesListPage,
});
