import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search, ShieldCheck, ShieldOff } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listPlatformUsers, setPlatformAdmin } from "@/lib/admin.functions";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

export function AdminUsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 300);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "users", debouncedSearch],
    queryFn: () => listPlatformUsers({ data: { search: debouncedSearch || undefined } }),
  });

  const toggleAdmin = async (userId: string, isAdmin: boolean) => {
    try {
      await setPlatformAdmin({ data: { userId, isAdmin } });
      toast.success(isAdmin ? "Granted admin access" : "Revoked admin access");
      void qc.invalidateQueries({ queryKey: ["admin", "users"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update admin access");
    }
  };

  return (
    <div>
      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, or company…"
          className="h-9 pl-8"
        />
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-card p-6">
        {isPending || !data ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : data.users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No users match.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Email</th>
                  <th className="pb-2 pr-4">Team</th>
                  <th className="pb-2 pr-4">Plan</th>
                  <th className="pb-2 pr-4">Joined</th>
                  <th className="pb-2">Admin</th>
                </tr>
              </thead>
              <tbody>
                {data.users.map((u) => (
                  <tr key={u.id} className="border-t border-border">
                    <td className="py-2 pr-4 font-medium text-foreground">{u.fullName ?? "-"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">{u.email ?? "-"}</td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {u.team ? `${u.team.name} (${u.team.role})` : "-"}
                    </td>
                    <td className="py-2 pr-4 capitalize text-muted-foreground">
                      {u.team?.plan ?? "-"}
                    </td>
                    <td className="py-2 pr-4 text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                    <td className="py-2">
                      <Button
                        size="sm"
                        variant={u.isPlatformAdmin ? "outline" : "ghost"}
                        onClick={() => toggleAdmin(u.id, !u.isPlatformAdmin)}
                      >
                        {u.isPlatformAdmin ? (
                          <>
                            <ShieldOff className="mr-1.5 h-3.5 w-3.5" /> Revoke
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Make admin
                          </>
                        )}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
