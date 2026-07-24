import { useEffect, useMemo, useRef, useState } from "react";
import {
  Workflow as WorkflowIcon,
  Plus,
  Loader2,
  Camera,
  StickyNote,
  Trash2,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Signature,
  Image as ImageIcon,
  RefreshCw,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { compressImageFile } from "@/features/photos/components/CameraCapture";

type ItemKind = "check" | "photo" | "note";

const CARD_VARIANTS = ["dark", "blue", "light"] as const;

interface Template {
  id: string;
  name: string;
  description: string | null;
}
interface Workflow {
  id: string;
  project_id: string;
  template_id: string | null;
  name: string;
  description: string | null;
  started_at: string;
  completed_at: string | null;
}
interface Phase {
  id: string;
  workflow_id: string;
  position: number;
  name: string;
  description: string | null;
  requires_signoff: boolean;
  notes: string | null;
  signed_off_by: string | null;
  signed_off_at: string | null;
  signoff_name: string | null;
}
interface Item {
  id: string;
  phase_id: string;
  position: number;
  kind: ItemKind;
  label: string;
  required: boolean;
  completed_at: string | null;
  photo_id: string | null;
  note_text: string | null;
}

export function ProjectWorkflows({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({});
  const [applyId, setApplyId] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const [{ data: wfs }, { data: tpls }] = await Promise.all([
      supabase
        .from("project_workflows" as any)
        .select("id, project_id, template_id, name, description, started_at, completed_at")
        .eq("project_id", projectId)
        .order("started_at", { ascending: true }),
      supabase
        .from("workflow_templates" as any)
        .select("id, name, description")
        .eq("archived", false)
        .order("name", { ascending: true }),
    ]);
    const wfList = ((wfs as any[]) ?? []) as Workflow[];
    setWorkflows(wfList);
    setTemplates(((tpls as any[]) ?? []) as Template[]);

    if (wfList.length) {
      const wfIds = wfList.map((w) => w.id);
      const { data: phs } = await supabase
        .from("project_workflow_phases" as any)
        .select(
          "id, workflow_id, position, name, description, requires_signoff, notes, signed_off_by, signed_off_at, signoff_name",
        )
        .in("workflow_id", wfIds)
        .order("position", { ascending: true });
      const phList = ((phs as any[]) ?? []) as Phase[];
      setPhases(phList);
      if (phList.length) {
        const phIds = phList.map((p) => p.id);
        const { data: its } = await supabase
          .from("project_workflow_items" as any)
          .select(
            "id, phase_id, position, kind, label, required, completed_at, photo_id, note_text",
          )
          .in("phase_id", phIds)
          .order("position", { ascending: true });
        const itList = ((its as any[]) ?? []) as Item[];
        setItems(itList);

        // Sign URLs for any linked photos
        const photoIds = itList.map((i) => i.photo_id).filter((x): x is string => !!x);
        if (photoIds.length) {
          const { data: phs2 } = await supabase
            .from("photos")
            .select("id, storage_path, image_url")
            .in("id", photoIds);
          const rows = ((phs2 as any[]) ?? []) as {
            id: string;
            storage_path: string;
            image_url: string | null;
          }[];
          const toSign = rows.filter((p) => !p.image_url).map((p) => p.storage_path);
          const signedMap: Record<string, string> = {};
          if (toSign.length) {
            const { data: signed } = await supabase.storage
              .from("site-photos")
              .createSignedUrls(toSign, 3600);
            signed?.forEach((s, i) => {
              if (s.signedUrl) signedMap[toSign[i]] = s.signedUrl;
            });
          }
          const map: Record<string, string> = {};
          rows.forEach((p) => {
            const url = p.image_url ?? signedMap[p.storage_path];
            if (url) map[p.id] = url;
          });
          setPhotoUrls(map);
        } else {
          setPhotoUrls({});
        }
      } else {
        setItems([]);
        setPhotoUrls({});
      }
    } else {
      setPhases([]);
      setItems([]);
      setPhotoUrls({});
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const applyTemplate = async () => {
    if (!applyId || !user) return;
    setApplying(true);
    try {
      const tpl = templates.find((t) => t.id === applyId);
      if (!tpl) throw new Error("Template not found");

      // Load template phases + items
      const { data: tphs } = await supabase
        .from("workflow_template_phases" as any)
        .select("id, position, name, description, requires_signoff")
        .eq("template_id", applyId)
        .order("position", { ascending: true });
      const tphList = ((tphs as any[]) ?? []) as {
        id: string;
        position: number;
        name: string;
        description: string | null;
        requires_signoff: boolean;
      }[];
      const tphIds = tphList.map((p) => p.id);
      const { data: titems } = tphIds.length
        ? await supabase
            .from("workflow_template_items" as any)
            .select("id, phase_id, position, kind, label, required")
            .in("phase_id", tphIds)
            .order("position", { ascending: true })
        : { data: [] as any[] };
      const titemList = ((titems as any[]) ?? []) as {
        phase_id: string;
        position: number;
        kind: ItemKind;
        label: string;
        required: boolean;
      }[];

      // Create workflow
      const { data: wf, error: wfErr } = await supabase
        .from("project_workflows" as any)
        .insert({
          project_id: projectId,
          template_id: applyId,
          name: tpl.name,
          description: tpl.description,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (wfErr || !wf) throw wfErr ?? new Error("Failed");
      const wfId = (wf as any).id as string;

      // Create phases sequentially to preserve order and capture ids
      for (const tph of tphList) {
        const { data: newPh, error: phErr } = await supabase
          .from("project_workflow_phases" as any)
          .insert({
            workflow_id: wfId,
            position: tph.position,
            name: tph.name,
            description: tph.description,
            requires_signoff: tph.requires_signoff,
          })
          .select("id")
          .single();
        if (phErr || !newPh) throw phErr ?? new Error("Failed");
        const newPhId = (newPh as any).id as string;
        const phItems = titemList.filter((i) => i.phase_id === tph.id);
        if (phItems.length) {
          await supabase.from("project_workflow_items" as any).insert(
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
      toast.success(`Workflow “${tpl.name}” applied`);
      setApplyId("");
      setApplyOpen(false);
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to apply workflow");
    } finally {
      setApplying(false);
    }
  };

  const deleteWorkflow = async (w: Workflow) => {
    if (!confirm(`Remove workflow “${w.name}” from this project?`)) return;
    const { error } = await supabase
      .from("project_workflows" as any)
      .delete()
      .eq("id", w.id);
    if (error) toast.error("Failed");
    else void load();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center rounded-3xl border border-border bg-card/70 p-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="text-[10.88px] font-extrabold uppercase tracking-[1.5232px] text-muted-foreground">
            Standardize the record
          </p>
          <h2 className="font-display mt-3 text-4xl font-bold leading-none tracking-[-1.68px] text-foreground sm:text-5xl">
            Workflows with a clear next step
          </h2>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Turn repeatable site processes into a shared, visible routine.
          </p>
        </div>
        <Button
          onClick={() => setApplyOpen(true)}
          className="h-8 gap-2 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
        >
          <WorkflowIcon className="h-4 w-4" />
          Add workflow
        </Button>
      </div>

      {workflows.length === 0 ? (
        <div className="mt-6 flex flex-col items-center rounded-3xl border border-dashed border-border bg-card/60 p-12 text-center">
          <WorkflowIcon className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 max-w-sm text-sm text-muted-foreground">
            No workflow on this project yet. Apply a template to track phases like Pre-Job, Install,
            Inspection, and Handover.
          </p>
          <Button
            onClick={() => setApplyOpen(true)}
            className="mt-4 rounded-lg bg-primary px-4 text-xs font-bold text-primary-foreground hover:bg-primary/90"
          >
            <WorkflowIcon className="mr-1.5 h-4 w-4" />
            Add workflow
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {workflows.map((w, idx) => {
            const wPhases = phases.filter((p) => p.workflow_id === w.id);
            const wItems = items
              .filter((i) => wPhases.some((p) => p.id === i.phase_id))
              .slice(0, 3);
            const variant = CARD_VARIANTS[idx % CARD_VARIANTS.length];
            if (expandedId === w.id) {
              return (
                <div key={w.id} className="sm:col-span-3">
                  <button
                    type="button"
                    onClick={() => setExpandedId(null)}
                    className="mb-3 text-xs font-extrabold text-muted-foreground hover:text-foreground"
                  >
                    ← Collapse
                  </button>
                  <WorkflowCard
                    workflow={w}
                    phases={wPhases}
                    items={items}
                    photoUrls={photoUrls}
                    projectId={projectId}
                    onChange={load}
                    onDelete={() => void deleteWorkflow(w)}
                  />
                </div>
              );
            }
            return (
              <div
                key={w.id}
                className={`flex flex-col justify-between gap-6 rounded-3xl p-6 ${
                  variant === "dark"
                    ? "bg-sidebar text-sidebar-foreground"
                    : variant === "blue"
                      ? "bg-sidebar-ring text-sidebar-foreground"
                      : "border border-border bg-card text-foreground"
                }`}
              >
                <span
                  className={`flex h-11 w-11 items-center justify-center rounded-2xl ${
                    variant === "light"
                      ? "bg-muted text-foreground"
                      : "bg-sidebar-foreground/15 text-sidebar-foreground"
                  }`}
                >
                  <WorkflowIcon className="h-5 w-5" />
                </span>
                <div className="flex-1">
                  <p className="text-base font-extrabold">{w.name}</p>
                  <ol className="mt-6 space-y-3">
                    {wItems.length === 0 && (
                      <li
                        className={`text-xs ${variant === "light" ? "text-muted-foreground" : "text-sidebar-foreground/60"}`}
                      >
                        No steps yet.
                      </li>
                    )}
                    {wItems.map((it, i) => (
                      <li key={it.id} className="flex items-center gap-3">
                        <span
                          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                            variant === "light"
                              ? "bg-muted text-foreground"
                              : "bg-sidebar-foreground/15 text-sidebar-foreground"
                          }`}
                        >
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-xs font-bold">{it.label}</span>
                      </li>
                    ))}
                  </ol>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(w.id)}
                  className={`text-left text-xs font-extrabold hover:underline ${variant === "light" ? "text-foreground" : "text-sidebar-foreground"}`}
                >
                  Open workflow →
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a workflow</DialogTitle>
            <DialogDescription>
              Apply a template to start tracking phases on this project.
            </DialogDescription>
          </DialogHeader>
          {templates.length === 0 ? (
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>No templates yet.</span>
              <Button asChild size="sm" variant="outline">
                <Link to="/settings/workflows">Create one</Link>
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Select value={applyId} onValueChange={setApplyId}>
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue placeholder="Choose a template…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={() => void applyTemplate()}
                disabled={!applyId || applying}
                className="bg-primary hover:bg-primary/90"
              >
                {applying ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                Apply
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button asChild size="sm" variant="ghost" className="text-xs text-muted-foreground">
              <Link to="/settings/workflows">
                <Settings2 className="mr-1 h-3.5 w-3.5" />
                Manage templates
              </Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function WorkflowCard({
  workflow,
  phases,
  items,
  photoUrls,
  projectId,
  onChange,
  onDelete,
}: {
  workflow: Workflow;
  phases: Phase[];
  items: Item[];
  photoUrls: Record<string, string>;
  projectId: string;
  onChange: () => Promise<void> | void;
  onDelete: () => void;
}) {
  const allItems = useMemo(
    () => items.filter((i) => phases.some((p) => p.id === i.phase_id)),
    [items, phases],
  );
  const required = allItems.filter((i) => i.required);
  const requiredDone = required.filter((i) => isItemComplete(i)).length;
  const totalDone = allItems.filter((i) => isItemComplete(i)).length;
  const overallPct = allItems.length ? Math.round((totalDone / allItems.length) * 100) : 0;

  const signedPhases = phases.filter((p) => !p.requires_signoff || !!p.signed_off_at).length;
  const phasesComplete = phases.filter((p) => isPhaseComplete(p, items)).length;

  return (
    <div className="rounded-3xl border border-border bg-card/70 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold">{workflow.name}</h3>
          {workflow.description && (
            <p className="mt-0.5 text-xs text-muted-foreground">{workflow.description}</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              {phasesComplete} / {phases.length} phases complete
            </span>
            {required.length > 0 && (
              <span>
                {requiredDone} / {required.length} required done
              </span>
            )}
            <span>
              {signedPhases} / {phases.length} signed
            </span>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          aria-label="Remove workflow"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="mt-3">
        <Progress value={overallPct} className="h-2" />
        <p className="mt-1 text-right text-[11px] text-muted-foreground">{overallPct}%</p>
      </div>

      <div className="mt-4 space-y-2">
        {phases.map((ph) => (
          <PhaseRunner
            key={ph.id}
            phase={ph}
            items={items.filter((i) => i.phase_id === ph.id)}
            photoUrls={photoUrls}
            projectId={projectId}
            onChange={onChange}
          />
        ))}
      </div>
    </div>
  );
}

function isItemComplete(it: Item): boolean {
  if (it.kind === "check") return !!it.completed_at;
  if (it.kind === "photo") return !!it.photo_id;
  if (it.kind === "note") return !!(it.note_text && it.note_text.trim().length > 0);
  return false;
}

function isPhaseComplete(ph: Phase, allItems: Item[]): boolean {
  const its = allItems.filter((i) => i.phase_id === ph.id);
  const reqs = its.filter((i) => i.required);
  const reqsDone = reqs.every(isItemComplete);
  const signedOk = !ph.requires_signoff || !!ph.signed_off_at;
  return reqsDone && signedOk && its.length > 0;
}

function PhaseRunner({
  phase,
  items,
  photoUrls,
  projectId,
  onChange,
}: {
  phase: Phase;
  items: Item[];
  photoUrls: Record<string, string>;
  projectId: string;
  onChange: () => Promise<void> | void;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(true);
  const [notes, setNotes] = useState(phase.notes ?? "");
  const notesTimer = useRef<NodeJS.Timeout | null>(null);
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState("");
  const [signing, setSigning] = useState(false);

  useEffect(() => {
    setNotes(phase.notes ?? "");
  }, [phase.notes]);

  const totalRequired = items.filter((i) => i.required).length;
  const doneRequired = items.filter((i) => i.required && isItemComplete(i)).length;
  const total = items.length;
  const done = items.filter(isItemComplete).length;
  const complete = isPhaseComplete(phase, items);

  const persistNotes = (val: string) => {
    if (notesTimer.current) clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(async () => {
      await supabase
        .from("project_workflow_phases" as any)
        .update({ notes: val || null })
        .eq("id", phase.id);
    }, 600);
  };

  const toggleCheck = async (it: Item) => {
    const next = it.completed_at ? null : new Date().toISOString();
    await supabase
      .from("project_workflow_items" as any)
      .update({ completed_at: next, completed_by: next ? (user?.id ?? null) : null })
      .eq("id", it.id);
    await onChange();
  };

  const updateNote = async (it: Item, val: string) => {
    await supabase
      .from("project_workflow_items" as any)
      .update({ note_text: val || null })
      .eq("id", it.id);
  };

  const onPhotoFile = async (it: Item, file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image");
      return;
    }
    const tId = toast.loading("Uploading photo…");
    try {
      const file2 = await compressImageFile(file);
      const ext = (file2.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("site-photos")
        .upload(path, file2, { contentType: file2.type });
      if (upErr) throw upErr;
      const { data: row, error: insErr } = await supabase
        .from("photos")
        .insert({
          project_id: projectId,
          uploaded_by: user.id,
          storage_path: path,
          size_bytes: file2.size,
          caption: it.label,
          phase: "workflow",
        } as any)
        .select("id")
        .single();
      if (insErr || !row) throw insErr ?? new Error("Insert failed");
      await supabase
        .from("project_workflow_items" as any)
        .update({
          photo_id: (row as any).id,
          completed_at: new Date().toISOString(),
          completed_by: user.id,
        })
        .eq("id", it.id);
      toast.success("Photo saved", { id: tId });
      await onChange();
    } catch (e: any) {
      toast.error(e?.message ?? "Upload failed", { id: tId });
    }
  };

  const clearPhoto = async (it: Item) => {
    await supabase
      .from("project_workflow_items" as any)
      .update({ photo_id: null, completed_at: null, completed_by: null })
      .eq("id", it.id);
    await onChange();
  };

  const signOff = async () => {
    if (!signName.trim() || !user) return;
    setSigning(true);
    const { error } = await supabase
      .from("project_workflow_phases" as any)
      .update({
        signoff_name: signName.trim(),
        signed_off_by: user.id,
        signed_off_at: new Date().toISOString(),
      })
      .eq("id", phase.id);
    setSigning(false);
    if (error) {
      toast.error("Failed");
      return;
    }
    toast.success("Phase signed off");
    setSignOpen(false);
    setSignName("");
    await onChange();
  };

  const revokeSignoff = async () => {
    if (!confirm("Clear the sign-off for this phase?")) return;
    await supabase
      .from("project_workflow_phases" as any)
      .update({ signoff_name: null, signed_off_by: null, signed_off_at: null })
      .eq("id", phase.id);
    await onChange();
  };

  return (
    <div
      className={`rounded-lg border ${complete ? "border-emerald-500/40 bg-emerald-500/5" : "border-border bg-muted/20"}`}
    >
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">{phase.name}</span>
        {complete && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
        <div className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          <span>
            {done} / {total}
            {totalRequired > 0 && (
              <>
                {" "}
                · {doneRequired}/{totalRequired} req
              </>
            )}
          </span>
          {phase.requires_signoff && (
            <Badge variant={phase.signed_off_at ? "default" : "outline"} className="text-[10px]">
              <Signature className="mr-1 h-3 w-3" />
              {phase.signed_off_at ? "Signed" : "Sign-off"}
            </Badge>
          )}
        </div>
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-3 py-3">
          {items.length === 0 && (
            <p className="text-xs text-muted-foreground">No items in this phase.</p>
          )}

          {items.map((it) => {
            if (it.kind === "check") {
              return (
                <label
                  key={it.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border bg-card px-3 py-2"
                >
                  <Checkbox
                    checked={!!it.completed_at}
                    onCheckedChange={() => void toggleCheck(it)}
                  />
                  <span
                    className={`flex-1 text-sm ${it.completed_at ? "text-muted-foreground line-through" : ""}`}
                  >
                    {it.label}
                  </span>
                  {it.required && (
                    <Badge variant="outline" className="text-[10px]">
                      Required
                    </Badge>
                  )}
                </label>
              );
            }
            if (it.kind === "photo") {
              return (
                <PhotoItem
                  key={it.id}
                  item={it}
                  url={it.photo_id ? photoUrls[it.photo_id] : undefined}
                  onUpload={(f) => void onPhotoFile(it, f)}
                  onClear={() => void clearPhoto(it)}
                />
              );
            }
            // note
            return (
              <div key={it.id} className="rounded-md border border-border bg-card px-3 py-2">
                <div className="flex items-center gap-2">
                  <StickyNote className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1 text-sm font-medium">{it.label}</span>
                  {it.required && (
                    <Badge variant="outline" className="text-[10px]">
                      Required
                    </Badge>
                  )}
                </div>
                <Textarea
                  defaultValue={it.note_text ?? ""}
                  onBlur={(e) => void updateNote(it, e.target.value)}
                  placeholder="Type a note…"
                  rows={2}
                  className="mt-2 text-sm"
                />
              </div>
            );
          })}

          <div className="rounded-md border border-border bg-card px-3 py-2">
            <div className="mb-1 text-xs font-medium text-muted-foreground">Phase notes</div>
            <Textarea
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                persistNotes(e.target.value);
              }}
              placeholder="General notes for this phase…"
              rows={2}
              className="text-sm"
            />
          </div>

          {phase.requires_signoff && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-3 py-2">
              <Signature className="h-4 w-4 text-muted-foreground" />
              {phase.signed_off_at ? (
                <>
                  <div className="text-xs">
                    <span className="font-medium">{phase.signoff_name}</span>
                    <span className="ml-1 text-muted-foreground">
                      · {new Date(phase.signed_off_at).toLocaleString()}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => void revokeSignoff()}
                  >
                    Clear
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-xs text-muted-foreground">
                    Sign off when this phase is verified.
                  </span>
                  <Button size="sm" className="ml-auto" onClick={() => setSignOpen(true)}>
                    Sign off
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Sign off — {phase.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-sm font-medium">Your name</label>
            <Input
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              placeholder="Full name"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Records your name and the current time on this phase.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void signOff()} disabled={!signName.trim() || signing}>
              {signing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Sign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PhotoItem({
  item,
  url,
  onUpload,
  onClear,
}: {
  item: Item;
  url?: string;
  onUpload: (f: File) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <Camera className="h-4 w-4 text-muted-foreground" />
        <span className="flex-1 text-sm font-medium">{item.label}</span>
        {item.required && (
          <Badge variant="outline" className="text-[10px]">
            Required
          </Badge>
        )}
        {item.photo_id && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onUpload(f);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />

      {item.photo_id ? (
        <div className="mt-2 flex items-center gap-3">
          <div className="h-20 w-20 overflow-hidden rounded-md bg-muted">
            {url ? (
              <img
                src={url}
                alt={item.label}
                loading="lazy"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <ImageIcon className="h-5 w-5 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retake
            </Button>
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onClear}>
              Remove
            </Button>
          </div>
        </div>
      ) : (
        <Button
          size="sm"
          className="mt-2 w-full"
          variant="outline"
          onClick={() => inputRef.current?.click()}
        >
          <Camera className="mr-1.5 h-4 w-4" />
          Take / upload photo
        </Button>
      )}
    </div>
  );
}
