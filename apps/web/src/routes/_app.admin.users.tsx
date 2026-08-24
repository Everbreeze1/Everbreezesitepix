import { createFileRoute } from "@tanstack/react-router";
import { AdminUsersPage } from "@/features/admin/pages/AdminUsersPage";

export const Route = createFileRoute("/_app/admin/users")({
  head: () => ({ meta: [{ title: "Admin - Users - Everlumen" }] }),
  component: AdminUsersPage,
});
