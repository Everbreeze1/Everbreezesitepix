import { useMemo, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, Tag, FolderOpen, LayoutTemplate } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  useLabelCatalog,
  upsertLabel,
  updateLabel,
  deleteLabel,
  hexToChipStyle,
  fallbackLabelColor,
  type LabelRow,
} from "@/hooks/use-label-catalog";
import { ColorPicker } from "@/components/ColorPicker";
import { EmptyState } from "@/components/EmptyState";
import { useConfirm } from "@/hooks/use-confirm";

interface Props {
  teamId: string | null;
  userId: string;
  canManage: boolean;
  /** Maps lower(name) -> count of project templates using the label */
  templateUsage: Map<string, number>;
  /** Maps lower(name) -> count of projects using the label */
  projectUsage: Map<string, number>;
}

export function LabelsManager({ teamId, userId, canManage, templateUsage, projectUsage }: Props) {
  const { rows } = useLabelCatalog();
  const confirm = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(fallbackLabelColor("new"));
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<LabelRow | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("#3b82f6");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, query]);

  const openCreate = () => {
    setNewName("");
    setNewColor(fallbackLabelColor(String(Math.random())));
    setCreateOpen(true);
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    const row = await upsertLabel({ name, color: newColor, team_id: teamId, created_by: userId });
    setSaving(false);
    if (!row) {
      toast.error("Could not create label");
      return;
    }
    toast.success("Label created");
    setCreateOpen(false);
  };

  const openEdit = (l: LabelRow) => {
    setEditing(l);
    setEditName(l.name);
    setEditColor(l.color || fallbackLabelColor(l.name));
  };

  const saveEdit = async () => {
    if (!editing) return;
    const name = editName.trim();
    if (!name) return;
    setSaving(true);
    const row = await updateLabel(editing.id, { name, color: editColor });
    setSaving(false);
    if (!row) {
      toast.error("Could not save label");
      return;
    }
    toast.success("Label updated");
    setEditing(null);
  };

  const remove = async (l: LabelRow) => {
    if (
      !(await confirm({
        description: `Delete label "${l.name}"? It will be removed from templates and projects that use it.`,
        variant: "destructive",
      }))
    )
      return;
    const ok = await deleteLabel(l.id);
    if (!ok) toast.error("Could not delete label");
    else toast.success("Label deleted");
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 px-5 py-4">
        <div>
          <h3 className="text-base font-semibold">Labels</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Company-wide labels you can attach to project templates and projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search labels…"
            className="h-9 w-48 rounded-lg"
          />
          {canManage && (
            <Button size="sm" className="rounded-lg" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" />
              New label
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-10">
          <EmptyState
            icon={Tag}
            title={rows.length === 0 ? "No labels yet" : "No matching labels"}
            description={
              rows.length === 0
                ? "Create labels to organize templates and projects by trade, region, or priority."
                : "Try a different search term."
            }
            action={
              canManage && rows.length === 0 ? (
                <Button onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  New label
                </Button>
              ) : null
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border/60">
          {filtered.map((l) => {
            const key = l.name.toLowerCase();
            const tplCount = templateUsage.get(key) ?? 0;
            const prjCount = projectUsage.get(key) ?? 0;
            return (
              <li
                key={l.id}
                className="group flex items-center gap-4 px-5 py-3 transition-colors hover:bg-muted/40"
              >
                <span
                  className="inline-flex items-center gap-1.5 border px-3 py-1 text-[13px] font-bold shadow-sm"
                  style={{
                    ...hexToChipStyle(l.color || fallbackLabelColor(l.name)),
                    transform: "skewX(-12deg)",
                    borderRadius: "4px",
                  }}
                >
                  <span style={{ transform: "skewX(12deg)" }}>{l.name}</span>
                </span>
                <div className="flex flex-1 items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="gap-1 font-normal">
                    <LayoutTemplate className="h-3 w-3" />
                    {tplCount} template{tplCount === 1 ? "" : "s"}
                  </Badge>
                  <Badge variant="outline" className="gap-1 font-normal">
                    <FolderOpen className="h-3 w-3" />
                    {prjCount} project{prjCount === 1 ? "" : "s"}
                  </Badge>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => openEdit(l)}
                      aria-label="Edit"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => void remove(l)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Create a new label</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-1">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Label name</label>
              <Input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. HVAC, Urgent, North region"
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <ColorPicker value={newColor} onChange={setNewColor} size="md" />
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </p>
              <span
                className="inline-flex items-center gap-1.5 border px-3.5 py-1.5 text-sm font-bold shadow-sm"
                style={{
                  ...hexToChipStyle(newColor),
                  transform: "skewX(-12deg)",
                  borderRadius: "4px",
                }}
              >
                <span style={{ transform: "skewX(12deg)" }}>{newName.trim() || "Label name"}</span>
              </span>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void create()}
              disabled={!newName.trim() || saving}
              className="min-w-24"
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xl">Edit label</DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-1">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Label name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-11 text-base"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-foreground">Color</label>
              <ColorPicker value={editColor} onChange={setEditColor} size="md" />
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Preview
              </p>
              <span
                className="inline-flex items-center gap-1.5 border px-3.5 py-1.5 text-sm font-bold shadow-sm"
                style={{
                  ...hexToChipStyle(editColor),
                  transform: "skewX(-12deg)",
                  borderRadius: "4px",
                }}
              >
                <span style={{ transform: "skewX(12deg)" }}>{editName.trim() || "Label name"}</span>
              </span>
            </div>
          </div>
          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveEdit()}
              disabled={!editName.trim() || saving}
              className="min-w-24"
            >
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
