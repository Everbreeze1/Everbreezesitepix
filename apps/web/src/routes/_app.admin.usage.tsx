import { createFileRoute } from "@tanstack/react-router";
import { AdminUsagePage } from "@/features/admin/pages/AdminUsagePage";

export const Route = createFileRoute("/_app/admin/usage")({
  head: () => ({ meta: [{ title: "Admin - Usage - Everlumen" }] }),
  component: AdminUsagePage,
});
