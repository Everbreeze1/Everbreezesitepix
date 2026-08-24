import { createFileRoute } from "@tanstack/react-router";
import { AdminSecurityPage } from "@/features/admin/pages/AdminSecurityPage";

export const Route = createFileRoute("/_app/admin/security")({
  head: () => ({ meta: [{ title: "Admin - Security - Everlumen" }] }),
  component: AdminSecurityPage,
});
