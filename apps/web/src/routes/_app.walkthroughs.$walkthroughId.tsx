import { createFileRoute } from "@tanstack/react-router";
import { WalkthroughDetailPage } from "@/features/walkthroughs/pages/WalkthroughDetailPage";

export const Route = createFileRoute("/_app/walkthroughs/$walkthroughId")({
  head: () => ({ meta: [{ title: "Walkthrough — SitePix" }] }),
  component: WalkthroughDetailPage,
});
