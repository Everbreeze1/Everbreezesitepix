import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { setGroupProjects } from "@/lib/project-groups.functions";
import type { ProjectPickerRow } from "@/features/projects/components/CreateGroupDialog";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  groupId: string;
  projects: ProjectPickerRow[];
  initialSelectedIds: string[];
  onSaved?: () => void;
}

export function EditGroupProjectsDialog({
  open,
  onOpenChange,
  groupId,
  projects,
  initialSelectedIds,
  onSaved,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const saveFn = setGroupProjects;

  useEffect(() => {
    if (open) {
      setSelected(new Set(initialSelectedIds));
      setQuery("");
    }
  }, [open, initialSelectedIds]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.location ?? "").toLowerCase().includes(q);
  });

  const submit = async () => {
    setSaving(true);
    try {
      await saveFn({ data: { groupId, projectIds: Array.from(selected) } });
      toast.success("Group updated");
      onSaved?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not update group");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Projects in Group</DialogTitle>
          <DialogDescription>
            Add or remove projects from this group. Changes save on Save.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
              className="h-8 pl-8"
            />
          </div>
          <div className="text-xs text-muted-foreground">{selected.size} selected</div>
          <ScrollArea className="h-72 rounded-md border border-border">
            <div className="p-1">
              {filtered.length === 0 ? (
                <p className="p-4 text-center text-xs text-muted-foreground">No projects match.</p>
              ) : (
                filtered.map((p) => (
                  <label
                    key={p.id}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                  >
                    <Checkbox checked={selected.has(p.id)} onCheckedChange={() => toggle(p.id)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.name}</p>
                      {p.location && (
                        <p className="truncate text-[11px] text-muted-foreground">{p.location}</p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
