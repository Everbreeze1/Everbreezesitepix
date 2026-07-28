import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "@/features/notifications/pages/NotificationsPage";

export const Route = createFileRoute("/_app/notifications")({
  head: () => ({ meta: [{ title: "Notifications — SitePix" }] }),
  component: NotificationsPage,
});
