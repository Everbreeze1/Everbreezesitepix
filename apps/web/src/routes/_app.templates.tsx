import { createFileRoute } from "@tanstack/react-router";
import { TemplatesPage } from "@/features/settings/pages/TemplatesPage";

export const Route = createFileRoute("/_app/templates")({
  head: () => ({ meta: [{ title: "Templates — SitePix" }] }),
  component: TemplatesPage,
});
