import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Search, ShieldAlert, Users } from "lucide-react";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useTeamMembers } from "@/hooks/use-team-members";
import { useSubscription } from "@/hooks/use-subscription";
import { useProjectAssignees, useApplyProjectAssignees } from "@/hooks/use-project-assignees";
import { setProjectAssignees } from "@/lib/teams.functions";
import { normaliseRole, roleLabelForTier } from "@sitepix/shared/team-permissions";
import { RoleBadge } from "@/features/teams/components/RoleBadge";

/**
 * Who is on this job.
 *
 * Reached from the projects list and from the project itself, which is where
 * anyone would actually staff a job. The other end of the same table is the
 * roster's "choose their jobs" picker in Team Settings, which answers the
 * mirrored question for one person; both write `project_assignments`, so the
 * two can never disagree about who is where.
 *
 * WHAT TICKING A BOX MEANS DEPENDS ON THE ROLE, AND ONLY FOR ONE ROLE.
 * Everyone except a Restricted member already reaches every project in the
 * workspace, so an assignment is a crew list: it says who is on the job, it
 * does not open a door. For a Restricted member it is also the door - the
 * database consults exactly these rows to decide what they can see - so their
 * row says so out loud rather than leaving an admin to discover it.
 *
 * Restricted only exists on Team, so on Pro this dialog is uniformly a crew
 * list and nothing in it claims otherwise.
 */
export function AssignTeammatesDialog({
  projectId,
  projectName,
  open,
  onOpenChange,
}: {
  projectId: string;
  projectName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { members, isLoading: rosterLoading } = useTeamMembers();
  const { tier } = useSubscription();
  const { byProject, canAssign, isLoading } = useProjectAssignees(open ? [projectId] : []);
  const applyCrew = useApplyProjectAssignees();

  const current = byProject[projectId];
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  /*
   * Seeded from the server every time the dialog opens rather than kept across
   * opens. Reopening after a failed save then shows what is actually stored
   * instead of the edit that did not land.
   */
  useEffect(() => {
    if (open && current) setSelected(current);
  }, [open, current]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        (m.full_name ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  const restrictedSelected = members.filter(
    (m) => selected.includes(m.user_id) && normaliseRole(m.role) === "restricted",
  ).length;

  const save = useMutation({
    mutationFn: () => setProjectAssignees({ data: { projectId, userIds: selected } }),
    onSuccess: (res: any) => {
      const count = res?.count ?? selected.length;
      toast.success(
        count === 0
          ? "Nobody is on this job now."
          : `${count} ${count === 1 ? "person is" : "people are"} on this job.`,
      );
      // Seeded rather than merely invalidated, so the card behind this dialog
      // repaints as it closes instead of three seconds later. See the note on
      // useApplyProjectAssignees.
      applyCrew(projectId, selected);
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  const busy = isLoading || rosterLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Who is on {projectName}?
          </DialogTitle>
          <DialogDescription className="font-manrope">
            Pick the teammates working this job. They show as its crew everywhere the project
            appears.
          </DialogDescription>
        </DialogHeader>

        {members.length > 6 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search teammates"
              className="h-9 pl-8"
            />
          </div>
        )}

        {busy ? (
          <div className="flex items-center gap-2 py-8 font-manrope text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your team...
          </div>
        ) : (
          <ScrollArea className="h-64 rounded-lg border border-border p-2">
            {filtered.length === 0 ? (
              <p className="p-3 font-manrope text-sm text-muted-foreground">
                {members.length === 0
                  ? "Invite teammates from Team settings first."
                  : `Nobody matches "${query}".`}
              </p>
            ) : (
              <div className="space-y-0.5">
                {filtered.map((m) => {
                  const checked = selected.includes(m.user_id);
                  const role = normaliseRole(m.role);
                  const name = m.full_name || m.email || "Teammate";
                  return (
                    <label
                      key={m.user_id}
                      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition hover:bg-accent"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!canAssign}
                        onCheckedChange={(v) =>
                          setSelected((prev) =>
                            v ? [...prev, m.user_id] : prev.filter((id) => id !== m.user_id),
                          )
                        }
                      />
                      <Avatar className="h-8 w-8 shrink-0">
                        {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={name} /> : null}
                        <AvatarFallback className="text-[10px] font-bold">
                          {initials(m.full_name, m.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-manrope text-sm font-semibold text-foreground">
                            {name}
                          </span>
                          <RoleBadge role={m.role} tier={tier} size="xs" />
                        </span>
                        <span className="block truncate font-manrope text-xs text-muted-foreground">
                          {role === "restricted"
                            ? checked
                              ? "Can open this job because it is ticked here"
                              : "Sees only the jobs ticked for them"
                            : `${roleLabelForTier(m.role, tier)} - already sees every project`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        )}

        {/*
          Said only when it is true. A Restricted member's access IS this list,
          so an admin ticking one needs to know the tick is the access - but
          repeating that on a Pro workspace, which cannot hold the role, would
          be describing a permission model the customer does not have.
        */}
        {restrictedSelected > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 font-manrope text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              {restrictedSelected === 1
                ? "One person here is"
                : `${restrictedSelected} people here are`}{" "}
              Restricted. Ticking them is what lets them open this job at all.
            </span>
          </p>
        )}

        {!canAssign && !busy && (
          <p className="font-manrope text-xs text-muted-foreground">
            Only Owners, Admins and Managers can change who is on a job.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canAssign || busy || save.isPending}
            onClick={() => save.mutate()}
            className="font-manrope font-bold"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save crew"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
