import { createFileRoute } from "@tanstack/react-router";
import { HelpPage } from "@/features/settings/pages/HelpPage";

export const Route = createFileRoute("/_app/help")({
  head: () => ({ meta: [{ title: "Help Center — SitePix" }] }),
  component: HelpPage,
});
