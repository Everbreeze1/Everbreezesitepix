import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Loader2, ShieldOff, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  listShareLinks,
  revokeShareLinks,
  type ShareKind,
  type ShareLink,
} from "@/lib/admin.functions";
import { usePrompt } from "@/hooks/use-prompt";
import { useAdminRole } from "../hooks/use-admin-role";
import { CapabilityNotice } from "../components/AdminTable";

const KIND_LABELS: Record<ShareKind, string> = {
  walkthrough: "Walkthroughs",
  walkthrough_summary: "Summaries",
  showcase: "Showcases",
  project: "Projects",
};

export function AdminSecurityPage() {
  const qc = useQueryClient();
  const prompt = usePrompt();
  // Revoking a share link is irreversible - the token is not kept - so the
  // server gates it on superadmin.
  const { denyReason } = useAdminRole();
  const denied = denyReason("owner");
  const [kind, setKind] = useState<ShareKind | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data, isPending } = useQuery({
    queryKey: ["admin", "shares", kind],
    queryFn: () => listShareLinks({ data: { kind: kind === "all" ? undefined : kind } }),
  });

  const links = data?.links ?? [];

  // Selection is per kind, because revoke is per kind on the server: each
  // source is a different table with a different revoke column.
  const selectedByKind = useMemo(() => {
    const map = new Map<ShareKind, string[]>();
    for (const l of links) {
      if (!selected.has(l.id)) continue;
      map.set(l.kind, [...(map.get(l.kind) ?? []), l.id]);
    }
    return map;
  }, [links, selected]);

  const selectedCount = [...selectedByKind.values()].reduce((s, ids) => s + ids.length, 0);

  const toggle = (link: ShareLink) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(link.id)) next.delete(link.id);
      else next.add(link.id);
      return next;
    });
  };

  const revokeSelected = async () => {
    if (!selectedCount) return;
    const reason = await prompt({
      title: `Revoke ${selectedCount} share link${selectedCount === 1 ? "" : "s"}?`,
      description:
        "Anyone holding these links loses access immediately, including the customer who sent them. This cannot be undone - the token is not kept.",
      label: "Reason (recorded in the audit log)",
      placeholder: "Token rotation after the anon-read exposure",
      confirmText: "Revoke",
    });
    if (!reason || reason.trim().length < 3) return;

    setBusy(true);
    try {
      let total = 0;
      // One call per kind: each maps to a different table.
      for (const [k, ids] of selectedByKind) {
        const res = await revokeShareLinks({ data: { kind: k, ids, reason: reason.trim() } });
        total += res.revoked;
      }
      toast.success(`Revoked ${total} link${total === 1 ? "" : "s"}.`);
      setSelected(new Set());
      void qc.invalidateQueries({ queryKey: ["admin", "shares"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not revoke those links");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-6">
        <p className="text-sm font-extrabold text-foreground">Public share links</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Every link that works without signing in. Revoking one takes effect immediately and cannot
          be undone.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={kind === "all" ? "default" : "outline"}
            onClick={() => setKind("all")}
          >
            All
          </Button>
          {(Object.keys(KIND_LABELS) as ShareKind[]).map((k) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "default" : "outline"}
              onClick={() => setKind(k)}
            >
              {KIND_LABELS[k]}
              {data?.counts[k] !== undefined && (
                <span className="ml-1.5 opacity-70">{data.counts[k]}</span>
              )}
            </Button>
          ))}
          {selectedCount > 0 && (
            <Button
              size="sm"
              variant="destructive"
              className="ml-auto"
              disabled={busy || !!denied}
              onClick={revokeSelected}
            >
              {busy ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldOff className="mr-1.5 h-3.5 w-3.5" />
              )}
              Revoke {selectedCount} selected
            </Button>
          )}
        </div>

        <CapabilityNotice reason={denied} />

        {data?.unavailable.length ? (
          <p className="mt-3 text-[11px] text-muted-foreground">
            Not present in this database, so not listed: {data.unavailable.join(", ")}.
          </p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6">
        {isPending ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : links.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No live share links of this kind.
          </p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="pb-2 pr-3 w-8" />
                    <th className="pb-2 pr-4">Title</th>
                    <th className="pb-2 pr-4">Kind</th>
                    <th className="pb-2 pr-4">Created</th>
                    <th className="pb-2">Link</th>
                  </tr>
                </thead>
                <tbody>
                  {links.map((l) => (
                    <tr key={`${l.kind}:${l.id}`} className="border-t border-border">
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => toggle(l)}
                          aria-label={`Select ${l.title}`}
                          className="h-4 w-4 rounded border-border"
                        />
                      </td>
                      <td className="py-2 pr-4 font-medium text-foreground">{l.title}</td>
                      <td className="py-2 pr-4 text-muted-foreground">{KIND_LABELS[l.kind]}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {l.createdAt ? new Date(l.createdAt).toLocaleDateString() : "-"}
                      </td>
                      <td className="py-2">
                        <a
                          href={l.publicPath}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
                        >
                          <Link2 className="h-3 w-3" />
                          {l.publicPath}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              {links.length} live link{links.length === 1 ? "" : "s"}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
