import { createFileRoute } from "@tanstack/react-router";
import { TimelinePage } from "@/features/timeline/pages/TimelinePage";

export const Route = createFileRoute("/_app/timeline")({
  head: () => ({ meta: [{ title: "Timeline — SitePix" }] }),
  component: TimelinePage,
});
