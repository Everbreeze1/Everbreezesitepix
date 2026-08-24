import { createFileRoute } from "@tanstack/react-router";
import { AdminHealthPage } from "@/features/admin/pages/AdminHealthPage";

export const Route = createFileRoute("/_app/admin/health")({
  head: () => ({ meta: [{ title: "Admin - Health - Everlumen" }] }),
  component: AdminHealthPage,
});
