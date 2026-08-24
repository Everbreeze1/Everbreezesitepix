import { createFileRoute } from "@tanstack/react-router";
import { AdminLayout } from "@/features/admin/pages/AdminLayout";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({ meta: [{ title: "Admin - Everlumen" }] }),
  component: AdminLayout,
});
