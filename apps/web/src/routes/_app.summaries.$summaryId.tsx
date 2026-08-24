import { createFileRoute } from "@tanstack/react-router";
import { SummaryDetailPage } from "@/features/walkthroughs/pages/SummaryDetailPage";

export const Route = createFileRoute("/_app/summaries/$summaryId")({
  // "the tab title 'Walkthrough,' even when there's no video" - this is the
  // other half of that fix. A summary is a Summary in the browser tab too.
  head: () => ({ meta: [{ title: "Summary - Everlumen" }] }),
  component: SummaryDetailPage,
});
