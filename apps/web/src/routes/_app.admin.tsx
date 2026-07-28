import { createFileRoute } from "@tanstack/react-router";
import { AdminPage } from "@/features/admin/pages/AdminPage";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({ meta: [{ title: "Admin — SitePix" }] }),
  component: AdminPage,
});
