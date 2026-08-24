import { createFileRoute } from "@tanstack/react-router";
import { AdminNotificationsPage } from "@/features/admin/pages/AdminNotificationsPage";

export const Route = createFileRoute("/_app/admin/notifications")({
  head: () => ({ meta: [{ title: "Admin - Notifications - Everlumen" }] }),
  component: AdminNotificationsPage,
});
