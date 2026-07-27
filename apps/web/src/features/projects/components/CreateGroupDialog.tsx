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
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { createProjectGroup } from "@/lib/project-groups.functions";
import { useSubscriptionGate } from "@/hooks/use-subscription-gate";

export interface ProjectPickerRow {
  id: string;
  name: string;
  location?: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  projects: ProjectPickerRow[];
  onCreated?: (group: { id: string; name: string }) => void;
}

export function CreateGroupDialog({ open, onOpenChange, projects, onCreated }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const create = createProjectGroup;
  const { guard } = useSubscriptionGate();

  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setSelected(new Set());
      setQuery("");
    }
  }, [open]);

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return p.name.toLowerCase().includes(q) || (p.location ?? "").toLowerCase().includes(q);
  });

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = () => guard(() => void doSubmit(), "Subscribe to create project groups.");

  const doSubmit = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    try {
      const res = (await create({
        data: {
          name: n,
          description: description.trim() || null,
          projectIds: Array.from(selected),
        },
      })) as { id: string; name: string };
      toast.success(`Group "${res.name}" created`);
      onCreated?.(res);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not create group");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Project Group</DialogTitle>
          <DialogDescription>
            Bundle related projects (e.g. "Starbucks Locations") for shared views.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Starbucks Locations"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="group-desc">Description (optional)</Label>
            <Input
              id="group-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything worth noting about this group"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Projects ({selected.size} selected)</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search projects…"
                className="h-8 pl-8"
              />
            </div>
            <ScrollArea className="h-64 rounded-md border border-border">
              <div className="p-1">
                {filtered.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    No projects match.
                  </p>
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
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || !name.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Group
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
