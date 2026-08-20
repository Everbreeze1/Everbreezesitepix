import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { HardHat, Loader2, Mail, Plus, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConfirm } from "@/hooks/use-confirm";
import { supabase } from "@/integrations/sitepix/client";
import { projectDisplayName } from "@sitepix/shared";
import {
  inviteSubcontractor,
  listSubcontractors,
  revokeSubcontractor,
} from "@/lib/subcontractors.functions";

/**
 * Subcontractor access - the Team tier's stated upgrade reason.
 *
 * An outside firm gets a login scoped to named jobs and occupies no paid seat.
 * That last part is why this panel sits apart from the members list rather than
 * inside it: a subcontractor in the roster reads as a teammate, and the first
 * thing an owner would then ask is why their seat count did not move.
 *
 * Gated but never hidden. A Starter or Pro owner sees the panel, sees what it
 * does, and sees one button to the plan that has it - hiding the row entirely
 * is how a feature someone is paying to reach becomes invisible.
 */
export function SubcontractorsPanel({ isTeamPlan }: { isTeamPlan: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [inviteOpen, setInviteOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["subcontractors"],
    queryFn: () => listSubcontractors(),
    // The RPC refuses outright below Team, so asking would only produce a 403
    // in the console on every load of this page.
    enabled: isTeamPlan,
  });

  const revoke = useMutation({
    mutationFn: (subcontractorId: string) => revokeSubcontractor({ data: { subcontractorId } }),
    onSuccess: () => {
      toast.success("Access revoked");
      qc.invalidateQueries({ queryKey: ["subcontractors"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not revoke access"),
  });

  const subs = data?.subcontractors ?? [];

  return (
    <section className="mt-8 rounded-[28px] border border-border bg-card p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2 font-display text-xl font-bold text-foreground">
            <HardHat className="h-5 w-5 text-muted-foreground" />
            Subcontractors
          </p>
          <p className="mt-1 max-w-xl font-manrope text-sm text-muted-foreground">
            Give an outside crew a login for specific jobs only. They can view and add photos on
            those jobs, and nothing else. Subcontractors do not use a paid seat.
          </p>
        </div>

        {isTeamPlan ? (
          <Button
            onClick={() => setInviteOpen(true)}
            className="rounded-lg font-manrope text-sm font-bold"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Invite subcontractor
          </Button>
        ) : (
          <div className="flex flex-col items-end gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 font-manrope text-[11px] font-extrabold uppercase tracking-wider text-primary">
              <ShieldCheck className="h-3 w-3" /> Team plan
            </span>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="rounded-lg font-manrope font-bold"
            >
              <Link to="/pricing">See Team plan</Link>
            </Button>
          </div>
        )}
      </div>

      {!isTeamPlan ? null : isLoading ? (
        <div className="mt-6 flex items-center gap-2 font-manrope text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading subcontractors...
        </div>
      ) : subs.length === 0 ? (
        <p className="mt-6 font-manrope text-sm text-muted-foreground">
          No subcontractors yet. Invite one and pick the jobs they should reach.
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-border">
          {subs.map((s: any) => (
            <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 py-4">
              <div className="min-w-0">
                <p className="font-manrope text-sm font-bold text-foreground">
                  {s.company_name || s.email}
                </p>
                {s.company_name && (
                  <p className="font-manrope text-xs text-muted-foreground">{s.email}</p>
                )}
                <p className="mt-1 font-manrope text-xs text-muted-foreground">
                  {s.projects.length} job{s.projects.length === 1 ? "" : "s"}
                  {s.projects.length > 0 && (
                    <span>: {s.projects.map((p: any) => p.name || "Untitled").join(", ")}</span>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Three states, not two - an expired invite looks identical to
                    a pending one until someone asks why they never got in. */}
                {s.expired ? (
                  <span className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 font-manrope text-[11px] font-bold text-destructive">
                    Invite expired
                  </span>
                ) : s.pending ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 font-manrope text-[11px] font-bold text-muted-foreground">
                    <Mail className="h-3 w-3" /> Invited
                  </span>
                ) : (
                  <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2.5 py-0.5 font-manrope text-[11px] font-bold text-emerald-600">
                    Active
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={async () => {
                    const ok = await confirm({
                      title: `Revoke access for ${s.company_name || s.email}?`,
                      description:
                        "They lose access to every job immediately. Photos they already uploaded stay on the project.",
                      confirmText: "Revoke access",
                      variant: "destructive",
                    });
                    if (ok) revoke.mutate(s.id);
                  }}
                  className="font-manrope text-xs font-bold text-muted-foreground hover:text-destructive"
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Revoke
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <InviteSubcontractorDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={() => qc.invalidateQueries({ queryKey: ["subcontractors"] })}
      />
    </section>
  );
}

function InviteSubcontractorDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onInvited: () => void;
}) {
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const { data: projects } = useQuery({
    queryKey: ["subcontractor-project-options"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, name")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null }[];
    },
    enabled: open,
  });

  const canSubmit = useMemo(
    () => /.+@.+\..+/.test(email.trim()) && selected.length > 0,
    [email, selected],
  );

  const invite = useMutation({
    mutationFn: () =>
      inviteSubcontractor({
        data: {
          email: email.trim().toLowerCase(),
          companyName: companyName.trim() || undefined,
          projectIds: selected,
          origin: window.location.origin,
        },
      }),
    onSuccess: (res: any) => {
      // Never claim a send that did not happen - the grant is real either way,
      // and telling someone mail went out when it did not leaves them waiting.
      if (res?.alreadyActive) toast.success("Jobs updated. They already have access.");
      else if (res?.emailSent) toast.success("Invitation sent");
      else toast.warning("Subcontractor added, but the invitation email failed to send.");
      onInvited();
      onOpenChange(false);
      setEmail("");
      setCompanyName("");
      setSelected([]);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not invite this subcontractor"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Invite a subcontractor</DialogTitle>
          <DialogDescription className="font-manrope">
            They get a login for the jobs you pick here, and can view and add photos on those jobs.
            They cannot see billing, your team, or any other project. This does not use a seat.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="sub-email" className="font-manrope text-xs font-bold">
              Email
            </Label>
            <Input
              id="sub-email"
              type="email"
              placeholder="foreman@aceplumbing.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sub-company" className="font-manrope text-xs font-bold">
              Company <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="sub-company"
              placeholder="Ace Plumbing"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              maxLength={120}
            />
            <p className="font-manrope text-xs text-muted-foreground">
              Shown next to their uploads, so the crew knows whose photo it is.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="font-manrope text-xs font-bold">
              Jobs they can reach{" "}
              {selected.length > 0 && (
                <span className="font-normal text-muted-foreground">
                  ({selected.length} chosen)
                </span>
              )}
            </Label>
            <ScrollArea className="h-48 rounded-lg border border-border p-3">
              {(projects ?? []).length === 0 ? (
                <p className="font-manrope text-sm text-muted-foreground">
                  No projects yet. Create one first.
                </p>
              ) : (
                <div className="space-y-2.5">
                  {(projects ?? []).map((p) => (
                    <label key={p.id} className="flex items-center gap-2.5">
                      <Checkbox
                        checked={selected.includes(p.id)}
                        onCheckedChange={(v) =>
                          setSelected((prev) =>
                            v ? [...prev, p.id] : prev.filter((id) => id !== p.id),
                          )
                        }
                      />
                      <span className="font-manrope text-sm text-foreground">
                        {projectDisplayName(p)}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </ScrollArea>
            {/* The server rejects an empty list too. Saying so here stops the
                round trip that would otherwise end in a red toast. */}
            {selected.length === 0 && (
              <p className="font-manrope text-xs text-muted-foreground">
                Pick at least one job - a subcontractor with no job has a login that shows nothing.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit || invite.isPending}
            onClick={() => invite.mutate()}
            className="font-manrope font-bold"
          >
            {invite.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
