import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import {
  Loader2,
  Plus,
  Tag,
  Trash2,
  GripVertical,
  Pencil,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface LabelSet {
  id: string;
  team_id: string | null;
  created_by: string;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

interface LabelSetItem {
  id: string;
  label_set_id: string;
  name: string;
  color: string;
  position: number;
}

const DEFAULT_COLORS = [
  "#2563eb",
  "#059669",
  "#d97706",
  "#dc2626",
  "#7c3aed",
  "#db2777",
  "#0891b2",
  "#65a30d",
  "#ea580c",
  "#4b5563",
];

interface Props {
  teamId: string | null;
  canManage: boolean;
}

export function LabelSetsManager({ teamId, canManage }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sets, setSets] = useState<LabelSet[]>([]);
  const [itemsBySet, setItemsBySet] = useState<Record<string, LabelSetItem[]>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [savingMeta, setSavingMeta] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: setRows, error: e1 } = await supabase
      .from("label_sets" as any)
      .select("id, team_id, created_by, name, description, archived, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (e1) {
      toast.error(e1.message ?? "Failed to load label sets");
      setLoading(false);
      return;
    }
    const setList = (setRows ?? []) as unknown as LabelSet[];
    setSets(setList);

    if (setList.length > 0) {
      const ids = setList.map((s) => s.id);
      const { data: itemRows, error: e2 } = await supabase
        .from("label_set_items" as any)
        .select("id, label_set_id, name, color, position")
        .in("label_set_id", ids)
        .order("position", { ascending: true });
      if (e2) {
        toast.error(e2.message ?? "Failed to load items");
      } else {
        const grouped: Record<string, LabelSetItem[]> = {};
        (itemRows as unknown as LabelSetItem[]).forEach((it) => {
          (grouped[it.label_set_id] ||= []).push(it);
        });
        setItemsBySet(grouped);
      }
    } else {
      setItemsBySet({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const visibleSets = useMemo(
    () => sets.filter((s) => (showArchived ? true : !s.archived)),
    [sets, showArchived],
  );

  useEffect(() => {
    if (!selectedId && visibleSets.length > 0) setSelectedId(visibleSets[0].id);
    if (selectedId && !visibleSets.some((s) => s.id === selectedId)) {
      setSelectedId(visibleSets[0]?.id ?? null);
    }
  }, [visibleSets, selectedId]);

  const selected = sets.find((s) => s.id === selectedId) ?? null;
  const items = (selectedId && itemsBySet[selectedId]) || [];

  const createSet = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("label_sets" as any)
      .insert({ name, description: newDesc.trim() || null, team_id: teamId, created_by: user?.id })
      .select("id, team_id, created_by, name, description, archived, created_at, updated_at")
      .single();
    setCreating(false);
    if (error) {
      toast.error(error.message ?? "Failed to create set");
      return;
    }
    const created = data as unknown as LabelSet;
    setSets((xs) => [...xs, created]);
    setItemsBySet((m) => ({ ...m, [created.id]: [] }));
    setSelectedId(created.id);
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    toast.success(`"${created.name}" saved`, { description: "Now add labels on the right." });
  };

  const openEdit = () => {
    if (!selected) return;
    setEditName(selected.name);
    setEditDesc(selected.description ?? "");
    setEditOpen(true);
  };

  const saveMeta = async () => {
    if (!selected) return;
    const name = editName.trim();
    if (!name) return;
    setSavingMeta(true);
    const { error } = await supabase
      .from("label_sets" as any)
      .update({ name, description: editDesc.trim() || null })
      .eq("id", selected.id);
    setSavingMeta(false);
    if (error) {
      toast.error(error.message ?? "Failed");
      return;
    }
    setSets((xs) =>
      xs.map((s) =>
        s.id === selected.id ? { ...s, name, description: editDesc.trim() || null } : s,
      ),
    );
    setEditOpen(false);
    toast.success("Saved");
  };

  const toggleArchive = async () => {
    if (!selected) return;
    const next = !selected.archived;
    const { error } = await supabase
      .from("label_sets" as any)
      .update({ archived: next })
      .eq("id", selected.id);
    if (error) {
      toast.error(error.message ?? "Failed");
      return;
    }
    setSets((xs) => xs.map((s) => (s.id === selected.id ? { ...s, archived: next } : s)));
    toast.success(next ? "Archived" : "Restored");
  };

  const deleteSet = async () => {
    if (!selected) return;
    if (!confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    const { error } = await supabase
      .from("label_sets" as any)
      .delete()
      .eq("id", selected.id);
    if (error) {
      toast.error(error.message ?? "Failed");
      return;
    }
    setSets((xs) => xs.filter((s) => s.id !== selected.id));
    setItemsBySet((m) => {
      const n = { ...m };
      delete n[selected.id];
      return n;
    });
    setSelectedId(null);
    toast.success("Deleted");
  };

  const addItem = async () => {
    if (!selected) return;
    const position = items.length;
    const color = DEFAULT_COLORS[position % DEFAULT_COLORS.length];
    const { data, error } = await supabase
      .from("label_set_items" as any)
      .insert({ label_set_id: selected.id, name: "New label", color, position })
      .select("id, label_set_id, name, color, position")
      .single();
    if (error) {
      toast.error(error.message ?? "Failed");
      return;
    }
    const created = data as unknown as LabelSetItem;
    setItemsBySet((m) => ({ ...m, [selected.id]: [...items, created] }));
  };

  const updateItem = async (id: string, patch: Partial<Pick<LabelSetItem, "name" | "color">>) => {
    if (!selected) return;
    setItemsBySet((m) => ({
      ...m,
      [selected.id]: (m[selected.id] || []).map((it) => (it.id === id ? { ...it, ...patch } : it)),
    }));
    const { error } = await supabase
      .from("label_set_items" as any)
      .update(patch)
      .eq("id", id);
    if (error) toast.error(error.message ?? "Failed to save");
  };

  const deleteItem = async (id: string) => {
    if (!selected) return;
    const prev = items;
    setItemsBySet((m) => ({ ...m, [selected.id]: items.filter((it) => it.id !== id) }));
    const { error } = await supabase
      .from("label_set_items" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error(error.message ?? "Failed");
      setItemsBySet((m) => ({ ...m, [selected.id]: prev }));
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const onDragEnd = async (e: DragEndEvent) => {
    if (!selected) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((i) => i.id === active.id);
    const newIndex = items.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(items, oldIndex, newIndex).map((it, idx) => ({
      ...it,
      position: idx,
    }));
    setItemsBySet((m) => ({ ...m, [selected.id]: reordered }));
    // persist all positions
    const updates = reordered.map((it) =>
      supabase
        .from("label_set_items" as any)
        .update({ position: it.position })
        .eq("id", it.id),
    );
    const results = await Promise.all(updates);
    if (results.some((r) => r.error)) toast.error("Failed to save order");
  };

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (sets.length === 0) {
    return (
      <>
        <EmptyState
          icon={Tag}
          title="No label sets yet"
          description={
            canManage
              ? "Bundle related labels into a set you can apply to any project in one click."
              : "Ask your account owner or admin to create a label set."
          }
          action={
            canManage ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" /> New label set
              </Button>
            ) : null
          }
        />
        <CreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          name={newName}
          setName={setNewName}
          desc={newDesc}
          setDesc={setNewDesc}
          creating={creating}
          onCreate={createSet}
        />
      </>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      {/* Sidebar */}
      <div className="space-y-3">
        {canManage && (
          <Button className="w-full justify-center rounded-xl" onClick={() => setCreateOpen(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> New label set
          </Button>
        )}
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {visibleSets.length} set{visibleSets.length === 1 ? "" : "s"}
            </span>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived((s) => !s)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          </div>
          <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
            {visibleSets.map((s) => {
              const count = (itemsBySet[s.id] || []).length;
              const isSelected = s.id === selectedId;
              return (
                <li key={s.id} className="relative">
                  {isSelected && (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                  )}
                  <button
                    onClick={() => setSelectedId(s.id)}
                    className={`flex w-full flex-col items-start gap-1 px-3.5 py-3 text-left transition-colors ${isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50"}`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium">{s.name}</span>
                      {s.archived && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Archived
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {count} label{count === 1 ? "" : "s"}
                      </span>
                      <div className="flex -space-x-1">
                        {(itemsBySet[s.id] || []).slice(0, 5).map((it) => (
                          <span
                            key={it.id}
                            className="h-3 w-3 rounded-full border border-background"
                            style={{ backgroundColor: it.color }}
                          />
                        ))}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      {/* Detail */}
      <div className="space-y-4">
        {selected ? (
          <>
            <Card className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold leading-tight">{selected.name}</h2>
                  {selected.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                  )}
                </div>
                {canManage && (
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button variant="outline" size="sm" onClick={openEdit}>
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button variant="outline" size="sm" onClick={toggleArchive}>
                      {selected.archived ? (
                        <>
                          <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" /> Restore
                        </>
                      ) : (
                        <>
                          <Archive className="mr-1.5 h-3.5 w-3.5" /> Archive
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      onClick={deleteSet}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
            </Card>

            <Card className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">Labels in this set</h3>
                  <p className="text-xs text-muted-foreground">
                    Drag to reorder. Changes save automatically.
                  </p>
                </div>
                {canManage && (
                  <Button size="sm" onClick={addItem}>
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add label
                  </Button>
                )}
              </div>

              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  No labels yet. Add your first one above.
                </p>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={onDragEnd}
                >
                  <SortableContext
                    items={items.map((i) => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-2">
                      {items.map((it) => (
                        <SortableItem
                          key={it.id}
                          item={it}
                          canManage={canManage}
                          onChange={(patch) => updateItem(it.id, patch)}
                          onDelete={() => deleteItem(it.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
            </Card>
          </>
        ) : (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            Select a label set on the left.
          </Card>
        )}
      </div>

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        name={newName}
        setName={setNewName}
        desc={newDesc}
        setDesc={setNewDesc}
        creating={creating}
        onCreate={createSet}
      />

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit label set</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">Name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">Description</label>
              <Textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="mt-1"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveMeta} disabled={savingMeta || !editName.trim()}>
              {savingMeta && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CreateDialog(props: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  name: string;
  setName: (v: string) => void;
  desc: string;
  setDesc: (v: string) => void;
  creating: boolean;
  onCreate: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New label set</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium">Name</label>
            <Input
              autoFocus
              value={props.name}
              onChange={(e) => props.setName(e.target.value)}
              placeholder="e.g. Trade categories"
              className="mt-1"
            />
          </div>
          <div>
            <label className="text-xs font-medium">Description</label>
            <Textarea
              value={props.desc}
              onChange={(e) => props.setDesc(e.target.value)}
              placeholder="What is this set for?"
              className="mt-1"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={props.onCreate} disabled={props.creating || !props.name.trim()}>
            {props.creating && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Save label set
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableItem({
  item,
  canManage,
  onChange,
  onDelete,
}: {
  item: LabelSetItem;
  canManage: boolean;
  onChange: (patch: Partial<Pick<LabelSetItem, "name" | "color">>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const [name, setName] = useState(item.name);
  const [color, setColor] = useState(item.color);
  useEffect(() => {
    setName(item.name);
  }, [item.name]);
  useEffect(() => {
    setColor(item.color);
  }, [item.color]);

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-2"
    >
      {canManage && (
        <button
          type="button"
          className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
          aria-label="Reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <label
        className="relative h-6 w-6 shrink-0 cursor-pointer rounded-full border border-border/60"
        style={{ backgroundColor: color }}
      >
        <input
          type="color"
          value={color}
          disabled={!canManage}
          onChange={(e) => setColor(e.target.value)}
          onBlur={() => color !== item.color && onChange({ color })}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <Input
        value={name}
        disabled={!canManage}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== item.name && onChange({ name: name.trim() })}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="h-8 flex-1 border-0 bg-transparent px-2 focus-visible:ring-1"
      />
      {canManage && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </li>
  );
}
