import { createFileRoute } from "@tanstack/react-router";
import { AdminUserDetailPage } from "@/features/admin/pages/AdminUserDetailPage";

export const Route = createFileRoute("/_app/admin/users_/$userId")({
  head: () => ({ meta: [{ title: "Admin - User - Everlumen" }] }),
  component: AdminUserDetailPage,
});
