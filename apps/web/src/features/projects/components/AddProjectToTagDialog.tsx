import { useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";

interface TagRow {
  id: string;
  name: string;
  color: string;
}

interface ProjectRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  street: string | null;
  location: string | null;
}

interface Props {
  open: boolean;
  tag: TagRow;
  projects: ProjectRow[];
  onClose: () => void;
  onAdded: (projectId: string) => void;
}

export function AddProjectToTagDialog({ open, tag, projects, onClose, onAdded }: Props) {
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const filtered = projects.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const addr = [p.location, p.street, p.city, p.state].filter(Boolean).join(" ").toLowerCase();
    return p.name.toLowerCase().includes(q) || addr.includes(q);
  });

  const addProject = async (projectId: string) => {
    setSaving(projectId);
    try {
      const { error } = await (supabase as any)
        .from("project_tags")
        .upsert(
          { project_id: projectId, tag_id: tag.id, created_by: user?.id },
          { onConflict: "project_id,tag_id", ignoreDuplicates: true },
        );
      if (error) throw error;
      toast.success(`Added to "${tag.name}"`);
      onAdded(projectId);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add project");
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add project to "{tag.name}"</DialogTitle>
          <DialogDescription>Tags this project so it shows up in this stage.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects…"
            className="h-8 pl-8"
          />
        </div>
        <ScrollArea className="h-72 rounded-md border border-border">
          <div className="p-1">
            {filtered.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted-foreground">
                {projects.length === 0
                  ? "Every project already has this tag."
                  : "No projects match."}
              </p>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProject(p.id)}
                  disabled={saving === p.id}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent disabled:opacity-60"
                >
                  <span className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{p.name}</p>
                    {(p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ")) && (
                      <p className="truncate text-[11px] text-muted-foreground">
                        {p.location ?? [p.street, p.city, p.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                  </span>
                  {saving === p.id && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />}
                </button>
              ))
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
