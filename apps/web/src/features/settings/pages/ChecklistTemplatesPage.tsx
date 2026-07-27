import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  Loader2,
  ClipboardList,
  GripVertical,
  Archive,
  ArchiveRestore,
  Copy,
  Sparkles,
  CheckSquare,
  Star,
  Type,
  CheckCircle2,
  Hash,
  ToggleLeft,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

type ItemType = "checkbox" | "rating" | "text" | "pass_fail" | "numeric" | "yes_no";

interface Template {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
}
interface TemplateItem {
  id: string;
  template_id: string;
  position: number;
  label: string;
  required: boolean;
  item_type: ItemType;
  description: string | null;
}

const ITEM_TYPES: { value: ItemType; label: string; icon: typeof CheckSquare; hint: string }[] = [
  { value: "checkbox", label: "Checkbox", icon: CheckSquare, hint: "Simple done / not done" },
  { value: "rating", label: "Rating (1–5)", icon: Star, hint: "Star scale for assessments" },
  { value: "text", label: "Text field", icon: Type, hint: "Free-form note" },
  { value: "pass_fail", label: "Pass / Fail", icon: CheckCircle2, hint: "Inspection result" },
  { value: "numeric", label: "Numeric", icon: Hash, hint: "Measurement or count" },
  { value: "yes_no", label: "Yes / No", icon: ToggleLeft, hint: "Quick binary answer" },
];

const STARTER_TEMPLATES: {
  name: string;
  description: string;
  items: { label: string; item_type: ItemType; required?: boolean; description?: string }[];
}[] = [
  {
    name: "Damage Assessment",
    description: "Rate condition of key building elements (1 = poor, 5 = excellent).",
    items: [
      { label: "Overall structural condition", item_type: "rating", required: true },
      { label: "Roof condition", item_type: "rating", required: true },
      { label: "Exterior walls / siding", item_type: "rating" },
      { label: "Windows & doors", item_type: "rating" },
      { label: "Interior finishes", item_type: "rating" },
      { label: "Water damage present?", item_type: "yes_no", required: true },
      { label: "Notes / additional observations", item_type: "text" },
    ],
  },
  {
    name: "HVAC Inspection",
    description: "Standard HVAC service call inspection.",
    items: [
      { label: "Thermostat operating correctly", item_type: "pass_fail", required: true },
      { label: "Filter condition", item_type: "rating" },
      { label: "Filter replaced", item_type: "checkbox" },
      { label: "Refrigerant pressure (PSI)", item_type: "numeric" },
      { label: "Supply air temperature (°F)", item_type: "numeric" },
      { label: "Return air temperature (°F)", item_type: "numeric" },
      { label: "Condensate drain clear", item_type: "pass_fail" },
      { label: "Blower motor amperage", item_type: "numeric" },
      { label: "Technician notes", item_type: "text" },
    ],
  },
  {
    name: "Roof Inspection",
    description: "Visual inspection of roof system.",
    items: [
      { label: "Overall roof condition", item_type: "rating", required: true },
      { label: "Shingle / membrane integrity", item_type: "pass_fail", required: true },
      { label: "Flashing condition", item_type: "rating" },
      { label: "Gutters & downspouts clear", item_type: "yes_no" },
      { label: "Visible leaks or staining", item_type: "yes_no", required: true },
      { label: "Approximate age (years)", item_type: "numeric" },
      { label: "Recommended next action", item_type: "text" },
    ],
  },
  {
    name: "General Service Call",
    description: "Catch-all checklist for any field visit.",
    items: [
      { label: "Arrived on site", item_type: "checkbox", required: true },
      { label: "Customer briefed on scope", item_type: "checkbox", required: true },
      { label: "Before photos taken", item_type: "checkbox" },
      { label: "Work completed", item_type: "checkbox", required: true },
      { label: "After photos taken", item_type: "checkbox" },
      { label: "Site cleaned up", item_type: "checkbox" },
      { label: "Customer satisfaction", item_type: "rating" },
      { label: "Follow-up needed?", item_type: "yes_no" },
      { label: "Visit summary", item_type: "text" },
    ],
  },
];

export function ChecklistTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [editingDetails, setEditingDetails] = useState<{
    name: string;
    description: string;
  } | null>(null);
  const [startersOpen, setStartersOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data: tpls } = await supabase
      .from("checklist_templates" as any)
      .select("id, name, description, archived, created_at")
      .order("created_at", { ascending: true });
    const list = ((tpls as any[]) ?? []) as Template[];
    setTemplates(list);
    if (list.length) {
      const ids = list.map((t) => t.id);
      const { data: its } = await supabase
        .from("checklist_template_items" as any)
        .select("id, template_id, position, label, required, item_type, description")
        .in("template_id", ids)
        .order("position", { ascending: true });
      setItems(((its as any[]) ?? []) as TemplateItem[]);
      if (!selectedId || !list.find((t) => t.id === selectedId)) {
        const firstActive = list.find((t) => !t.archived);
        setSelectedId(firstActive?.id ?? list[0]?.id ?? null);
      }
    } else {
      setItems([]);
      setSelectedId(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleTemplates = templates.filter((t) => showArchived || !t.archived);
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedItems = useMemo(
    () => items.filter((i) => i.template_id === selectedId).sort((a, b) => a.position - b.position),
    [items, selectedId],
  );

  const createTemplate = async (name: string, description: string | null) => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("checklist_templates" as any)
      .insert({ created_by: user.id, name: name.trim(), description: description?.trim() || null })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create template");
      return null;
    }
    return (data as any).id as string;
  };

  const submitCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const id = await createTemplate(newName, newDesc);
    setCreating(false);
    if (id) {
      toast.success("Template created");
      setNewName("");
      setNewDesc("");
      setCreateOpen(false);
      setSelectedId(id);
      await load();
    }
  };

  const createFromStarter = async (s: (typeof STARTER_TEMPLATES)[number]) => {
    setCreating(true);
    try {
      const id = await createTemplate(s.name, s.description);
      if (!id) return;
      const rows = s.items.map((it, idx) => ({
        template_id: id,
        position: idx,
        label: it.label,
        required: !!it.required,
        item_type: it.item_type,
        description: it.description ?? null,
      }));
      const { error } = await supabase.from("checklist_template_items" as any).insert(rows);
      if (error) toast.error(error.message);
      else toast.success(`Created “${s.name}”`);
      setSelectedId(id);
      setStartersOpen(false);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const duplicateTemplate = async (t: Template) => {
    if (!user) return;
    const id = await createTemplate(`${t.name} (copy)`, t.description);
    if (!id) return;
    const its = items.filter((i) => i.template_id === t.id);
    if (its.length) {
      const rows = its.map((it, idx) => ({
        template_id: id,
        position: idx,
        label: it.label,
        required: it.required,
        item_type: it.item_type,
        description: it.description,
      }));
      const { error } = await supabase.from("checklist_template_items" as any).insert(rows);
      if (error) toast.error(error.message);
    }
    toast.success("Template duplicated");
    setSelectedId(id);
    await load();
  };

  const toggleArchived = async (t: Template) => {
    const { error } = await supabase
      .from("checklist_templates" as any)
      .update({ archived: !t.archived })
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else void load();
  };

  const deleteTemplate = async (t: Template) => {
    if (!(await confirm({ description: `Delete template "${t.name}"? This cannot be undone.`, variant: "destructive" }))) return;
    const { error } = await supabase
      .from("checklist_templates" as any)
      .delete()
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else {
      if (selectedId === t.id) setSelectedId(null);
      void load();
    }
  };

  const saveDetails = async () => {
    if (!selected || !editingDetails) return;
    const { error } = await supabase
      .from("checklist_templates" as any)
      .update({
        name: editingDetails.name.trim(),
        description: editingDetails.description.trim() || null,
      })
      .eq("id", selected.id);
    if (error) toast.error("Failed");
    else {
      toast.success("Saved");
      setEditingDetails(null);
      void load();
    }
  };

  const addItem = async (type: ItemType = "checkbox") => {
    if (!selectedId) return;
    const position = selectedItems.length;
    const { error } = await supabase.from("checklist_template_items" as any).insert({
      template_id: selectedId,
      label: "New item",
      required: false,
      position,
      item_type: type,
    });
    if (error) toast.error("Failed");
    else void load();
  };

  const updateItem = async (id: string, patch: Partial<TemplateItem>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    const { error } = await supabase
      .from("checklist_template_items" as any)
      .update(patch)
      .eq("id", id);
    if (error) {
      toast.error("Failed");
      void load();
    }
  };

  const deleteItem = async (id: string) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    const { error } = await supabase
      .from("checklist_template_items" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed");
      setItems(prev);
    }
  };

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = selectedItems.findIndex((i) => i.id === active.id);
    const newIndex = selectedItems.findIndex((i) => i.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(selectedItems, oldIndex, newIndex);
    // Optimistic
    setItems((xs) => {
      const others = xs.filter((x) => x.template_id !== selectedId);
      return [...others, ...reordered.map((r, idx) => ({ ...r, position: idx }))];
    });
    // Persist new positions
    await Promise.all(
      reordered.map((r, idx) =>
        supabase
          .from("checklist_template_items" as any)
          .update({ position: idx })
          .eq("id", r.id),
      ),
    );
  };

  const containerCls = embedded ? "" : "container mx-auto max-w-6xl px-4 pb-24 pt-4 md:pt-6";

  return (
    <div className={containerCls}>
      {(() => {
        const actions = (
          <div className="flex flex-wrap items-center gap-2">
            <Dialog open={startersOpen} onOpenChange={setStartersOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline">
                  <Sparkles className="mr-1.5 h-4 w-4" />
                  Starter templates
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>Starter templates</DialogTitle>
                </DialogHeader>
                <div className="grid gap-2 sm:grid-cols-2">
                  {STARTER_TEMPLATES.map((s) => (
                    <Card key={s.name} className="p-3">
                      <div className="font-medium text-sm">{s.name}</div>
                      <p className="mt-1 text-xs text-muted-foreground line-clamp-2">
                        {s.description}
                      </p>
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        {s.items.length} items
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-3 w-full"
                        onClick={() => void createFromStarter(s)}
                        disabled={creating}
                      >
                        Use this template
                      </Button>
                    </Card>
                  ))}
                </div>
              </DialogContent>
            </Dialog>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="mr-1.5 h-4 w-4" />
                  New template
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New checklist template</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="tpl-name">Name</Label>
                    <Input
                      id="tpl-name"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="e.g. Pre-pour inspection"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="tpl-desc">Description (optional)</Label>
                    <Textarea
                      id="tpl-desc"
                      value={newDesc}
                      onChange={(e) => setNewDesc(e.target.value)}
                      rows={2}
                      className="mt-1"
                    />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setCreateOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => void submitCreate()}
                    disabled={!newName.trim() || creating}
                  >
                    {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                    Create
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        );
        return embedded ? (
          <div className="flex justify-end">{actions}</div>
        ) : (
          <PageHeader
            backTo="/settings"
            backLabel="Settings"
            eyebrow="Workspace tools"
            title="Checklist templates"
            description="Build reusable inspection and service checklists with rich item types."
            actions={actions}
          />
        );
      })()}

      {loading ? (
        <Card className="mt-6 flex items-center justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No templates yet"
          description="Start from a pre-built example or create your own from scratch."
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStartersOpen(true)}>
                <Sparkles className="mr-1.5 h-4 w-4" />
                Browse starters
              </Button>
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />
                New template
              </Button>
            </div>
          }
          className="mt-6"
        />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-[280px_1fr]">
          <Card className="p-2 h-fit">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Templates</span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowArchived((s) => !s)}
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            </div>
            <ul className="space-y-0.5">
              {visibleTemplates.map((t) => {
                const count = items.filter((i) => i.template_id === t.id).length;
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => setSelectedId(t.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                        selectedId === t.id ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{t.name}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {count} item{count === 1 ? "" : "s"}
                        </div>
                      </div>
                      {t.archived && (
                        <Badge variant="outline" className="text-[10px]">
                          Archived
                        </Badge>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {selected ? (
            <Card className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {editingDetails ? (
                    <div className="space-y-2">
                      <Input
                        value={editingDetails.name}
                        onChange={(e) =>
                          setEditingDetails({ ...editingDetails, name: e.target.value })
                        }
                        className="h-9 text-base font-semibold"
                      />
                      <Textarea
                        value={editingDetails.description}
                        onChange={(e) =>
                          setEditingDetails({ ...editingDetails, description: e.target.value })
                        }
                        rows={2}
                        placeholder="Description"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => void saveDetails()}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingDetails(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-base font-semibold">{selected.name}</h2>
                      {selected.description && (
                        <p className="mt-1 text-sm text-muted-foreground">{selected.description}</p>
                      )}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {selectedItems.length} item{selectedItems.length === 1 ? "" : "s"}
                      </p>
                    </>
                  )}
                </div>
                {!editingDetails && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setEditingDetails({
                          name: selected.name,
                          description: selected.description ?? "",
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void duplicateTemplate(selected)}
                    >
                      <Copy className="mr-1.5 h-4 w-4" />
                      Duplicate
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => void toggleArchived(selected)}>
                      {selected.archived ? (
                        <>
                          <ArchiveRestore className="mr-1.5 h-4 w-4" />
                          Unarchive
                        </>
                      ) : (
                        <>
                          <Archive className="mr-1.5 h-4 w-4" />
                          Archive
                        </>
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void deleteTemplate(selected)}
                      aria-label="Delete template"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </div>

              <div className="mt-4">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={selectedItems.map((i) => i.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="space-y-2">
                      {selectedItems.map((it) => (
                        <SortableItemRow
                          key={it.id}
                          item={it}
                          onChange={(patch) => void updateItem(it.id, patch)}
                          onDelete={() => void deleteItem(it.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>

                {selectedItems.length === 0 && (
                  <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No items yet. Add your first item below.
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <span className="text-xs text-muted-foreground">Add item:</span>
                {ITEM_TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <Button
                      key={t.value}
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => void addItem(t.value)}
                      title={t.hint}
                    >
                      <Icon className="mr-1.5 h-3.5 w-3.5" />
                      {t.label}
                    </Button>
                  );
                })}
              </div>
            </Card>
          ) : (
            <Card className="flex items-center justify-center p-12 text-sm text-muted-foreground">
              Select a template to edit
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function SortableItemRow({
  item,
  onChange,
  onDelete,
}: {
  item: TemplateItem;
  onChange: (patch: Partial<TemplateItem>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const [label, setLabel] = useState(item.label);
  const [desc, setDesc] = useState(item.description ?? "");
  useEffect(() => setLabel(item.label), [item.label]);
  useEffect(() => setDesc(item.description ?? ""), [item.description]);

  const typeMeta = ITEM_TYPES.find((t) => t.value === item.item_type) ?? ITEM_TYPES[0];
  const Icon = typeMeta.icon;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="group rounded-md border border-border bg-card p-2.5"
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes}
          {...listeners}
          className="mt-1.5 cursor-grab text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => label !== item.label && onChange({ label })}
              placeholder="Item label"
              className="h-8 flex-1 min-w-[200px] text-sm"
            />
            <Select
              value={item.item_type}
              onValueChange={(v) => onChange({ item_type: v as ItemType })}
            >
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <div className="flex items-center gap-1.5">
                  <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  <SelectValue />
                </div>
              </SelectTrigger>
              <SelectContent>
                {ITEM_TYPES.map((t) => {
                  const I = t.icon;
                  return (
                    <SelectItem key={t.value} value={t.value} className="text-sm">
                      <div className="flex items-center gap-2">
                        <I className="h-3.5 w-3.5" />
                        {t.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Switch
                checked={item.required}
                onCheckedChange={(v) => onChange({ required: !!v })}
                aria-label="Required"
              />
              <span className="text-[11px] text-muted-foreground">Required</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() =>
              (desc || "") !== (item.description ?? "") && onChange({ description: desc || null })
            }
            placeholder="Helper text / instructions (optional)"
            rows={1}
            className="resize-none text-xs text-muted-foreground"
          />
        </div>
      </div>
    </li>
  );
}
