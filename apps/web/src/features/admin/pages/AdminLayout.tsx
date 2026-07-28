import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ShieldAlert, LayoutDashboard, Users, Bell, Building2, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import { checkIsPlatformAdmin } from "@/lib/admin.functions";

/** Add new admin sections here — nothing else needs to change to grow the admin area. */
const ADMIN_NAV = [
  { label: "Overview", to: "/admin", icon: LayoutDashboard },
  { label: "Users", to: "/admin/users", icon: Users },
  { label: "Teams", to: "/admin/teams", icon: Building2 },
  { label: "Notifications", to: "/admin/notifications", icon: Bell },
  { label: "Audit log", to: "/admin/audit-log", icon: ScrollText },
] as const;

export function AdminLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: adminCheck, isPending: checkingAdmin } = useQuery({
    queryKey: ["admin", "check"],
    queryFn: () => checkIsPlatformAdmin(),
  });
  const isAdmin = !!adminCheck?.isAdmin;

  if (checkingAdmin) {
    return (
      <div className="flex min-h-full items-center justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-3 p-10 text-center">
        <ShieldAlert className="h-10 w-10 text-muted-foreground" />
        <h1 className="text-lg font-extrabold text-foreground">Admin access required</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page is restricted to platform admins. Contact whoever manages the SitePix
          Supabase project if you believe you should have access.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background p-6 sm:p-10">
      <h1 className="text-xl font-extrabold text-foreground">Admin dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Platform-wide tools, restricted to admins.</p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <nav className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {ADMIN_NAV.map((item) => {
            const isActive = item.to === "/admin" ? pathname === "/admin" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-bold transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
