import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/sitepix/client";
import { getMemberProjects, setMemberProjects } from "@/features/teams/api";
import { projectDisplayName } from "@sitepix/shared";

/**
 * Which jobs a Restricted member can reach.
 *
 * Only offered for that one role. Every other role already reaches every
 * project through `are_teammates()`, so a job picker for them would be a
 * control that appears to do something and does nothing - the server refuses
 * it outright for exactly that reason.
 */
export function AssignJobsDialog({
  member,
  onClose,
}: {
  member: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const open = !!member;

  const { data: projects } = useQuery({
    queryKey: ["assignable-projects"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("projects")
        .select("id, name")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return (data ?? []) as { id: string; name: string | null }[];
    },
    enabled: open,
  });

  const { data: current, isLoading } = useQuery({
    queryKey: ["member-projects", member?.id],
    queryFn: () => getMemberProjects({ data: { memberId: member!.id } }),
    enabled: open,
  });

  // Seeded from the server rather than kept in local state across opens, so
  // reopening the dialog after a failed save shows what is actually stored
  // rather than the edit that did not land.
  useEffect(() => {
    if (current?.projectIds) setSelected(current.projectIds);
  }, [current]);

  const save = useMutation({
    mutationFn: () => setMemberProjects({ data: { memberId: member!.id, projectIds: selected } }),
    onSuccess: (res: any) => {
      toast.success(
        res?.projectCount === 0
          ? "Saved. They can no longer reach any job."
          : `Saved. They can reach ${res?.projectCount} job${res?.projectCount === 1 ? "" : "s"}.`,
      );
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not save"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Choose jobs for {member?.name}</DialogTitle>
          <DialogDescription className="font-manrope">
            They are a Restricted member, so they see only what you tick here. Everything else in
            the workspace stays hidden from them.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 font-manrope text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading their jobs...
          </div>
        ) : (
          <ScrollArea className="h-64 rounded-lg border border-border p-3">
            {(projects ?? []).length === 0 ? (
              <p className="font-manrope text-sm text-muted-foreground">No projects yet.</p>
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
        )}

        {/* Zero is a legitimate choice - it parks someone without removing
            them - but it is worth saying out loud, because a Restricted member
            with no jobs sees an empty app and will ask why. */}
        {selected.length === 0 && !isLoading && (
          <p className="font-manrope text-xs text-muted-foreground">
            With nothing ticked they keep their seat but see no jobs at all.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending || isLoading}
            onClick={() => save.mutate()}
            className="font-manrope font-bold"
          >
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save jobs"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
