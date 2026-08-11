import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/EmptyState";
import { SURFACE_CARD } from "@/components/ui/surface";
import {
  FileText,
  Loader2,
  Plus,
  Trash2,
  GripVertical,
  ArrowLeft,
  ArrowRight,
  Check,
  Pencil,
  Archive,
  ArchiveRestore,
  Copy,
  LayoutGrid,
  Image as ImageIcon,
  AlignCenter,
  FileType,
  Sparkles,
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
import {
  parseReportTemplateStructure,
  type ReportCoverStyle,
  type ReportSectionLayout,
  type ReportTemplateSection,
  type ReportTemplateStructure,
} from "@sitepix/shared";

/*
 * The shape of `report_templates.sections` now lives in @sitepix/shared, because
 * the API needs the identical reading: `applyProjectBlueprintService` had its own
 * array-only reading of this column and threw "sections.map is not a function" on
 * every template this editor saves. Local aliases keep the rest of this file
 * unchanged.
 */
type CoverStyle = ReportCoverStyle;
type SectionLayout = ReportSectionLayout;
type Section = ReportTemplateSection;
type TemplateStructure = ReportTemplateStructure;

interface ReportTemplate {
  id: string;
  team_id: string | null;
  created_by: string;
  name: string;
  subtitle: string | null;
  sections: any;
  archived: boolean;
  created_at: string;
  updated_at: string;
}

const COVER_STYLES: {
  id: CoverStyle;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "minimal", label: "Minimal", description: "Clean title on a plain page.", icon: FileType },
  {
    id: "centered",
    label: "Centered",
    description: "Large centered title with subtitle.",
    icon: AlignCenter,
  },
  {
    id: "hero",
    label: "Hero band",
    description: "Bold colored hero band on top.",
    icon: LayoutGrid,
  },
  {
    id: "photo",
    label: "Photo cover",
    description: "Full-bleed cover photo with overlay.",
    icon: ImageIcon,
  },
];

const LAYOUT_OPTIONS: { id: SectionLayout; label: string }[] = [
  { id: "text", label: "Text only" },
  { id: "text-photos", label: "Text + photos" },
  { id: "photo-grid", label: "Photo grid" },
  { id: "checklist", label: "Checklist recap" },
];

const DEFAULT_PLACEHOLDERS = [
  "project_name",
  "project_address",
  "author_name",
  "report_date",
  "photo_count",
];

const STARTER_SECTIONS: Section[] = [
  {
    id: crypto.randomUUID(),
    heading: "Executive summary",
    body: "Overview of the site visit for {{project_name}} on {{report_date}}.",
    layout: "text",
  },
  { id: crypto.randomUUID(), heading: "Observations", body: "", layout: "text-photos" },
  { id: crypto.randomUUID(), heading: "Photos", body: "", layout: "photo-grid" },
  { id: crypto.randomUUID(), heading: "Next steps", body: "", layout: "checklist" },
];

const parseStructure = parseReportTemplateStructure;

interface Props {
  teamId: string | null;
  canManage: boolean;
}

export function ReportTemplatesManager({ teamId, canManage }: Props) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ReportTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("report_templates" as any)
      .select("id, team_id, created_by, name, subtitle, sections, archived, created_at, updated_at")
      .order("created_at", { ascending: true });
    if (error) toast.error(error.message ?? "Failed to load report templates");
    setRows((data ?? []) as unknown as ReportTemplate[]);
    setLoading(false);
  };
  useEffect(() => {
    void load();
  }, []);

  const visible = useMemo(
    () => rows.filter((r) => (showArchived ? true : !r.archived)),
    [rows, showArchived],
  );

  useEffect(() => {
    if (!selectedId && visible.length > 0) setSelectedId(visible[0].id);
    if (selectedId && !visible.some((r) => r.id === selectedId)) {
      setSelectedId(visible[0]?.id ?? null);
    }
  }, [visible, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const openCreate = () => {
    setEditingId(null);
    setWizardOpen(true);
  };
  const openEdit = (id: string) => {
    setEditingId(id);
    setWizardOpen(true);
  };

  const persist = async (payload: {
    name: string;
    subtitle: string | null;
    structure: TemplateStructure;
  }) => {
    if (editingId) {
      const { error } = await supabase
        .from("report_templates" as any)
        .update({
          name: payload.name,
          subtitle: payload.subtitle,
          sections: payload.structure as any,
        })
        .eq("id", editingId);
      if (error) {
        toast.error(error.message ?? "Failed to save");
        return false;
      }
      toast.success("Report template saved");
      await load();
      setSelectedId(editingId);
      return true;
    }
    const { data, error } = await supabase
      .from("report_templates" as any)
      .insert({
        name: payload.name,
        subtitle: payload.subtitle,
        sections: payload.structure as any,
        team_id: teamId,
        created_by: user?.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Failed to create");
      return false;
    }
    toast.success("Report template created");
    await load();
    setSelectedId((data as any).id);
    return true;
  };

  const duplicate = async (r: ReportTemplate) => {
    const { data, error } = await supabase
      .from("report_templates" as any)
      .insert({
        name: `${r.name} (copy)`,
        subtitle: r.subtitle,
        sections: r.sections,
        team_id: teamId,
        created_by: user?.id,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error("Failed to duplicate");
      return;
    }
    toast.success("Duplicated");
    await load();
    setSelectedId((data as any).id);
  };

  const toggleArchive = async (r: ReportTemplate) => {
    const { error } = await supabase
      .from("report_templates" as any)
      .update({ archived: !r.archived })
      .eq("id", r.id);
    if (error) {
      toast.error("Failed");
      return;
    }
    toast.success(r.archived ? "Restored" : "Archived");
    await load();
  };

  const remove = async (r: ReportTemplate) => {
    if (
      !(await confirm({
        description: `Delete report template "${r.name}"?`,
        variant: "destructive",
      }))
    )
      return;
    const { error } = await supabase
      .from("report_templates" as any)
      .delete()
      .eq("id", r.id);
    if (error) {
      toast.error("Failed");
      return;
    }
    toast.success("Deleted");
    setSelectedId(null);
    await load();
  };

  if (loading) {
    return (
      <Card className={`${SURFACE_CARD} flex items-center justify-center p-16`}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <>
        <EmptyState
          icon={FileText}
          title="No report templates yet"
          description={
            canManage
              ? "Create a reusable report structure — cover style, sections, and placeholders — you can apply to any project."
              : "Ask your account owner or admin to create a report template."
          }
          action={
            canManage ? (
              <Button onClick={openCreate}>
                <Plus className="mr-1.5 h-4 w-4" /> New report template
              </Button>
            ) : null
          }
        />
        {wizardOpen && (
          <TemplateWizard
            open={wizardOpen}
            onOpenChange={setWizardOpen}
            initial={null}
            onSave={persist}
          />
        )}
      </>
    );
  }

  const editing = editingId ? (rows.find((r) => r.id === editingId) ?? null) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        {canManage && (
          <Button className="w-full rounded-xl" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> New report template
          </Button>
        )}
        <Card className={`${SURFACE_CARD} overflow-hidden p-0`}>
          <div className="flex items-center justify-between border-b border-border/60 px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              {visible.length} template{visible.length === 1 ? "" : "s"}
            </span>
            <button
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived((s) => !s)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
          </div>
          <ul className="max-h-[60vh] divide-y divide-border/60 overflow-y-auto">
            {visible.map((r) => {
              const isSelected = r.id === selectedId;
              const struct = parseStructure(r.sections);
              return (
                <li key={r.id} className="relative">
                  {isSelected && (
                    <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                  )}
                  <button
                    onClick={() => setSelectedId(r.id)}
                    className={`flex w-full flex-col items-start gap-1 px-3.5 py-3 text-left transition-colors ${isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50"}`}
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium">{r.name}</span>
                      {r.archived && (
                        <Badge variant="outline" className="text-[10px]">
                          Archived
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="capitalize">{struct.coverStyle} cover</span>
                      <span>·</span>
                      <span>
                        {struct.items.length} section{struct.items.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <div className="space-y-4">
        {selected ? (
          <TemplatePreview
            template={selected}
            canManage={canManage}
            onEdit={() => openEdit(selected.id)}
            onDuplicate={() => void duplicate(selected)}
            onToggleArchive={() => void toggleArchive(selected)}
            onDelete={() => void remove(selected)}
          />
        ) : (
          <Card
            className={`${SURFACE_CARD} flex flex-col items-center justify-center gap-2 p-16 text-center`}
          >
            <Sparkles className="h-6 w-6 text-muted-foreground/70" />
            <p className="text-sm font-medium">Select a template</p>
          </Card>
        )}
      </div>

      {wizardOpen && (
        <TemplateWizard
          open={wizardOpen}
          onOpenChange={setWizardOpen}
          initial={editing}
          onSave={persist}
        />
      )}
    </div>
  );
}

function TemplatePreview({
  template,
  canManage,
  onEdit,
  onDuplicate,
  onToggleArchive,
  onDelete,
}: {
  template: ReportTemplate;
  canManage: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggleArchive: () => void;
  onDelete: () => void;
}) {
  const s = parseStructure(template.sections);
  const cover = COVER_STYLES.find((c) => c.id === s.coverStyle) ?? COVER_STYLES[0];
  const CoverIcon = cover.icon;

  return (
    <Card className={`${SURFACE_CARD} overflow-hidden p-0`}>
      <div className="border-b border-border/60 bg-gradient-to-br from-primary/[0.04] via-background to-background px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <FileText className="h-4.5 w-4.5" />
              </div>
              <h2 className="truncate text-xl font-semibold tracking-tight">{template.name}</h2>
              {template.archived && <Badge variant="outline">Archived</Badge>}
            </div>
            {template.subtitle && (
              <p className="mt-2 text-sm text-muted-foreground">{template.subtitle}</p>
            )}
          </div>
          {canManage && (
            <div className="flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={onEdit}>
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
              </Button>
              <Button variant="outline" size="sm" onClick={onDuplicate}>
                <Copy className="mr-1.5 h-3.5 w-3.5" /> Duplicate
              </Button>
              <Button variant="outline" size="sm" onClick={onToggleArchive}>
                {template.archived ? (
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
                onClick={onDelete}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-6 px-6 py-6">
        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Cover page
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CoverIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-medium">{cover.label}</div>
              <div className="text-xs text-muted-foreground">{cover.description}</div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Sections · {s.items.length}
          </div>
          {s.items.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border/70 px-4 py-6 text-center text-sm text-muted-foreground">
              No sections yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {s.items.map((sec, idx) => (
                <li
                  key={sec.id}
                  className="flex items-start gap-3 rounded-lg border border-border/60 bg-card px-3.5 py-2.5"
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground">
                    {idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        {sec.heading || "Untitled section"}
                      </span>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {LAYOUT_OPTIONS.find((l) => l.id === sec.layout)?.label ?? sec.layout}
                      </Badge>
                    </div>
                    {sec.body && (
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                        {sec.body}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {s.placeholders.length > 0 && (
          <section>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Placeholders
            </div>
            <div className="flex flex-wrap gap-1.5">
              {s.placeholders.map((p) => (
                <code key={p} className="rounded bg-muted px-2 py-0.5 text-xs">{`{{${p}}}`}</code>
              ))}
            </div>
          </section>
        )}
      </div>
    </Card>
  );
}

// ---------- Wizard ----------

function TemplateWizard({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: ReportTemplate | null;
  onSave: (payload: {
    name: string;
    subtitle: string | null;
    structure: TemplateStructure;
  }) => Promise<boolean>;
}) {
  const initStruct = initial ? parseStructure(initial.sections) : null;
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState(initial?.name ?? "");
  const [subtitle, setSubtitle] = useState(initial?.subtitle ?? "");
  const [coverStyle, setCoverStyle] = useState<CoverStyle>(initStruct?.coverStyle ?? "centered");
  const [items, setItems] = useState<Section[]>(
    initStruct?.items ?? STARTER_SECTIONS.map((s) => ({ ...s, id: crypto.randomUUID() })),
  );
  const [placeholders, setPlaceholders] = useState<string[]>(
    initStruct?.placeholders ?? DEFAULT_PLACEHOLDERS,
  );
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const canNext = step === 1 ? name.trim().length > 0 : true;

  const addSection = () => {
    setItems((xs) => [
      ...xs,
      { id: crypto.randomUUID(), heading: "New section", body: "", layout: "text" },
    ]);
  };
  const updateSection = (id: string, patch: Partial<Section>) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  };
  const removeSection = (id: string) => {
    setItems((xs) => xs.filter((x) => x.id !== id));
  };
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    setItems(arrayMove(items, oldIdx, newIdx));
  };

  const [newPlaceholder, setNewPlaceholder] = useState("");
  const addPlaceholder = () => {
    const v = newPlaceholder.trim().replace(/[^a-zA-Z0-9_]/g, "_");
    if (!v) return;
    if (placeholders.includes(v)) {
      setNewPlaceholder("");
      return;
    }
    setPlaceholders([...placeholders, v]);
    setNewPlaceholder("");
  };

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    const ok = await onSave({
      name: name.trim(),
      subtitle: subtitle.trim() || null,
      structure: { coverStyle, placeholders, items },
    });
    setSaving(false);
    if (ok) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit report template" : "New report template"}</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="mb-2 flex items-center gap-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex flex-1 items-center gap-2">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                  step >= (n as 1 | 2 | 3)
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {step > (n as 1 | 2 | 3) ? <Check className="h-3.5 w-3.5" /> : n}
              </div>
              <div className="min-w-0 text-xs">
                <div className={step >= (n as 1 | 2 | 3) ? "font-medium" : "text-muted-foreground"}>
                  {n === 1 ? "Basics" : n === 2 ? "Sections" : "Placeholders"}
                </div>
              </div>
              {n < 3 && <div className="mx-1 h-px flex-1 bg-border" />}
            </div>
          ))}
        </div>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium">Template name</label>
                <Input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Weekly progress report"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Subtitle (optional)</label>
                <Input
                  value={subtitle}
                  onChange={(e) => setSubtitle(e.target.value)}
                  placeholder="Short tagline shown under the title"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium">Cover page style</label>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {COVER_STYLES.map((c) => {
                    const Icon = c.icon;
                    const active = coverStyle === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setCoverStyle(c.id)}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                          active
                            ? "border-primary bg-primary/[0.06] ring-1 ring-primary/40"
                            : "border-border/60 hover:border-border"
                        }`}
                      >
                        <div
                          className={`flex h-9 w-9 items-center justify-center rounded-md ${active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}
                        >
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium">{c.label}</div>
                          <div className="text-xs text-muted-foreground">{c.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Add sections in the order they should appear. Drag to reorder. Use {"{{"}placeholder
                {"}}"} tokens inside body text.
              </p>
              {items.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">
                  No sections yet.
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
                      {items.map((sec) => (
                        <SortableSection
                          key={sec.id}
                          section={sec}
                          onChange={(patch) => updateSection(sec.id, patch)}
                          onDelete={() => removeSection(sec.id)}
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </DndContext>
              )}
              <Button variant="outline" size="sm" onClick={addSection}>
                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add section
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Placeholders are tokens like{" "}
                <code className="rounded bg-muted px-1">{"{{project_name}}"}</code> that get
                replaced when the template is applied.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {placeholders.map((p) => (
                  <span
                    key={p}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    <code>{`{{${p}}}`}</code>
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPlaceholders((xs) => xs.filter((x) => x !== p))}
                      aria-label={`Remove ${p}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {placeholders.length === 0 && (
                  <span className="text-xs text-muted-foreground">No placeholders yet.</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={newPlaceholder}
                  onChange={(e) => setNewPlaceholder(e.target.value)}
                  placeholder="e.g. client_name"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addPlaceholder();
                    }
                  }}
                />
                <Button variant="outline" size="sm" onClick={addPlaceholder}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Add
                </Button>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row items-center justify-between gap-2 sm:justify-between">
          <div className="text-xs text-muted-foreground">Step {step} of 3</div>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button variant="ghost" onClick={() => setStep((s) => (s === 3 ? 2 : 1))}>
                <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
            )}
            {step < 3 ? (
              <Button onClick={() => setStep((s) => (s === 1 ? 2 : 3))} disabled={!canNext}>
                Next <ArrowRight className="ml-1.5 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={() => void save()} disabled={saving || !name.trim()}>
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {initial ? "Save changes" : "Save template"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableSection({
  section,
  onChange,
  onDelete,
}: {
  section: Section;
  onChange: (patch: Partial<Section>) => void;
  onDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    // Lifts the section over its siblings while dragging — these rows are tall,
    // so without it the following sections' opaque fill painted straight
    // through the one being dragged for most of the drag. Needs the `relative`
    // below: z-index does nothing on a static box.
    zIndex: isDragging ? 5 : undefined,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="relative rounded-lg border border-border/60 bg-card p-3"
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          className="mt-1.5 cursor-grab touch-none text-muted-foreground hover:text-foreground"
          {...attributes}
          {...listeners}
          aria-label="Reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={section.heading}
              onChange={(e) => onChange({ heading: e.target.value })}
              placeholder="Section heading"
              className="h-8 flex-1"
            />
            <select
              value={section.layout}
              onChange={(e) => onChange({ layout: e.target.value as SectionLayout })}
              className="h-8 rounded-md border border-input bg-background px-2 text-xs"
            >
              {LAYOUT_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete section"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
          <Textarea
            value={section.body}
            onChange={(e) => onChange({ body: e.target.value })}
            placeholder="Section body — supports {{placeholders}}"
            rows={2}
            className="text-sm"
          />
        </div>
      </div>
    </li>
  );
}
