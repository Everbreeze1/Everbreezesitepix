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
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createProjectBoard,
  updateProjectBoard,
  deleteProjectBoard,
  type ProjectBoard,
} from "@/lib/project-boards.functions";

interface TagRow {
  id: string;
  name: string;
  color: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  allTags: TagRow[];
  /** Pass an existing board to edit it ("Manage Pipeline") instead of creating a new one. */
  board?: ProjectBoard | null;
  onCreated?: (board: ProjectBoard) => void;
  onUpdated?: (board: ProjectBoard) => void;
  onDeleted?: (id: string) => void;
}

export function CreateBoardDialog({
  open,
  onOpenChange,
  allTags,
  board,
  onCreated,
  onUpdated,
  onDeleted,
}: Props) {
  const isEdit = !!board;
  const [name, setName] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setName(board?.name ?? "");
      setSelectedTags(new Set(board?.tag_ids ?? []));
    }
  }, [open, board]);

  const toggle = (id: string) =>
    setSelectedTags((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = async () => {
    const n = name.trim();
    if (!n || selectedTags.size === 0) return;
    setSaving(true);
    try {
      if (isEdit && board) {
        const updated = await updateProjectBoard({
          data: { id: board.id, name: n, tagIds: Array.from(selectedTags) },
        });
        toast.success("Pipeline updated");
        onUpdated?.(updated);
      } else {
        const created = await createProjectBoard({
          data: { name: n, tagIds: Array.from(selectedTags) },
        });
        toast.success(`Pipeline "${created.name}" created`);
        onCreated?.(created);
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not save pipeline");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!board) return;
    setDeleting(true);
    try {
      await deleteProjectBoard({ data: { id: board.id } });
      toast.success("Pipeline deleted");
      onDeleted?.(board.id);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not delete pipeline");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Manage Pipeline" : "New Pipeline"}</DialogTitle>
          <DialogDescription>
            Each tag becomes a stage. Any project carrying one of these tags shows up in that stage
            automatically - shared with your whole team, and always up to date.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="board-name">Name</Label>
            <Input
              id="board-name"
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kitchen Remodels"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Stages ({selectedTags.size} tags selected)</Label>
            <ScrollArea className="h-64 rounded-md border border-border">
              <div className="p-1">
                {allTags.length === 0 ? (
                  <p className="p-4 text-center text-xs text-muted-foreground">
                    No tags yet - add tags to your projects first.
                  </p>
                ) : (
                  allTags.map((t) => (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent"
                    >
                      <Checkbox checked={selectedTags.has(t.id)} onCheckedChange={() => toggle(t.id)} />
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: t.color }}
                      />
                      <span className="truncate text-sm font-medium">{t.name}</span>
                    </label>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>
        </div>
        <DialogFooter className={isEdit ? "sm:justify-between" : undefined}>
          {isEdit ? (
            <Button
              variant="ghost"
              onClick={remove}
              disabled={saving || deleting}
              className="text-destructive hover:text-destructive"
            >
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete pipeline
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving || deleting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving || deleting || !name.trim() || selectedTags.size === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {isEdit ? "Save changes" : "Create Pipeline"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
