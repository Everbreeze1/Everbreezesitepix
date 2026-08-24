import { createFileRoute } from "@tanstack/react-router";
import { AdminAuditLogPage } from "@/features/admin/pages/AdminAuditLogPage";

export const Route = createFileRoute("/_app/admin/audit-log")({
  head: () => ({ meta: [{ title: "Admin - Audit log - Everlumen" }] }),
  component: AdminAuditLogPage,
});
