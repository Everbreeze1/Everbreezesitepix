import { useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Plus,
  Trash2,
  Loader2,
  Workflow as WorkflowIcon,
  Archive,
  ArchiveRestore,
  Copy,
  CheckSquare,
  Camera,
  StickyNote,
  ChevronDown,
  ChevronRight,
  Signature,
  Save,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";

type ItemKind = "check" | "photo" | "note";

interface Template {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  created_at: string;
}
interface Phase {
  id: string;
  template_id: string;
  position: number;
  name: string;
  description: string | null;
  requires_signoff: boolean;
}
interface Item {
  id: string;
  phase_id: string;
  position: number;
  kind: ItemKind;
  label: string;
  required: boolean;
}

const kindMeta: Record<ItemKind, { icon: typeof CheckSquare; label: string }> = {
  check: { icon: CheckSquare, label: "Checklist item" },
  photo: { icon: Camera, label: "Photo prompt" },
  note: { icon: StickyNote, label: "Note field" },
};

export function WorkflowTemplatesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [creating, setCreating] = useState(false);
  const [openPhases, setOpenPhases] = useState<Record<string, boolean>>({});

  // Pending (unsaved) edits — flushed on Save
  const [pendingTemplate, setPendingTemplate] = useState<Record<string, Partial<Template>>>({});
  const [pendingPhases, setPendingPhases] = useState<Record<string, Partial<Phase>>>({});
  const [pendingItems, setPendingItems] = useState<Record<string, Partial<Item>>>({});
  const [saving, setSaving] = useState(false);

  const pendingCount =
    Object.keys(pendingTemplate).length +
    Object.keys(pendingPhases).length +
    Object.keys(pendingItems).length;

  const load = async () => {
    setLoading(true);
    const { data: tpls } = await supabase
      .from("workflow_templates" as any)
      .select("id, name, description, archived, created_at")
      .order("created_at", { ascending: true });
    const list = ((tpls as any[]) ?? []) as Template[];
    setTemplates(list);
    if (list.length) {
      const ids = list.map((t) => t.id);
      const { data: phs } = await supabase
        .from("workflow_template_phases" as any)
        .select("id, template_id, position, name, description, requires_signoff")
        .in("template_id", ids)
        .order("position", { ascending: true });
      const phList = ((phs as any[]) ?? []) as Phase[];
      setPhases(phList);
      if (phList.length) {
        const phIds = phList.map((p) => p.id);
        const { data: its } = await supabase
          .from("workflow_template_items" as any)
          .select("id, phase_id, position, kind, label, required")
          .in("phase_id", phIds)
          .order("position", { ascending: true });
        setItems(((its as any[]) ?? []) as Item[]);
      } else {
        setItems([]);
      }
      if (!selectedId || !list.find((t) => t.id === selectedId)) {
        const firstActive = list.find((t) => !t.archived);
        setSelectedId(firstActive?.id ?? list[0]?.id ?? null);
      }
    } else {
      setPhases([]);
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
  const rawSelected = templates.find((t) => t.id === selectedId) ?? null;
  const selected = useMemo(
    () => (rawSelected ? { ...rawSelected, ...(pendingTemplate[rawSelected.id] ?? {}) } : null),
    [rawSelected, pendingTemplate],
  );
  const selectedPhases = useMemo(
    () =>
      phases
        .filter((p) => p.template_id === selectedId)
        .map((p) => ({ ...p, ...(pendingPhases[p.id] ?? {}) })),
    [phases, selectedId, pendingPhases],
  );
  const effectiveItems = useMemo(
    () => items.map((it) => ({ ...it, ...(pendingItems[it.id] ?? {}) })),
    [items, pendingItems],
  );

  const trySelect = async (id: string | null) => {
    if (
      pendingCount > 0 &&
      !(await confirm({ description: "Discard unsaved changes?", variant: "destructive" }))
    )
      return;
    setPendingTemplate({});
    setPendingPhases({});
    setPendingItems({});
    setSelectedId(id);
  };

  const discardPending = () => {
    setPendingTemplate({});
    setPendingPhases({});
    setPendingItems({});
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const ops: PromiseLike<any>[] = [];
      for (const [id, patch] of Object.entries(pendingTemplate)) {
        ops.push(
          supabase
            .from("workflow_templates" as any)
            .update(patch)
            .eq("id", id)
            .then((r: any) => {
              if (r.error) throw r.error;
            }),
        );
      }
      for (const [id, patch] of Object.entries(pendingPhases)) {
        ops.push(
          supabase
            .from("workflow_template_phases" as any)
            .update(patch)
            .eq("id", id)
            .then((r: any) => {
              if (r.error) throw r.error;
            }),
        );
      }
      for (const [id, patch] of Object.entries(pendingItems)) {
        ops.push(
          supabase
            .from("workflow_template_items" as any)
            .update(patch)
            .eq("id", id)
            .then((r: any) => {
              if (r.error) throw r.error;
            }),
        );
      }
      await Promise.all(ops);
      setPendingTemplate({});
      setPendingPhases({});
      setPendingItems({});
      toast.success("Saved");
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const createTemplate = async () => {
    if (!newName.trim() || !user) return;
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("workflow_templates" as any)
        .insert({
          created_by: user.id,
          name: newName.trim(),
          description: newDesc.trim() || null,
        })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Failed");
      toast.success("Workflow template created");
      setNewName("");
      setNewDesc("");
      setCreateOpen(false);
      setSelectedId((data as any).id);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create template");
    } finally {
      setCreating(false);
    }
  };

  const duplicateTemplate = async (t: Template) => {
    if (!user) return;
    try {
      const tPhases = phases.filter((p) => p.template_id === t.id);
      const { data: newTpl, error } = await supabase
        .from("workflow_templates" as any)
        .insert({
          created_by: user.id,
          name: `${t.name} (copy)`,
          description: t.description,
        })
        .select("id")
        .single();
      if (error || !newTpl) throw error ?? new Error("Failed");
      const newTplId = (newTpl as any).id as string;
      for (const ph of tPhases) {
        const { data: newPh } = await supabase
          .from("workflow_template_phases" as any)
          .insert({
            template_id: newTplId,
            position: ph.position,
            name: ph.name,
            description: ph.description,
            requires_signoff: ph.requires_signoff,
          })
          .select("id")
          .single();
        const newPhId = (newPh as any)?.id as string | undefined;
        if (!newPhId) continue;
        const phItems = items.filter((i) => i.phase_id === ph.id);
        if (phItems.length) {
          await supabase.from("workflow_template_items" as any).insert(
            phItems.map((it) => ({
              phase_id: newPhId,
              position: it.position,
              kind: it.kind,
              label: it.label,
              required: it.required,
            })),
          );
        }
      }
      toast.success("Template duplicated");
      setSelectedId(newTplId);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to duplicate");
    }
  };

  const toggleArchived = async (t: Template) => {
    const { error } = await supabase
      .from("workflow_templates" as any)
      .update({ archived: !t.archived })
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else void load();
  };

  const deleteTemplate = async (t: Template) => {
    if (
      !(await confirm({
        description: `Delete workflow “${t.name}”? This cannot be undone.`,
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from("workflow_templates" as any)
      .delete()
      .eq("id", t.id);
    if (error) toast.error("Failed");
    else {
      if (selectedId === t.id) setSelectedId(null);
      void load();
    }
  };

  const addPhase = async () => {
    if (!selectedId) return;
    const position = selectedPhases.length;
    const { data, error } = await supabase
      .from("workflow_template_phases" as any)
      .insert({ template_id: selectedId, position, name: `Phase ${position + 1}` })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Failed");
      return;
    }
    setOpenPhases((m) => ({ ...m, [(data as any).id]: true }));
    void load();
  };

  const updatePhase = (id: string, patch: Partial<Phase>) => {
    setPendingPhases((m) => ({ ...m, [id]: { ...(m[id] ?? {}), ...patch } }));
  };

  const updateTemplate = (id: string, patch: Partial<Template>) => {
    setPendingTemplate((m) => ({ ...m, [id]: { ...(m[id] ?? {}), ...patch } }));
  };

  const deletePhase = async (id: string) => {
    if (
      !(await confirm({
        description: "Delete this phase and all its items?",
        variant: "destructive",
      }))
    )
      return;
    const prev = phases;
    setPhases((xs) => xs.filter((x) => x.id !== id));
    setItems((xs) => xs.filter((x) => x.phase_id !== id));
    const { error } = await supabase
      .from("workflow_template_phases" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed");
      setPhases(prev);
      void load();
    }
  };

  const addItem = async (phaseId: string, kind: ItemKind, label: string, required: boolean) => {
    if (!label.trim()) return;
    const position = items.filter((i) => i.phase_id === phaseId).length;
    const { error } = await supabase.from("workflow_template_items" as any).insert({
      phase_id: phaseId,
      position,
      kind,
      label: label.trim(),
      required,
    });
    if (error) toast.error("Failed");
    else void load();
  };

  const updateItem = (id: string, patch: Partial<Item>) => {
    setPendingItems((m) => ({ ...m, [id]: { ...(m[id] ?? {}), ...patch } }));
  };

  const deleteItem = async (id: string) => {
    const prev = items;
    setItems((xs) => xs.filter((x) => x.id !== id));
    const { error } = await supabase
      .from("workflow_template_items" as any)
      .delete()
      .eq("id", id);
    if (error) {
      toast.error("Failed");
      setItems(prev);
    }
  };

  const actions = (
    <Dialog open={createOpen} onOpenChange={setCreateOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New workflow
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl p-6 sm:p-8">
        <DialogHeader>
          <DialogTitle>New workflow template</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="wf-name">Name</Label>
            <Input
              id="wf-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. HVAC install"
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="wf-desc">Description (optional)</Label>
            <Textarea
              id="wf-desc"
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
          <Button onClick={() => void createTemplate()} disabled={!newName.trim() || creating}>
            {creating && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return (
    <div className={embedded ? "" : "container mx-auto max-w-5xl px-4 pb-24 pt-4 md:pt-6"}>
      {!embedded && (
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 -ml-2"
            onClick={async () => {
              if (
                pendingCount > 0 &&
                !(await confirm({ description: "Discard unsaved changes?", variant: "destructive" }))
              )
                return;
              if (window.history.length > 1) router.history.back();
              else void router.navigate({ to: "/settings" });
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            Settings
          </Button>
        </div>
      )}

      {embedded ? (
        <div className="flex justify-end">{actions}</div>
      ) : (
        <PageHeader
          eyebrow="Workspace tools"
          title="Workflow templates"
          description="Structured phases (Pre-Job, Install, Inspection, Handover…) with checklist items, photo prompts, notes, and sign-off."
          actions={actions}
        />
      )}

      {loading ? (
        <Card className="mt-6 flex items-center justify-center p-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </Card>
      ) : templates.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Build a workflow once — Pre-Job, Install, Inspection, Handover — then apply it to any project. Works for HVAC, plumbing, electrical, GC, and more."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              New workflow
            </Button>
          }
          className="mt-6"
        />
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-[260px_1fr]">
          <Card className="p-2">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">Workflows</span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setShowArchived((s) => !s)}
              >
                {showArchived ? "Hide archived" : "Show archived"}
              </button>
            </div>
            <ul className="space-y-0.5">
              {visibleTemplates.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => trySelect(t.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      selectedId === t.id ? "bg-primary/10 text-foreground" : "hover:bg-muted/60"
                    }`}
                  >
                    <span className="truncate">{t.name}</span>
                    {t.archived && (
                      <Badge variant="outline" className="text-[10px]">
                        Archived
                      </Badge>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {selected ? (
            <Card className="p-6 sm:p-8">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Input
                    value={selected.name}
                    onChange={(e) => updateTemplate(selected.id, { name: e.target.value })}
                    placeholder="Workflow name"
                    className="h-10 border-0 bg-transparent px-1 text-lg font-semibold focus-visible:ring-1"
                  />
                  <Textarea
                    value={selected.description ?? ""}
                    onChange={(e) =>
                      updateTemplate(selected.id, { description: e.target.value || null })
                    }
                    placeholder="Describe when to use this workflow…"
                    rows={2}
                    className="border-0 bg-transparent px-1 text-sm focus-visible:ring-1"
                  />
                  <p className="text-xs text-muted-foreground">
                    {selectedPhases.length} phase{selectedPhases.length === 1 ? "" : "s"} ·{" "}
                    {
                      effectiveItems.filter((i) => selectedPhases.some((p) => p.id === i.phase_id))
                        .length
                    }{" "}
                    items
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void duplicateTemplate(rawSelected!)}
                  >
                    <Copy className="mr-1.5 h-4 w-4" />
                    Duplicate
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void toggleArchived(rawSelected!)}
                  >
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
                    onClick={() => void deleteTemplate(rawSelected!)}
                    aria-label="Delete workflow"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {selectedPhases.map((ph) => (
                  <PhaseEditor
                    key={ph.id}
                    phase={ph}
                    items={effectiveItems.filter((i) => i.phase_id === ph.id)}
                    open={openPhases[ph.id] ?? true}
                    onToggle={() => setOpenPhases((m) => ({ ...m, [ph.id]: !(m[ph.id] ?? true) }))}
                    onUpdate={(patch) => updatePhase(ph.id, patch)}
                    onDelete={() => void deletePhase(ph.id)}
                    onAddItem={(kind, label, required) =>
                      void addItem(ph.id, kind, label, required)
                    }
                    onUpdateItem={(id, patch) => updateItem(id, patch)}
                    onDeleteItem={(id) => void deleteItem(id)}
                  />
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                className="mt-4 w-full"
                onClick={() => void addPhase()}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Add phase
              </Button>

              {/* Save toolbar */}
              <div className="sticky bottom-0 -mx-6 sm:-mx-8 mt-6 flex items-center justify-between gap-2 border-t border-border bg-card/95 px-6 sm:px-8 py-3 backdrop-blur">
                <span className="text-xs text-muted-foreground">
                  {pendingCount > 0
                    ? `${pendingCount} unsaved change${pendingCount === 1 ? "" : "s"}`
                    : "All changes saved"}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={discardPending}
                    disabled={pendingCount === 0 || saving}
                  >
                    Discard
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void saveAll()}
                    disabled={pendingCount === 0 || saving}
                  >
                    {saving ? (
                      <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="mr-1.5 h-4 w-4" />
                    )}
                    Save changes
                  </Button>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="flex items-center justify-center p-12 text-sm text-muted-foreground">
              Select a workflow to edit
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function PhaseEditor({
  phase,
  items,
  open,
  onToggle,
  onUpdate,
  onDelete,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
}: {
  phase: Phase;
  items: Item[];
  open: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<Phase>) => void;
  onDelete: () => void;
  onAddItem: (kind: ItemKind, label: string, required: boolean) => void;
  onUpdateItem: (id: string, patch: Partial<Item>) => void;
  onDeleteItem: (id: string) => void;
}) {
  const [addKind, setAddKind] = useState<ItemKind>("check");
  const [addLabel, setAddLabel] = useState("");
  const [addRequired, setAddRequired] = useState(false);

  const submitAdd = () => {
    if (!addLabel.trim()) return;
    onAddItem(addKind, addLabel, addRequired);
    setAddLabel("");
    setAddRequired(false);
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={onToggle}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Toggle phase"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <Input
          value={phase.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          onBlur={(e) => onUpdate({ name: e.target.value })}
          className="h-8 border-0 bg-transparent px-1 text-sm font-medium focus-visible:ring-1"
        />
        <Badge variant="outline" className="text-[10px]">
          {items.length} item{items.length === 1 ? "" : "s"}
        </Badge>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1.5" title="Require typed sign-off">
            <Signature className="h-3.5 w-3.5 text-muted-foreground" />
            <Switch
              checked={phase.requires_signoff}
              onCheckedChange={(v) => onUpdate({ requires_signoff: !!v })}
              aria-label="Require sign-off"
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete phase"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {open && (
        <div className="border-t border-border px-3 py-3">
          <ul className="space-y-1.5">
            {items.map((it) => {
              const Icon = kindMeta[it.kind].icon;
              return (
                <li
                  key={it.id}
                  className="group flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                >
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <Input
                    value={it.label}
                    onChange={(e) => onUpdateItem(it.id, { label: e.target.value })}
                    onBlur={(e) => onUpdateItem(it.id, { label: e.target.value })}
                    className="h-8 border-0 bg-transparent px-1 text-sm focus-visible:ring-1"
                  />
                  <div className="flex items-center gap-1.5 pr-1">
                    <Switch
                      checked={it.required}
                      onCheckedChange={(v) => onUpdateItem(it.id, { required: !!v })}
                      aria-label="Required"
                    />
                    <span className="text-[11px] text-muted-foreground">Req.</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => onDeleteItem(it.id)}
                    aria-label="Delete item"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <Select value={addKind} onValueChange={(v) => setAddKind(v as ItemKind)}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="check">
                  <span className="flex items-center gap-2">
                    <CheckSquare className="h-3.5 w-3.5" />
                    Checklist
                  </span>
                </SelectItem>
                <SelectItem value="photo">
                  <span className="flex items-center gap-2">
                    <Camera className="h-3.5 w-3.5" />
                    Photo prompt
                  </span>
                </SelectItem>
                <SelectItem value="note">
                  <span className="flex items-center gap-2">
                    <StickyNote className="h-3.5 w-3.5" />
                    Note field
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitAdd();
                }
              }}
              placeholder={
                addKind === "photo"
                  ? "e.g. Before photo"
                  : addKind === "note"
                    ? "e.g. Customer concerns"
                    : "e.g. Verify breaker labeled"
              }
              className="h-9 flex-1 min-w-[180px] text-sm"
            />
            <div className="flex items-center gap-1.5">
              <Switch
                checked={addRequired}
                onCheckedChange={(v) => setAddRequired(!!v)}
                aria-label="Required"
              />
              <span className="text-xs text-muted-foreground">Required</span>
            </div>
            <Button size="sm" className="h-9" onClick={submitAdd} disabled={!addLabel.trim()}>
              <Plus className="mr-1 h-4 w-4" />
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
