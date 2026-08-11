import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Workflow as WorkflowIcon,
  Plus,
  Loader2,
  Camera,
  Check,
  Trash2,
  ChevronDown,
  CheckCircle2,
  Signature,
  Images,
  RefreshCw,
  Settings2,
  ListTree,
  CircleDot,
  MoreHorizontal,
  Upload,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { compressImageFile } from "@/features/photos/components/CameraCapture";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { PhotoThumb } from "@/components/PhotoThumb";
import { QuietTextarea } from "@/components/builder/builder-ui";
import { useAutosave, type SaveState } from "@/components/builder/use-autosave";
import { SURFACE_BUTTON } from "@/components/ui/surface";
import { KIND_META, type ItemKind } from "@/lib/workflow-items";
import { friendlyError } from "@/lib/supabase-errors";
import { cn } from "@/lib/utils";
import {
  RunnerCard,
  RunnerCardSkeleton,
  RunnerDetailHeader,
  RunnerDetailShell,
  RunnerGrid,
  RunnerPanelHeader,
  RunnerProgress,
  RunnerStat,
  RunnerStatusPill,
} from "./runner/runner-ui";
import type { RunTone } from "./runner/runner-tokens";
import { BlueprintItemBadge } from "./BlueprintItemBadge";

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
  completed_by: string | null;
  photo_id: string | null;
  note_text: string | null;
}
/** Enough of a photo row to render a thumbnail that can re-sign itself. */
interface PhotoRef {
  storage_path: string;
  image_url: string | null;
}

const TABLES = {
  workflows: "project_workflows",
  phases: "project_workflow_phases",
  items: "project_workflow_items",
} as const;

/* ------------------------------------------------------------ completeness */

function isItemComplete(it: Item): boolean {
  if (it.kind === "photo") return !!it.photo_id;
  if (it.kind === "note") return !!it.note_text?.trim();
  return !!it.completed_at;
}

interface PhaseState {
  total: number;
  done: number;
  requiredTotal: number;
  requiredDone: number;
  signedOk: boolean;
  /** Something mandatory is outstanding — the phase cannot be closed. */
  blocked: boolean;
  /** Nothing left to do here at all. */
  complete: boolean;
}

/**
 * What is outstanding in one phase.
 *
 * Two rules worth spelling out, because the previous version got both wrong:
 *
 * 1. A phase with no steps is *not* permanently unfinished. The designer lets
 *    you save an empty phase, and the old `items.length > 0` clause meant one
 *    empty phase pinned the "Now" marker to itself forever, hid every phase
 *    after it, and made the workflow impossible to finish.
 * 2. "Blocked" (required work outstanding) and "complete" (nothing left at all)
 *    are different questions. A phase of purely optional steps blocks nothing,
 *    but it still isn't done — so it keeps the cursor until the crew ticks it
 *    or moves past it, instead of being silently skipped.
 */
function phaseState(ph: Phase, its: Item[]): PhaseState {
  const required = its.filter((i) => i.required);
  const requiredDone = required.filter(isItemComplete).length;
  const done = its.filter(isItemComplete).length;
  const signedOk = !ph.requires_signoff || !!ph.signed_off_at;
  const blocked = requiredDone < required.length || !signedOk;
  return {
    total: its.length,
    done,
    requiredTotal: required.length,
    requiredDone,
    signedOk,
    blocked,
    complete: !blocked && done === its.length,
  };
}

interface WorkflowState {
  phases: Phase[];
  items: Item[];
  itemsByPhase: Map<string, Item[]>;
  stateByPhase: Map<string, PhaseState>;
  total: number;
  done: number;
  requiredTotal: number;
  requiredDone: number;
  signoffTotal: number;
  signoffDone: number;
  phasesComplete: number;
  activePhaseId: string | null;
  /** Every phase can be closed — the run is ready to be signed off as done. */
  canComplete: boolean;
  isComplete: boolean;
  tone: RunTone;
  statusLabel: string;
  /** The next few unfinished steps, for the collapsed card. */
  upNext: { item: Item; phaseName: string }[];
}

function workflowState(wf: Workflow, allPhases: Phase[], allItems: Item[]): WorkflowState {
  const phases = allPhases
    .filter((p) => p.workflow_id === wf.id)
    .sort((a, b) => a.position - b.position);
  const phaseIds = new Set(phases.map((p) => p.id));
  const items = allItems.filter((i) => phaseIds.has(i.phase_id));

  const itemsByPhase = new Map<string, Item[]>();
  for (const it of items) {
    const bucket = itemsByPhase.get(it.phase_id);
    if (bucket) bucket.push(it);
    else itemsByPhase.set(it.phase_id, [it]);
  }
  for (const bucket of itemsByPhase.values()) bucket.sort((a, b) => a.position - b.position);

  const stateByPhase = new Map<string, PhaseState>();
  for (const ph of phases) stateByPhase.set(ph.id, phaseState(ph, itemsByPhase.get(ph.id) ?? []));

  const required = items.filter((i) => i.required);
  const signoffPhases = phases.filter((p) => p.requires_signoff);
  const activePhaseId = phases.find((p) => !stateByPhase.get(p.id)!.complete)?.id ?? null;
  const canComplete = phases.length > 0 && phases.every((p) => !stateByPhase.get(p.id)!.blocked);
  const isComplete = !!wf.completed_at;
  const done = items.filter(isItemComplete).length;

  // Walk phases in order so "up next" reads like the job does. The old preview
  // sliced the first three rows of a list ordered by item position across every
  // phase at once, which surfaced the *first step of the first three phases*
  // and numbered them 01/02/03 as though they were consecutive.
  const upNext: { item: Item; phaseName: string }[] = [];
  for (const ph of phases) {
    for (const it of itemsByPhase.get(ph.id) ?? []) {
      if (upNext.length >= 3) break;
      if (!isItemComplete(it)) upNext.push({ item: it, phaseName: ph.name });
    }
    if (upNext.length >= 3) break;
  }

  return {
    phases,
    items,
    itemsByPhase,
    stateByPhase,
    total: items.length,
    done,
    requiredTotal: required.length,
    requiredDone: required.filter(isItemComplete).length,
    signoffTotal: signoffPhases.length,
    signoffDone: signoffPhases.filter((p) => !!p.signed_off_at).length,
    phasesComplete: phases.filter((p) => stateByPhase.get(p.id)!.complete).length,
    activePhaseId,
    canComplete,
    isComplete,
    // Amber is reserved for "something is outstanding". "Ready to finish" is a
    // good state, so it shares the active tone and is distinguished by its
    // label and a near-full bar. It also requires actual progress: a workflow
    // whose steps are all optional is technically unblocked from the moment it
    // is applied, and reporting an untouched job as ready to close is a lie.
    tone: isComplete ? "complete" : done > 0 ? "active" : "idle",
    statusLabel: isComplete
      ? "Complete"
      : canComplete && done > 0
        ? "Ready to finish"
        : done > 0
          ? "In progress"
          : "Not started",
    upNext,
  };
}

/* =========================================================================== */

export function ProjectWorkflows({
  projectId,
  blueprintSources,
  onChanged,
}: {
  projectId: string;
  /**
   * Source template id → the blueprint that brought it in, from the project's
   * blueprint ledger. Keyed on `template_id`, which this panel already selects.
   *
   * Deliberately a lookup rather than a `template_id !== null` test: applying a
   * workflow template on its own also sets `template_id`, so testing for null
   * would badge hand-applied workflows as blueprint output.
   */
  blueprintSources?: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
  /** Lets the host refresh its tab counts without remounting this panel. */
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const confirm = useConfirm();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [phases, setPhases] = useState<Phase[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [photos, setPhotos] = useState<Record<string, PhotoRef>>({});
  const [applyId, setApplyId] = useState<string>("");
  const [applying, setApplying] = useState(false);
  const [applyOpen, setApplyOpen] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  /** When this browser last changed something, so realtime can defer to it. */
  const lastLocalEdit = useRef(0);

  const save = useAutosave(
    (table, id, patch) =>
      supabase
        .from(table as any)
        .update(patch)
        .eq("id", id)
        .then((r: any) => {
          if (r.error) throw r.error;
        }),
    { onError: () => toast.error("Couldn't save that change — check your connection") },
  );

  /**
   * `silent` keeps the panel mounted while it refreshes.
   *
   * Every write used to round-trip through a loud reload, which unmounted the
   * open workflow and every phase inside it — losing scroll position, which
   * phases you had expanded, and any half-typed note. Only the very first load
   * is allowed to show a skeleton.
   */
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [wfRes, tplRes] = await Promise.all([
          supabase
            .from(TABLES.workflows as any)
            .select("id, project_id, template_id, name, description, started_at, completed_at")
            .eq("project_id", projectId)
            .order("started_at", { ascending: true }),
          supabase
            .from("workflow_templates" as any)
            .select("id, name, description")
            .eq("archived", false)
            .order("name", { ascending: true }),
        ]);
        // Swallowing read errors made an offline crew see "No workflow on this
        // project yet" and add a second copy of one they already had.
        if (wfRes.error) throw wfRes.error;

        const wfList = ((wfRes.data as any[]) ?? []) as Workflow[];
        setWorkflows(wfList);
        setTemplates(((tplRes.data as any[]) ?? []) as Template[]);

        if (!wfList.length) {
          setPhases([]);
          setItems([]);
          setPhotos({});
          setLoadError(false);
          return;
        }

        const phRes = await supabase
          .from(TABLES.phases as any)
          .select(
            "id, workflow_id, position, name, description, requires_signoff, notes, signed_off_by, signed_off_at, signoff_name",
          )
          .in(
            "workflow_id",
            wfList.map((w) => w.id),
          )
          .order("position", { ascending: true });
        if (phRes.error) throw phRes.error;
        const phList = ((phRes.data as any[]) ?? []) as Phase[];
        setPhases(phList);

        if (!phList.length) {
          setItems([]);
          setPhotos({});
          setLoadError(false);
          return;
        }

        const itRes = await supabase
          .from(TABLES.items as any)
          .select(
            "id, phase_id, position, kind, label, required, completed_at, completed_by, photo_id, note_text",
          )
          .in(
            "phase_id",
            phList.map((p) => p.id),
          )
          .order("position", { ascending: true });
        if (itRes.error) throw itRes.error;
        const itList = ((itRes.data as any[]) ?? []) as Item[];
        setItems(itList);

        const photoIds = Array.from(
          new Set(itList.map((i) => i.photo_id).filter((x): x is string => !!x)),
        );
        if (photoIds.length) {
          // Keep the storage path so PhotoThumb can sign a transformed
          // thumbnail on demand — that is what stops a tab left open past the
          // old one-hour expiry from filling with broken images.
          //
          // But still batch-sign the original as the fallback. Transformation
          // needs a paid Supabase plan, and PhotoThumb latches a module-level
          // "unavailable" flag on the first failure of the session, after which
          // it falls straight through to `fallbackUrl`. Workflow photos are
          // inserted without an `image_url`, so handing over the bare column
          // would leave that fallback null and render a permanent grey pulse
          // over a photo the crew had just taken as evidence.
          const { data: rows } = await supabase
            .from("photos")
            .select("id, storage_path, image_url")
            .in("id", photoIds);
          const photoRows = ((rows as any[]) ?? []) as {
            id: string;
            storage_path: string;
            image_url: string | null;
          }[];

          const unsigned = photoRows.filter((p) => !p.image_url).map((p) => p.storage_path);
          const signedByPath: Record<string, string> = {};
          if (unsigned.length) {
            const { data: signed } = await supabase.storage
              .from("site-photos")
              .createSignedUrls(unsigned, 3600);
            signed?.forEach((s, i) => {
              if (s.signedUrl) signedByPath[unsigned[i]] = s.signedUrl;
            });
          }

          const map: Record<string, PhotoRef> = {};
          for (const p of photoRows) {
            map[p.id] = {
              storage_path: p.storage_path,
              image_url: p.image_url ?? signedByPath[p.storage_path] ?? null,
            };
          }
          setPhotos(map);
        } else {
          setPhotos({});
        }
        setLoadError(false);
      } catch {
        setLoadError(true);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime was published for these tables from day one but never subscribed
  // to. Trailing-debounced so a burst of writes (applying a template inserts a
  // row per step) settles into one refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Our own writes echo back through this channel. Refetching while
        // someone is mid-sentence would replace what they are typing with the
        // older server copy, so hold off until the local edits settle.
        if (Date.now() - lastLocalEdit.current < 2000) {
          refresh();
          return;
        }
        void load({ silent: true });
      }, 400);
    };
    const ch = supabase
      .channel(`project-workflows:${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: TABLES.workflows,
          filter: `project_id=eq.${projectId}`,
        },
        refresh,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.phases }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: TABLES.items }, refresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  const states = useMemo(() => {
    const map = new Map<string, WorkflowState>();
    for (const w of workflows) map.set(w.id, workflowState(w, phases, items));
    return map;
  }, [workflows, phases, items]);

  const open = openId ? (workflows.find((w) => w.id === openId) ?? null) : null;
  const openState = open ? states.get(open.id)! : null;

  /* ------------------------------------------------------------ mutations */

  const applyTemplate = async () => {
    if (!applyId || !user) return;
    setApplying(true);
    let createdId: string | null = null;
    try {
      const tpl = templates.find((t) => t.id === applyId);
      if (!tpl) throw new Error("That template is no longer available");

      const { data: tphs, error: tphErr } = await supabase
        .from("workflow_template_phases" as any)
        .select("id, position, name, description, requires_signoff")
        .eq("template_id", applyId)
        .order("position", { ascending: true });
      if (tphErr) throw tphErr;
      const tphList = ((tphs as any[]) ?? []) as {
        id: string;
        name: string;
        description: string | null;
        requires_signoff: boolean;
      }[];

      const { data: titems, error: titErr } = tphList.length
        ? await supabase
            .from("workflow_template_items" as any)
            .select("phase_id, position, kind, label, required")
            .in(
              "phase_id",
              tphList.map((p) => p.id),
            )
            .order("position", { ascending: true })
        : { data: [] as any[], error: null };
      if (titErr) throw titErr;
      const titemList = ((titems as any[]) ?? []) as {
        phase_id: string;
        position: number;
        kind: ItemKind;
        label: string;
        required: boolean;
      }[];

      const { data: wf, error: wfErr } = await supabase
        .from(TABLES.workflows as any)
        .insert({
          project_id: projectId,
          template_id: applyId,
          name: tpl.name,
          description: tpl.description,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (wfErr || !wf) throw wfErr ?? new Error("Couldn't start that workflow");
      createdId = (wf as any).id as string;

      // Two batched inserts rather than 2N+1 sequential round trips. The old
      // loop had no cleanup, so a failure partway through left a half-built
      // workflow sitting on the project.
      if (tphList.length) {
        const { data: newPhases, error: phErr } = await supabase
          .from(TABLES.phases as any)
          .insert(
            tphList.map((ph, idx) => ({
              workflow_id: createdId,
              position: idx,
              name: ph.name,
              description: ph.description,
              requires_signoff: ph.requires_signoff,
            })),
          )
          .select("id, position");
        if (phErr) throw phErr;

        const idByPosition = new Map<number, string>();
        for (const row of ((newPhases as any[]) ?? []) as { id: string; position: number }[]) {
          idByPosition.set(row.position, row.id);
        }
        const rows = tphList.flatMap((ph, idx) => {
          const newPhaseId = idByPosition.get(idx);
          if (!newPhaseId) return [];
          return titemList
            .filter((i) => i.phase_id === ph.id)
            .map((it, i) => ({
              phase_id: newPhaseId,
              position: i,
              kind: it.kind,
              label: it.label,
              required: it.required,
            }));
        });
        if (rows.length) {
          const { error: itErr } = await supabase.from(TABLES.items as any).insert(rows);
          if (itErr) throw itErr;
        }
      }

      toast.success(`“${tpl.name}” started on this project`);
      setApplyId("");
      setApplyOpen(false);
      await load({ silent: true });
      setOpenId(createdId);
      onChanged?.();
    } catch (e: any) {
      // Cascades to phases and items, so the project is left exactly as it was.
      if (createdId) {
        await supabase
          .from(TABLES.workflows as any)
          .delete()
          .eq("id", createdId);
      }
      toast.error(friendlyError(e, "Couldn't start that workflow"));
    } finally {
      setApplying(false);
    }
  };

  /** Optimistic, with rollback — a tick has to land under your finger. */
  const toggleItem = async (it: Item) => {
    lastLocalEdit.current = Date.now();
    const next = it.completed_at ? null : new Date().toISOString();
    const patch = { completed_at: next, completed_by: next ? (user?.id ?? null) : null };
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.items as any)
        .update(patch)
        .eq("id", it.id),
    );
    if (!ok) setItems((prev) => prev.map((x) => (x.id === it.id ? it : x)));
  };

  /**
   * Typed text goes through the debounced queue, and — critically — updates
   * local state too. It used to write straight to Postgres and update nothing,
   * so a required note item never registered as answered: the phase stayed
   * blocked and the workflow could never be finished.
   */
  const setItemNote = (it: Item, value: string) => {
    lastLocalEdit.current = Date.now();
    const text = value || null;
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, note_text: text } : x)));
    save.queueSave(TABLES.items, it.id, { note_text: text });
  };

  const setPhaseNotes = (ph: Phase, value: string) => {
    lastLocalEdit.current = Date.now();
    const text = value || null;
    setPhases((prev) => prev.map((x) => (x.id === ph.id ? { ...x, notes: text } : x)));
    save.queueSave(TABLES.phases, ph.id, { notes: text });
  };

  const attachPhoto = async (it: Item, file: File) => {
    if (!user) return;
    if (!file.type.startsWith("image/")) {
      toast.error("That file isn't an image");
      return;
    }
    const toastId = toast.loading("Uploading photo…");
    try {
      const compressed = await compressImageFile(file);
      const ext = (compressed.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${user.id}/${projectId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("site-photos")
        .upload(path, compressed, { contentType: compressed.type });
      if (upErr) throw upErr;

      const { data: row, error: insErr } = await supabase
        .from("photos")
        .insert({
          project_id: projectId,
          uploaded_by: user.id,
          storage_path: path,
          size_bytes: compressed.size,
          caption: it.label,
          phase: "workflow",
        } as any)
        .select("id, storage_path, image_url")
        .single();
      if (insErr || !row) {
        // Reclaim the orphaned upload before bailing — no row will reference
        // it, so no delete path can ever find it again.
        void supabase.storage.from("site-photos").remove([path]);
        throw insErr ?? new Error("Couldn't save that photo");
      }

      const photoId = (row as any).id as string;
      const patch = {
        photo_id: photoId,
        completed_at: new Date().toISOString(),
        completed_by: user.id,
      };
      const { error: linkErr } = await supabase
        .from(TABLES.items as any)
        .update(patch)
        .eq("id", it.id);
      if (linkErr) throw linkErr;

      // Same fallback rule as load(): a photo row is inserted without an
      // `image_url`, so sign the original now rather than leaving PhotoThumb
      // with nothing to fall back to if transformation is unavailable.
      const { data: signed } = await supabase.storage
        .from("site-photos")
        .createSignedUrl(path, 3600);
      setPhotos((prev) => ({
        ...prev,
        [photoId]: {
          storage_path: (row as any).storage_path,
          image_url: (row as any).image_url ?? signed?.signedUrl ?? null,
        },
      }));
      setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
      toast.success("Photo saved", { id: toastId });
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't upload that photo"), { id: toastId });
    }
  };

  const detachPhoto = async (it: Item) => {
    if (
      !(await confirm({
        title: "Remove this photo from the step?",
        description:
          "The step goes back to needing a photo. The photo itself stays in the project gallery.",
        confirmText: "Remove from step",
        variant: "destructive",
      }))
    )
      return;
    const patch = { photo_id: null, completed_at: null, completed_by: null };
    const before = it;
    setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, ...patch } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.items as any)
        .update(patch)
        .eq("id", it.id),
    );
    if (!ok) setItems((prev) => prev.map((x) => (x.id === it.id ? before : x)));
  };

  const signOff = async (ph: Phase, name: string) => {
    if (!user) return false;
    const patch = {
      signoff_name: name.trim(),
      signed_off_by: user.id,
      signed_off_at: new Date().toISOString(),
    };
    const before = ph;
    setPhases((prev) => prev.map((x) => (x.id === ph.id ? { ...x, ...patch } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.phases as any)
        .update(patch)
        .eq("id", ph.id),
    );
    if (!ok) {
      setPhases((prev) => prev.map((x) => (x.id === ph.id ? before : x)));
      return false;
    }
    toast.success(`${ph.name} signed off`);
    return true;
  };

  const revokeSignoff = async (ph: Phase) => {
    if (
      !(await confirm({
        title: "Clear this sign-off?",
        description: `“${ph.name}” will reopen and ${ph.signoff_name ?? "the signature"} will be removed from the record.`,
        confirmText: "Clear sign-off",
        variant: "destructive",
      }))
    )
      return;
    const patch = { signoff_name: null, signed_off_by: null, signed_off_at: null };
    const before = ph;
    setPhases((prev) => prev.map((x) => (x.id === ph.id ? { ...x, ...patch } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.phases as any)
        .update(patch)
        .eq("id", ph.id),
    );
    if (!ok) setPhases((prev) => prev.map((x) => (x.id === ph.id ? before : x)));
  };

  /**
   * `project_workflows.completed_at` has existed since the first migration and
   * was never written — "Complete" was only ever derived, so nothing recorded
   * *when* a job's process was actually signed off as done.
   */
  const setWorkflowComplete = async (wf: Workflow, complete: boolean) => {
    const patch = { completed_at: complete ? new Date().toISOString() : null };
    const before = wf;
    setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? { ...x, ...patch } : x)));
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.workflows as any)
        .update(patch)
        .eq("id", wf.id),
    );
    if (!ok) {
      setWorkflows((prev) => prev.map((x) => (x.id === wf.id ? before : x)));
      return;
    }
    toast.success(complete ? `“${wf.name}” marked complete` : `“${wf.name}” reopened`);
    onChanged?.();
  };

  const deleteWorkflow = async (wf: Workflow) => {
    const st = states.get(wf.id);
    const parts = [
      `${st?.phases.length ?? 0} phase${st?.phases.length === 1 ? "" : "s"}`,
      `${st?.total ?? 0} step${st?.total === 1 ? "" : "s"}`,
    ];
    if (st?.signoffDone) parts.push(`${st.signoffDone} sign-off${st.signoffDone === 1 ? "" : "s"}`);
    if (
      !(await confirm({
        title: "Delete this workflow?",
        description: `“${wf.name}” and its record on this project — ${parts.join(", ")} — will be permanently removed. Photos already taken stay in the project gallery.`,
        confirmText: "Delete workflow",
        variant: "destructive",
      }))
    )
      return;

    const before = workflows;
    setWorkflows((prev) => prev.filter((x) => x.id !== wf.id));
    if (openId === wf.id) setOpenId(null);
    const ok = await save.runImmediate(() =>
      supabase
        .from(TABLES.workflows as any)
        .delete()
        .eq("id", wf.id),
    );
    if (ok) {
      void load({ silent: true });
      onChanged?.();
    } else {
      setWorkflows(before);
    }
  };

  /* ---------------------------------------------------------------- view */

  const headerAction = (
    <Button onClick={() => setApplyOpen(true)} className={cn(SURFACE_BUTTON, "bg-primary")}>
      <WorkflowIcon className="h-4 w-4" />
      Add workflow
    </Button>
  );

  const summary = (() => {
    if (loading) return "Multi-phase processes with photo prompts, notes, and sign-off gates.";
    if (!workflows.length)
      return "Turn a repeatable site process into a shared routine the whole crew can see.";
    const running = workflows.filter((w) => !w.completed_at);
    if (!running.length)
      return `All ${workflows.length} workflow${workflows.length === 1 ? "" : "s"} on this job are complete.`;
    const first = states.get(running[0].id);
    const phase = first?.phases.find((p) => p.id === first.activePhaseId);
    return phase
      ? `${running.length} in progress · “${running[0].name}” is on ${phase.name}.`
      : `${running.length} workflow${running.length === 1 ? "" : "s"} in progress on this job.`;
  })();

  return (
    <>
      <RunnerPanelHeader
        eyebrow="Standardize the record"
        title="Workflows with a clear next step"
        description={summary}
        actions={headerAction}
      />

      {loading ? (
        <RunnerGrid>
          <RunnerCardSkeleton />
          <RunnerCardSkeleton />
          <RunnerCardSkeleton />
        </RunnerGrid>
      ) : loadError ? (
        <ErrorState
          className="mt-6"
          title="Couldn't load workflows"
          description="You may be offline. Nothing has been lost — try again once you have a connection."
          onRetry={() => void load()}
        />
      ) : open && openState ? (
        <WorkflowRunner
          workflow={open}
          state={openState}
          photos={photos}
          saveState={save.state}
          onBack={() => setOpenId(null)}
          onToggleItem={toggleItem}
          onItemNote={setItemNote}
          onPhaseNotes={setPhaseNotes}
          onAttachPhoto={attachPhoto}
          onDetachPhoto={detachPhoto}
          onSignOff={signOff}
          onRevokeSignoff={revokeSignoff}
          onSetComplete={(c) => void setWorkflowComplete(open, c)}
          onDelete={() => void deleteWorkflow(open)}
        />
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          className="mt-6"
          title="No workflow on this job yet"
          description="Apply a template to track phases like Pre-Job, Install, Inspection and Handover — each with its own steps, photo prompts and sign-off."
          action={
            <Button onClick={() => setApplyOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />
              Add a workflow
            </Button>
          }
        />
      ) : (
        <RunnerGrid>
          {workflows.map((w) => {
            const st = states.get(w.id)!;
            return (
              <RunnerCard
                key={w.id}
                icon={WorkflowIcon}
                tone={st.tone}
                title={w.name}
                statusLabel={st.statusLabel}
                meta={
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <span>
                      {st.total === 0
                        ? "No steps in this workflow"
                        : `${st.done} of ${st.total} steps · ${st.phasesComplete}/${st.phases.length} phases`}
                    </span>
                    <BlueprintItemBadge
                      source={w.template_id ? blueprintSources?.[w.template_id] : null}
                    />
                  </span>
                }
                done={st.done}
                total={st.total}
                progressLabel={`${w.name} progress`}
                onOpen={() => setOpenId(w.id)}
                detail={st.upNext.length > 0 ? <CardUpNext state={st} /> : undefined}
              />
            );
          })}
        </RunnerGrid>
      )}

      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a workflow</DialogTitle>
            <DialogDescription>
              Apply a workflow template to start tracking phases on this project.
            </DialogDescription>
          </DialogHeader>
          {templates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-muted/25 p-5 text-center">
              <p className="text-sm text-muted-foreground">
                You don't have any workflow templates yet.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link to="/settings/workflows">
                  <Plus className="mr-1.5 h-4 w-4" />
                  Design your first workflow
                </Link>
              </Button>
            </div>
          ) : (
            <Select value={applyId} onValueChange={setApplyId}>
              <SelectTrigger className="h-10">
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
          )}
          <DialogFooter className="sm:justify-between">
            <Button asChild size="sm" variant="ghost" className="text-xs text-muted-foreground">
              <Link to="/settings/workflows">
                <Settings2 className="mr-1 h-3.5 w-3.5" />
                Manage templates
              </Link>
            </Button>
            {templates.length > 0 && (
              <Button onClick={() => void applyTemplate()} disabled={!applyId || applying}>
                {applying ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 h-4 w-4" />
                )}
                Start workflow
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------- card detail */

function CardUpNext({ state }: { state: WorkflowState }) {
  return (
    <div className="space-y-1.5">
      <p className="font-manrope text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground">
        Up next
      </p>
      {state.upNext.map(({ item, phaseName }) => {
        const Icon = KIND_META[item.kind].icon;
        return (
          <div key={item.id} className="flex items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="line-clamp-1 flex-1 text-xs font-semibold text-foreground/85">
              {item.label || "Untitled step"}
            </span>
            <span className="hidden shrink-0 text-[10.5px] text-muted-foreground sm:inline">
              {phaseName}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- runner */

function WorkflowRunner({
  workflow,
  state,
  photos,
  saveState,
  onBack,
  onToggleItem,
  onItemNote,
  onPhaseNotes,
  onAttachPhoto,
  onDetachPhoto,
  onSignOff,
  onRevokeSignoff,
  onSetComplete,
  onDelete,
}: {
  workflow: Workflow;
  state: WorkflowState;
  photos: Record<string, PhotoRef>;
  saveState: SaveState;
  onBack: () => void;
  onToggleItem: (it: Item) => void;
  onItemNote: (it: Item, v: string) => void;
  onPhaseNotes: (ph: Phase, v: string) => void;
  onAttachPhoto: (it: Item, f: File) => void;
  onDetachPhoto: (it: Item) => void;
  onSignOff: (ph: Phase, name: string) => Promise<boolean>;
  onRevokeSignoff: (ph: Phase) => void;
  onSetComplete: (complete: boolean) => void;
  onDelete: () => void;
}) {
  /**
   * Auto-advance: open the phase the crew is working, fold away the one it
   * finished — but never out from under their hands.
   *
   * A note step counts as answered on its first character, so typing into one
   * completes its phase and moves the cursor to the next. Replacing the open
   * set outright then unmounted the very textarea being typed in: focus fell
   * to the body and, on a phone, the keyboard dropped after one letter. So the
   * previously auto-opened phase is only folded away when nothing inside it
   * holds focus, and a phase the user opened by hand is never closed for them.
   */
  const [openPhases, setOpenPhases] = useState<string[]>([]);
  const autoOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    const next = state.activePhaseId;
    const previous = autoOpenedRef.current;
    autoOpenedRef.current = next;
    if (previous === next) return;

    let fold: string | null = null;
    if (previous) {
      const panel = document.getElementById(`phase-panel-${previous}`);
      if (!panel?.contains(document.activeElement)) fold = previous;
    }
    setOpenPhases((prev) => {
      const kept = fold ? prev.filter((id) => id !== fold) : prev;
      if (!next || kept.includes(next)) return kept;
      return [...kept, next];
    });
  }, [state.activePhaseId]);

  // Send focus to the run when it opens; the old text link left focus on
  // <body>, so a keyboard user had to tab from the top of the page again.
  const headingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, [workflow.id]);

  return (
    <RunnerDetailShell>
      <div ref={headingRef} tabIndex={-1} className="outline-none">
        <RunnerDetailHeader
          icon={WorkflowIcon}
          tone={state.tone}
          title={workflow.name}
          description={workflow.description}
          saveState={saveState}
          onBack={onBack}
          backLabel="All workflows"
          done={state.done}
          total={state.total}
          progressLabel={`${workflow.name} progress`}
          stats={
            <>
              <RunnerStat icon={ListTree}>
                {state.phasesComplete}/{state.phases.length} phases
              </RunnerStat>
              <RunnerStat icon={CircleDot}>
                {state.done}/{state.total} steps
              </RunnerStat>
              {state.requiredTotal > 0 && (
                <RunnerStat
                  tone={state.requiredDone < state.requiredTotal ? "blocked" : "complete"}
                >
                  {state.requiredDone}/{state.requiredTotal} required
                </RunnerStat>
              )}
              {/* Only shown when sign-offs exist. It used to count phases that
                  never needed a signature as "signed", so a workflow with no
                  gates at all proudly reported "4 / 4 signed". */}
              {state.signoffTotal > 0 && (
                <RunnerStat
                  icon={Signature}
                  tone={state.signoffDone < state.signoffTotal ? "blocked" : "complete"}
                >
                  {state.signoffDone}/{state.signoffTotal} signed
                </RunnerStat>
              )}
            </>
          }
          actions={
            <>
              {state.isComplete ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="hidden sm:inline-flex"
                  onClick={() => onSetComplete(false)}
                >
                  <Undo2 className="mr-1.5 h-4 w-4" />
                  Reopen
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="hidden sm:inline-flex"
                  disabled={!state.canComplete}
                  onClick={() => onSetComplete(true)}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />
                  Mark complete
                </Button>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Workflow actions">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  {state.isComplete ? (
                    <DropdownMenuItem className="sm:hidden" onClick={() => onSetComplete(false)}>
                      <Undo2 className="mr-2 h-4 w-4" />
                      Reopen workflow
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      className="sm:hidden"
                      disabled={!state.canComplete}
                      onClick={() => onSetComplete(true)}
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      Mark complete
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator className="sm:hidden" />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={onDelete}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete workflow
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          }
          banner={
            state.isComplete ? (
              <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Completed {new Date(workflow.completed_at!).toLocaleDateString()} — reopen it to
                make changes.
              </div>
            ) : !state.canComplete && state.requiredDone < state.requiredTotal ? (
              <div className="mt-2.5 flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] font-semibold text-amber-700 dark:text-amber-300">
                {state.requiredTotal - state.requiredDone} required step
                {state.requiredTotal - state.requiredDone === 1 ? "" : "s"} left before this
                workflow can be closed.
              </div>
            ) : null
          }
        />
      </div>

      <div className="space-y-2.5 px-3 py-4 sm:px-5">
        {state.phases.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            This workflow has no phases. Edit its template to add some.
          </p>
        ) : (
          <div className="relative">
            {/* Connector between the numbered phase badges. Phase cards carry
                bg-card and come later in the DOM, so it only shows in the gaps. */}
            {state.phases.length > 1 && (
              <span
                aria-hidden
                className="absolute bottom-8 left-[26px] top-8 w-px bg-border sm:left-[28px]"
              />
            )}
            <div className="space-y-2.5">
              {state.phases.map((ph, idx) => (
                <PhaseCard
                  key={ph.id}
                  index={idx}
                  phase={ph}
                  items={state.itemsByPhase.get(ph.id) ?? []}
                  phaseState={state.stateByPhase.get(ph.id)!}
                  isActive={ph.id === state.activePhaseId}
                  locked={state.isComplete}
                  photos={photos}
                  open={openPhases.includes(ph.id)}
                  onOpenChange={(next) =>
                    setOpenPhases((prev) =>
                      next ? [...prev, ph.id] : prev.filter((id) => id !== ph.id),
                    )
                  }
                  onToggleItem={onToggleItem}
                  onItemNote={onItemNote}
                  onPhaseNotes={onPhaseNotes}
                  onAttachPhoto={onAttachPhoto}
                  onDetachPhoto={onDetachPhoto}
                  onSignOff={onSignOff}
                  onRevokeSignoff={onRevokeSignoff}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </RunnerDetailShell>
  );
}

/* ------------------------------------------------------------------ phase */

function PhaseCard({
  index,
  phase,
  items,
  phaseState: st,
  isActive,
  locked,
  photos,
  open,
  onOpenChange,
  onToggleItem,
  onItemNote,
  onPhaseNotes,
  onAttachPhoto,
  onDetachPhoto,
  onSignOff,
  onRevokeSignoff,
}: {
  index: number;
  phase: Phase;
  items: Item[];
  phaseState: PhaseState;
  isActive: boolean;
  /** The whole workflow is closed — nothing here should invite an edit. */
  locked: boolean;
  photos: Record<string, PhotoRef>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleItem: (it: Item) => void;
  onItemNote: (it: Item, v: string) => void;
  onPhaseNotes: (ph: Phase, v: string) => void;
  onAttachPhoto: (it: Item, f: File) => void;
  onDetachPhoto: (it: Item) => void;
  onSignOff: (ph: Phase, name: string) => Promise<boolean>;
  onRevokeSignoff: (ph: Phase) => void;
}) {
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState("");
  const [signing, setSigning] = useState(false);
  const panelId = `phase-panel-${phase.id}`;

  const tone: RunTone = st.complete ? "complete" : isActive ? "active" : "idle";
  const requiredLeft = st.requiredTotal - st.requiredDone;

  const submitSignOff = async () => {
    if (!signName.trim()) return;
    setSigning(true);
    const ok = await onSignOff(phase, signName);
    setSigning(false);
    if (ok) {
      setSignOpen(false);
      setSignName("");
    }
  };

  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-card transition-colors",
        st.complete
          ? "border-emerald-500/30"
          : isActive
            ? "border-primary/40 ring-1 ring-primary/10"
            : "border-border",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center gap-2.5 rounded-2xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:px-3"
      >
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-extrabold",
            st.complete
              ? "border-emerald-500/30 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
              : isActive
                ? "border-primary/25 bg-primary/10 text-primary"
                : "border-border bg-muted text-muted-foreground",
          )}
        >
          {st.complete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-sm font-bold text-foreground">{phase.name}</span>
            {isActive && !st.complete && <RunnerStatusPill tone="active">Now</RunnerStatusPill>}
            {requiredLeft > 0 && (
              <RunnerStatusPill tone="blocked">{requiredLeft} required left</RunnerStatusPill>
            )}
            {phase.requires_signoff && !phase.signed_off_at && requiredLeft === 0 && (
              <RunnerStatusPill tone="blocked" icon={Signature}>
                Sign-off due
              </RunnerStatusPill>
            )}
            {phase.requires_signoff && phase.signed_off_at && (
              <RunnerStatusPill tone="complete" icon={Signature}>
                Signed
              </RunnerStatusPill>
            )}
          </span>
          {/* Solicited by the designer ("What has to be true before this phase
              is done?") and, until now, rendered nowhere the crew could see. */}
          {phase.description && (
            <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-muted-foreground">
              {phase.description}
            </span>
          )}
        </span>

        <span className="flex shrink-0 items-center gap-2">
          <span className="hidden text-[11px] font-semibold tabular-nums text-muted-foreground sm:inline">
            {st.done}/{st.total}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              !open && "-rotate-90",
            )}
          />
        </span>
      </button>

      {st.total > 0 && (
        <div className="px-2.5 pb-2.5 sm:px-3">
          <RunnerProgress
            done={st.done}
            total={st.total}
            tone={tone}
            label={`${phase.name} progress`}
            className="h-1"
          />
        </div>
      )}

      {open && (
        <div id={panelId} className="space-y-2 border-t border-border/70 px-2.5 py-2.5 sm:px-3">
          {items.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No steps in this phase — it's a marker, nothing to tick off.
            </p>
          ) : (
            items.map((it) =>
              it.kind === "check" ? (
                <CheckStep key={it.id} item={it} locked={locked} onToggle={onToggleItem} />
              ) : it.kind === "photo" ? (
                <PhotoStep
                  key={it.id}
                  item={it}
                  photo={it.photo_id ? photos[it.photo_id] : undefined}
                  locked={locked}
                  onAttach={(f) => onAttachPhoto(it, f)}
                  onDetach={() => onDetachPhoto(it)}
                />
              ) : (
                <NoteStep
                  key={it.id}
                  item={it}
                  locked={locked}
                  onChange={(v) => onItemNote(it, v)}
                />
              ),
            )
          )}

          <div className="rounded-xl border border-border bg-muted/25 px-2.5 py-2">
            <label
              htmlFor={`phase-notes-${phase.id}`}
              className="px-1 font-manrope text-[10px] font-extrabold uppercase tracking-[0.1em] text-muted-foreground"
            >
              Phase notes
            </label>
            <QuietTextarea
              id={`phase-notes-${phase.id}`}
              value={phase.notes ?? ""}
              disabled={locked}
              onChange={(e) => onPhaseNotes(phase, e.target.value)}
              placeholder="Anything the office should know about this phase…"
              className="mt-0.5 text-[13px]"
            />
          </div>

          {phase.requires_signoff && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5",
                phase.signed_off_at
                  ? "border-emerald-500/30 bg-emerald-500/[0.07]"
                  : "border-amber-500/30 bg-amber-500/[0.07]",
              )}
            >
              <Signature
                className={cn(
                  "h-4 w-4 shrink-0",
                  phase.signed_off_at
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-amber-600 dark:text-amber-400",
                )}
              />
              {phase.signed_off_at ? (
                <>
                  <span className="min-w-0 text-xs">
                    <span className="font-bold text-foreground">{phase.signoff_name}</span>
                    <span className="ml-1.5 text-muted-foreground">
                      {new Date(phase.signed_off_at).toLocaleString()}
                    </span>
                  </span>
                  {!locked && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto min-h-9 text-xs"
                      onClick={() => onRevokeSignoff(phase)}
                    >
                      Clear
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    {st.requiredDone < st.requiredTotal
                      ? `Finish the ${st.requiredTotal - st.requiredDone} required step${st.requiredTotal - st.requiredDone === 1 ? "" : "s"} above, then sign off.`
                      : "Sign off to close this phase."}
                  </span>
                  <Button
                    size="sm"
                    className="ml-auto min-h-9"
                    disabled={locked || st.requiredDone < st.requiredTotal}
                    onClick={() => setSignOpen(true)}
                  >
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
            <DialogDescription>
              This records your name and the current time against this phase. It can be cleared
              later, but the change is part of the job's record.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <label htmlFor={`signoff-${phase.id}`} className="text-sm font-medium">
              Your name
            </label>
            <Input
              id={`signoff-${phase.id}`}
              value={signName}
              onChange={(e) => setSignName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && signName.trim()) {
                  e.preventDefault();
                  void submitSignOff();
                }
              }}
              placeholder="Full name"
              autoFocus
              className="text-base sm:text-sm"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSignOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void submitSignOff()} disabled={!signName.trim() || signing}>
              {signing && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Sign off
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------ steps */

const STEP_ROW = "rounded-xl border border-border bg-background/60 transition-colors";

function RequiredChip() {
  return (
    <span className="shrink-0 rounded-full border border-amber-500/40 bg-amber-500/12 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-amber-700 dark:text-amber-300">
      Required
    </span>
  );
}

function CheckStep({
  item,
  locked,
  onToggle,
}: {
  item: Item;
  locked: boolean;
  onToggle: (it: Item) => void;
}) {
  const done = !!item.completed_at;
  return (
    /*
     * The whole row is one control, which is what a gloved hand needs.
     *
     * The box is drawn rather than composed from the shadcn `Checkbox`: that
     * renders a Radix `<button>`, and nesting a button inside this row button
     * is invalid markup. The previous version dodged that by wrapping the
     * Radix control in a bare `<label>` with no `htmlFor`, which let a tap
     * both forward to the button and fire natively — ticking, then unticking.
     */
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      disabled={locked}
      onClick={() => onToggle(item)}
      className={cn(
        STEP_ROW,
        "flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left hover:border-primary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-70",
        done && "bg-emerald-500/[0.05]",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "grid h-5 w-5 shrink-0 place-content-center rounded-[5px] border shadow-sm transition-colors",
          done ? "border-emerald-500 bg-emerald-500 text-white" : "border-primary bg-transparent",
        )}
      >
        {done && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
      </span>
      <span
        className={cn(
          "flex-1 text-sm",
          done ? "text-muted-foreground line-through" : "font-medium text-foreground",
        )}
      >
        {item.label}
      </span>
      {item.required && !done && <RequiredChip />}
    </button>
  );
}

function NoteStep({
  item,
  locked,
  onChange,
}: {
  item: Item;
  locked: boolean;
  onChange: (v: string) => void;
}) {
  const Icon = KIND_META.note.icon;
  const filled = !!item.note_text?.trim();
  return (
    <div className={cn(STEP_ROW, "px-3 py-2.5", filled && "bg-emerald-500/[0.05]")}>
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            filled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        />
        <label htmlFor={`note-${item.id}`} className="flex-1 text-sm font-medium text-foreground">
          {item.label}
        </label>
        {item.required && !filled && <RequiredChip />}
      </div>
      <QuietTextarea
        id={`note-${item.id}`}
        value={item.note_text ?? ""}
        disabled={locked}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type your answer…"
        className="mt-1 text-base sm:text-sm"
      />
    </div>
  );
}

function PhotoStep({
  item,
  photo,
  locked,
  onAttach,
  onDetach,
}: {
  item: Item;
  photo?: PhotoRef;
  locked: boolean;
  onAttach: (f: File) => void;
  onDetach: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState(false);
  const Icon = KIND_META.photo.icon;
  const filled = !!item.photo_id;

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onAttach(f);
    e.target.value = "";
  };

  return (
    <div className={cn(STEP_ROW, "px-3 py-2.5", filled && "bg-emerald-500/[0.05]")}>
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4 shrink-0",
            filled ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
        />
        <span className="flex-1 text-sm font-medium text-foreground">{item.label}</span>
        {item.required && !filled && <RequiredChip />}
        {filled && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
      </div>

      {/* Two inputs, not one. A single `capture="environment"` input under a
          button labelled "Take / upload photo" makes the library unreachable on
          iOS Safari and Android Chrome — the upload half never worked. */}
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={pick}
      />
      <input ref={libraryRef} type="file" accept="image/*" className="hidden" onChange={pick} />

      {photo || filled ? (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => photo && setZoom(true)}
            aria-label={`View photo for ${item.label}`}
            className="h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {photo ? (
              <PhotoThumb
                storagePath={photo.storage_path}
                fallbackUrl={photo.image_url}
                width={128}
                alt={item.label}
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center bg-muted">
                <Images className="h-5 w-5 text-muted-foreground" />
              </span>
            )}
          </button>
          {!locked && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="min-h-9"
                onClick={() => cameraRef.current?.click()}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Retake
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="min-h-9 text-muted-foreground"
                onClick={onDetach}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      ) : (
        !locked && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              onClick={() => cameraRef.current?.click()}
            >
              <Camera className="mr-1.5 h-4 w-4" />
              Take photo
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-11"
              onClick={() => libraryRef.current?.click()}
            >
              <Upload className="mr-1.5 h-4 w-4" />
              Upload
            </Button>
          </div>
        )
      )}

      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-w-3xl p-2 sm:p-3">
          <DialogHeader className="sr-only">
            <DialogTitle>{item.label}</DialogTitle>
            <DialogDescription>Photo captured for this workflow step.</DialogDescription>
          </DialogHeader>
          {photo && (
            <PhotoThumb
              storagePath={photo.storage_path}
              fallbackUrl={photo.image_url}
              width={1200}
              alt={item.label}
              className="object-contain"
              // PhotoThumb observes this element, so it needs a real height —
              // `h-full` against an auto-height dialog would collapse it.
              wrapperClassName="h-[70vh] w-full rounded-xl bg-transparent"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
