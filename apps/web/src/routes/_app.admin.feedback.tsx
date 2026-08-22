import { createFileRoute } from "@tanstack/react-router";
import { AdminFeedbackPage } from "@/features/admin/pages/AdminFeedbackPage";

export const Route = createFileRoute("/_app/admin/feedback")({
  head: () => ({ meta: [{ title: "Admin - Feedback - SitePix" }] }),
  component: AdminFeedbackPage,
});
