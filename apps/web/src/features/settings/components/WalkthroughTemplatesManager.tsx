import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  Camera,
  Copy,
  Loader2,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  Search,
  Trash2,
  Video,
  X,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { SURFACE_CARD } from "@/components/ui/surface";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { CATEGORY_ORDER, GENERAL_CATEGORY, makeCategoryRank } from "@/lib/template-categories";
import { useCompanySetup } from "@/hooks/use-company-setup";
import { WALKTHROUGH_STARTERS, type WalkthroughStarter } from "./walkthrough-starters";

/**
 * The walkthrough template library.
 *
 * The fifth component library from the client's spec: "Walkthrough template:
 * structured photo/video capture sequence." It is a standalone object with its
 * own table, built and edited here with no blueprint anywhere in sight, and
 * attachable to zero, one or many blueprints afterwards. That independence is
 * the entire point of the layer, so this screen deliberately knows nothing
 * about blueprints.
 *
 * A template is a named, ordered SHOT LIST. Each shot says what to capture and
 * why, and whether the crew may skip it. Applying one to a project turns each
 * shot into a capture step the crew ticks off - see the walkthrough branch of
 * applyProjectBlueprintService for how that lands.
 */

export type ShotCapture = "photo" | "video" | "note";

interface WalkthroughTemplate {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  archived: boolean;
  created_at: string;
}

interface Shot {
  id: string;
  template_id: string;
  position: number;
  label: string;
  description: string | null;
  capture: ShotCapture;
  required: boolean;
}

export const CAPTURE_META: Record<
  ShotCapture,
  { label: string; icon: typeof Camera; tint: string; hint: string }
> = {
  photo: {
    label: "Photo",
    icon: Camera,
    tint: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
    hint: "A still. The default, and what most shots want.",
  },
  video: {
    label: "Video",
    icon: Video,
    tint: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    hint: "A clip, for anything a still cannot show: running water, a fault under load.",
  },
  note: {
    label: "Note",
    icon: NotebookPen,
    tint: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    hint: "No capture. An instruction to follow or a reading to write down.",
  },
};

const CAPTURE_ORDER: ShotCapture[] = ["photo", "video", "note"];

/** Blank option value. Radix Select rejects an empty string as an item value. */
const NO_CATEGORY = "__none";

export function WalkthroughTemplatesManager({ canManage }: { canManage: boolean }) {
  const { user } = useAuth();
  const confirm = useConfirm();

  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<WalkthroughTemplate[]>([]);
  const [shots, setShots] = useState<Shot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [reordering, setReordering] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [startersOpen, setStartersOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCategory, setNewCategory] = useState<string>(NO_CATEGORY);
  const [busy, setBusy] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editCategory, setEditCategory] = useState<string>(NO_CATEGORY);

  /** The shot being added or edited. `null` when the dialog is closed. */
  const [shotDraft, setShotDraft] = useState<{
    id: string | null;
    label: string;
    description: string;
    capture: ShotCapture;
    required: boolean;
  } | null>(null);

  /**
   * True once a read has come back saying these tables do not exist, which on
   * this project means migration 20260908000000 has not been run yet. Rendered
   * as its own state rather than as an empty library, because "you have no
   * walkthroughs" and "this environment cannot store walkthroughs" are
   * different answers and only one of them is fixed by pressing New.
   */
  const [unavailable, setUnavailable] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tplRows, error: tplErr } = await supabase
      .from("walkthrough_templates" as any)
      .select("id, name, description, category, archived, created_at")
      .order("created_at", { ascending: true });
    if (tplErr) {
      // PostgREST reports an unknown relation as PGRST205 / 42P01.
      const code = (tplErr as { code?: string }).code;
      if (code === "PGRST205" || code === "42P01") {
        setUnavailable(true);
        setLoading(false);
        return;
      }
      toast.error(tplErr.message ?? "Couldn't load walkthrough templates");
      setLoading(false);
      return;
    }
    setUnavailable(false);
    const list = ((tplRows as any[]) ?? []) as WalkthroughTemplate[];
    setTemplates(list);

    if (list.length) {
      const { data: shotRows } = await supabase
        .from("walkthrough_template_shots" as any)
        .select("id, template_id, position, label, description, capture, required")
        .in(
          "template_id",
          list.map((t) => t.id),
        )
        .order("position", { ascending: true });
      setShots(((shotRows as any[]) ?? []) as Shot[]);
    } else {
      setShots([]);
    }

    setSelectedId((cur) => {
      if (cur && list.find((t) => t.id === cur)) return cur;
      return (list.find((t) => !t.archived) ?? list[0])?.id ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    void load();
  }, [user, load]);

  /*
   * The company's own trade leads, the same way it does on Checklists,
   * Workflows, Documents and Reports.
   *
   * `categoryRank` is the fixed opinion a brand new account sees; once a company
   * has said what they do, that opinion is wrong for them and
   * `makeCategoryRank` replaces it. Being the one library tab that ignored the
   * answer is exactly the drift the invariant in tests/trade-starters.ts exists
   * to catch, and this tab is now in its list.
   */
  const company = useCompanySetup();
  const rank = useMemo(
    () => makeCategoryRank(company.profile.industry, company.profile.trades),
    [company.profile.industry, company.profile.trades],
  );

  const visible = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return templates
      .filter((t) => {
        if (!showArchived && t.archived) return false;
        if (!q) return true;
        return `${t.name} ${t.description ?? ""} ${t.category ?? ""}`.toLowerCase().includes(q);
      })
      .sort(
        (a, b) =>
          rank(a.category || GENERAL_CATEGORY) - rank(b.category || GENERAL_CATEGORY) ||
          a.name.localeCompare(b.name),
      );
  }, [templates, showArchived, searchText, rank]);

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const selectedShots = useMemo(
    () =>
      shots
        .filter((s) => s.template_id === selectedId)
        .sort((a, b) => a.position - b.position || a.label.localeCompare(b.label)),
    [shots, selectedId],
  );
  const shotCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of shots) m.set(s.template_id, (m.get(s.template_id) ?? 0) + 1);
    return m;
  }, [shots]);

  /* ------------------------------------------------------------ templates */

  const createTemplate = async (
    name: string,
    description: string | null,
    category: string | null,
  ): Promise<string | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("walkthrough_templates" as any)
      .insert({
        created_by: user.id,
        name: name.trim(),
        description: description?.trim() || null,
        category,
      })
      .select("id")
      .single();
    if (error || !data) {
      toast.error(error?.message ?? "Couldn't create that walkthrough");
      return null;
    }
    return (data as any).id as string;
  };

  const submitCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    const id = await createTemplate(
      newName,
      newDesc,
      newCategory === NO_CATEGORY ? null : newCategory,
    );
    setBusy(false);
    if (!id) return;
    setNewName("");
    setNewDesc("");
    setNewCategory(NO_CATEGORY);
    setCreateOpen(false);
    setSelectedId(id);
    await load();
  };

  const createFromStarter = async (s: WalkthroughStarter) => {
    setBusy(true);
    try {
      const id = await createTemplate(s.name, s.description, s.category ?? null);
      if (!id) return;
      const { error } = await supabase.from("walkthrough_template_shots" as any).insert(
        s.shots.map((shot, idx) => ({
          template_id: id,
          position: idx,
          label: shot.label,
          description: shot.description ?? null,
          capture: shot.capture,
          required: !!shot.required,
        })),
      );
      // Reported rather than swallowed: a starter that lands as a named,
      // shotless template looks exactly like one the author forgot to fill in.
      if (error) toast.error(error.message ?? "Couldn't copy that starter's shots");
      else toast.success(`Created "${s.name}"`);
      setSelectedId(id);
      setStartersOpen(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (t: WalkthroughTemplate) => {
    setEditName(t.name);
    setEditDesc(t.description ?? "");
    setEditCategory(t.category ?? NO_CATEGORY);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selected || !editName.trim()) return;
    setBusy(true);
    const { error } = await supabase
      .from("walkthrough_templates" as any)
      .update({
        name: editName.trim(),
        description: editDesc.trim() || null,
        category: editCategory === NO_CATEGORY ? null : editCategory,
      })
      .eq("id", selected.id);
    setBusy(false);
    if (error) return toast.error(error.message ?? "Couldn't save");
    setEditOpen(false);
    await load();
  };

  const duplicateTemplate = async (t: WalkthroughTemplate) => {
    const id = await createTemplate(`${t.name} (copy)`, t.description, t.category);
    if (!id) return;
    const mine = shots
      .filter((s) => s.template_id === t.id)
      .sort((a, b) => a.position - b.position);
    if (mine.length) {
      const { error } = await supabase.from("walkthrough_template_shots" as any).insert(
        mine.map((s, idx) => ({
          template_id: id,
          position: idx,
          label: s.label,
          description: s.description,
          capture: s.capture,
          required: s.required,
        })),
      );
      if (error) {
        toast.error(error.message ?? "Couldn't copy the shots");
        await load();
        return;
      }
    }
    toast.success("Walkthrough duplicated");
    setSelectedId(id);
    await load();
  };

  const toggleArchived = async (t: WalkthroughTemplate) => {
    const { error } = await supabase
      .from("walkthrough_templates" as any)
      .update({ archived: !t.archived })
      .eq("id", t.id);
    if (error) toast.error(error.message ?? "Couldn't archive");
    else await load();
  };

  const deleteTemplate = async (t: WalkthroughTemplate) => {
    const ok = await confirm({
      title: `Delete "${t.name}"?`,
      description:
        "Projects it has already been applied to keep their copy. Blueprints that reference it will show the section as missing until you remove it. This cannot be undone.",
      confirmText: "Delete walkthrough",
      variant: "destructive",
    });
    if (!ok) return;
    const { error } = await supabase
      .from("walkthrough_templates" as any)
      .delete()
      .eq("id", t.id);
    if (error) return toast.error(error.message ?? "Couldn't delete");
    if (selectedId === t.id) setSelectedId(null);
    await load();
  };

  /* ---------------------------------------------------------------- shots */

  const saveShot = async () => {
    if (!shotDraft || !selectedId || !shotDraft.label.trim()) return;
    setBusy(true);
    const payload = {
      label: shotDraft.label.trim(),
      description: shotDraft.description.trim() || null,
      capture: shotDraft.capture,
      required: shotDraft.required,
    };
    const { error } = shotDraft.id
      ? await supabase
          .from("walkthrough_template_shots" as any)
          .update(payload)
          .eq("id", shotDraft.id)
      : await supabase.from("walkthrough_template_shots" as any).insert({
          ...payload,
          template_id: selectedId,
          // max+1 over this template's rows rather than `selectedShots.length`.
          // Deleting a shot never renumbers the survivors, so length is
          // gap-blind and can hand the new shot a position a sibling holds.
          position: selectedShots.reduce((max, s) => Math.max(max, s.position), -1) + 1,
        });
    setBusy(false);
    if (error) return toast.error(error.message ?? "Couldn't save that shot");
    setShotDraft(null);
    await load();
  };

  const deleteShot = async (s: Shot) => {
    setShots((xs) => xs.filter((x) => x.id !== s.id));
    const { error } = await supabase
      .from("walkthrough_template_shots" as any)
      .delete()
      .eq("id", s.id);
    if (error) {
      toast.error(error.message ?? "Couldn't remove that shot");
      await load();
    }
  };

  const moveShot = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= selectedShots.length) return;
    const next = [...selectedShots];
    [next[index], next[target]] = [next[target], next[index]];
    setReordering(true);
    try {
      const results = await Promise.all(
        next.map((s, idx) =>
          supabase
            .from("walkthrough_template_shots" as any)
            .update({ position: idx })
            .eq("id", s.id),
        ),
      );
      // Without this the reorder is a silent no-op: the row does not move and
      // nothing anywhere says why.
      const bad = results.find((r: any) => r?.error);
      if (bad) throw (bad as any).error;
      await load();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't reorder the shots");
      await load();
    } finally {
      setReordering(false);
    }
  };

  /* --------------------------------------------------------------- render */

  if (unavailable) {
    return (
      <Card className="p-8 text-center">
        <Camera className="mx-auto h-7 w-7 text-muted-foreground" />
        <h3 className="mt-3 text-sm font-bold">Walkthroughs aren't available here yet</h3>
        <p className="mx-auto mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
          This workspace's database is still missing the walkthrough tables, so shot lists can't be
          saved. Everything else on this page works as usual. Run migration
          20260908000000_blueprint_component_libraries.sql and reload.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="flex items-center justify-center p-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </Card>
    );
  }

  if (templates.length === 0) {
    return (
      <>
        <EmptyState
          icon={Camera}
          title="No walkthrough shot lists yet"
          description={
            canManage
              ? "A walkthrough is the sequence of shots a crew works through on site, so the same job is documented the same way every time. Build one here, then bundle it into a blueprint."
              : "Ask your account owner or an admin to create one."
          }
          action={
            canManage ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button onClick={() => setStartersOpen(true)}>
                  <Camera className="mr-1.5 h-4 w-4" />
                  Start from a trade
                </Button>
                <Button variant="outline" onClick={() => setCreateOpen(true)}>
                  <Plus className="mr-1.5 h-4 w-4" />
                  Blank walkthrough
                </Button>
              </div>
            ) : null
          }
        />
        {dialogs()}
      </>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      {/* Library rail */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search walkthroughs…"
            className="h-10 rounded-xl pl-9"
          />
        </div>

        <div className={cn(SURFACE_CARD, "overflow-hidden")}>
          <div className="flex items-center justify-between gap-2 border-b border-border/60 py-1.5 pl-3 pr-1.5">
            <button
              className="truncate text-xs font-bold text-muted-foreground hover:text-foreground"
              onClick={() => setShowArchived((s) => !s)}
            >
              {showArchived ? "Hide archived" : "Show archived"}
            </button>
            {canManage && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs font-bold"
                  onClick={() => setStartersOpen(true)}
                >
                  Starters
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-lg px-2 text-xs font-bold"
                  onClick={() => setCreateOpen(true)}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  New
                </Button>
              </div>
            )}
          </div>
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-muted-foreground">
              No walkthroughs match your search.
            </p>
          ) : (
            <ul className="max-h-[62vh] divide-y divide-border/60 overflow-y-auto">
              {visible.map((t) => {
                const isSelected = selectedId === t.id;
                const n = shotCount.get(t.id) ?? 0;
                return (
                  <li key={t.id} className="relative">
                    {isSelected && (
                      <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-primary" />
                    )}
                    <button
                      onClick={() => setSelectedId(t.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-1.5 px-3.5 py-3 text-left transition-colors",
                        isSelected ? "bg-primary/[0.06]" : "hover:bg-muted/50",
                      )}
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-bold">{t.name}</span>
                        {t.archived && (
                          <Badge variant="outline" className="shrink-0 text-[10px]">
                            Archived
                          </Badge>
                        )}
                      </div>
                      {t.description && (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {t.description}
                        </p>
                      )}
                      <div className="flex w-full items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span>
                          {n} shot{n === 1 ? "" : "s"}
                        </span>
                        {t.category && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate">{t.category}</span>
                          </>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Detail */}
      {!selected ? (
        <Card className="flex flex-col items-center justify-center gap-2 p-16 text-center">
          <Camera className="h-6 w-6 text-muted-foreground/70" />
          <p className="text-sm font-semibold">Select a walkthrough</p>
          <p className="text-xs text-muted-foreground">
            Pick one from the list to see and edit its shots.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                    <Camera className="h-4.5 w-4.5" />
                  </span>
                  <h2 className="font-display truncate text-xl font-bold tracking-tight">
                    {selected.name}
                  </h2>
                  {selected.archived && <Badge variant="outline">Archived</Badge>}
                </div>
                {selected.description && (
                  <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                    {selected.description}
                  </p>
                )}
                <p className="mt-2.5 text-xs text-muted-foreground">
                  {selected.category ?? GENERAL_CATEGORY}
                </p>
              </div>

              {canManage && (
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-lg"
                    onClick={() => openEdit(selected)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Edit
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8 rounded-lg"
                        aria-label="More actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuItem onClick={() => void duplicateTemplate(selected)}>
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => void toggleArchived(selected)}>
                        {selected.archived ? (
                          <>
                            <ArchiveRestore className="mr-2 h-4 w-4" />
                            Unarchive
                          </>
                        ) : (
                          <>
                            <Archive className="mr-2 h-4 w-4" />
                            Archive
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => void deleteTemplate(selected)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
            </div>
          </div>

          <div className={cn(SURFACE_CARD, "p-5")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold tracking-tight">Shots</h3>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {selectedShots.length} shot{selectedShots.length === 1 ? "" : "s"}, captured in
                  this order
                </p>
              </div>
              {canManage && (
                <Button
                  size="sm"
                  className="rounded-lg"
                  onClick={() =>
                    setShotDraft({
                      id: null,
                      label: "",
                      description: "",
                      capture: "photo",
                      required: false,
                    })
                  }
                >
                  <Plus className="mr-1.5 h-4 w-4" />
                  Add shot
                </Button>
              )}
            </div>

            {selectedShots.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-10 text-center">
                <Camera className="h-6 w-6 text-muted-foreground/70" />
                <p className="mt-2 text-sm font-semibold">No shots yet</p>
                <p className="mt-0.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
                  Add the shots in the order the crew will walk the site. Each one becomes a step
                  they tick off on the project.
                </p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {selectedShots.map((s, idx) => {
                  const meta = CAPTURE_META[s.capture] ?? CAPTURE_META.photo;
                  const Icon = meta.icon;
                  return (
                    <li
                      key={s.id}
                      className="group flex items-center gap-2.5 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors hover:border-border"
                    >
                      <span className="w-3.5 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground/70">
                        {idx + 1}
                      </span>
                      <span
                        className={cn(
                          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
                          meta.tint,
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-semibold">{s.label}</span>
                          {s.required && (
                            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-destructive">
                              Required
                            </span>
                          )}
                        </span>
                        {s.description && (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {s.description}
                          </span>
                        )}
                      </span>
                      <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:block">
                        {meta.label}
                      </span>
                      {canManage && (
                        <div className="flex shrink-0 items-center transition-opacity focus-within:opacity-100 group-hover:opacity-100 sm:opacity-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground disabled:opacity-30"
                            disabled={idx === 0 || reordering}
                            onClick={() => void moveShot(idx, -1)}
                            aria-label={`Move ${s.label} up`}
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground disabled:opacity-30"
                            disabled={idx === selectedShots.length - 1 || reordering}
                            onClick={() => void moveShot(idx, 1)}
                            aria-label={`Move ${s.label} down`}
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground"
                            onClick={() =>
                              setShotDraft({
                                id: s.id,
                                label: s.label,
                                description: s.description ?? "",
                                capture: s.capture,
                                required: s.required,
                              })
                            }
                            aria-label={`Edit ${s.label}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => void deleteShot(s)}
                            aria-label={`Remove ${s.label}`}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      {dialogs()}
    </div>
  );

  /**
   * The four dialogs, in one place.
   *
   * Declared as a closure rather than four inline blocks because the zero-state
   * branch returns early and still has to be able to open Create and Starters -
   * duplicating them there is how the two copies drift apart.
   */
  function dialogs() {
    if (!canManage) return null;
    return (
      <>
        {/* Create */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New walkthrough</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Pre-work site condition"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description (optional)
                </label>
                <Textarea
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={2}
                  className="mt-1"
                  placeholder="When does the crew run this one?"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trade (optional)
                </label>
                <Select value={newCategory} onValueChange={setNewCategory}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void submitCreate()} disabled={!newName.trim() || busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Starters */}
        <Dialog open={startersOpen} onOpenChange={setStartersOpen}>
          <DialogContent className="max-h-[85vh] max-w-lg overflow-hidden p-0">
            <DialogHeader className="border-b border-border px-5 py-4">
              <DialogTitle>Start from a trade</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto px-5 py-4">
              {[...WALKTHROUGH_STARTERS]
                .sort(
                  (a, b) =>
                    (a.category ? rank(a.category) : Number.MAX_SAFE_INTEGER) -
                      (b.category ? rank(b.category) : Number.MAX_SAFE_INTEGER) ||
                    a.name.localeCompare(b.name),
                )
                .map((s) => (
                  <button
                    key={s.name}
                    disabled={busy}
                    onClick={() => void createFromStarter(s)}
                    className="flex w-full items-center gap-3 rounded-xl border border-border/60 bg-card px-3.5 py-3 text-left transition-colors hover:border-primary/40 disabled:opacity-50"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400">
                      <Camera className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">{s.name}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {s.shots.length} shots · {s.category ?? GENERAL_CATEGORY}
                      </span>
                    </span>
                  </button>
                ))}
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit */}
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit walkthrough</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </label>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Description
                </label>
                <Textarea
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  rows={3}
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Trade
                </label>
                <Select value={editCategory} onValueChange={setEditCategory}>
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_CATEGORY}>{GENERAL_CATEGORY}</SelectItem>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void saveEdit()} disabled={!editName.trim() || busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Shot */}
        <Dialog open={!!shotDraft} onOpenChange={(o) => !o && setShotDraft(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{shotDraft?.id ? "Edit shot" : "Add shot"}</DialogTitle>
            </DialogHeader>
            {shotDraft && (
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    What to capture
                  </label>
                  <Input
                    value={shotDraft.label}
                    onChange={(e) => setShotDraft({ ...shotDraft, label: e.target.value })}
                    placeholder="e.g. Meter reading before work starts"
                    className="mt-1"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Why, or how (optional)
                  </label>
                  <Textarea
                    value={shotDraft.description}
                    onChange={(e) => setShotDraft({ ...shotDraft, description: e.target.value })}
                    rows={2}
                    className="mt-1"
                    placeholder="Framed so the serial number is legible."
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Capture type
                  </label>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {CAPTURE_ORDER.map((c) => {
                      const meta = CAPTURE_META[c];
                      const Icon = meta.icon;
                      const on = shotDraft.capture === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setShotDraft({ ...shotDraft, capture: c })}
                          className={cn(
                            "flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 transition",
                            on
                              ? "border-primary bg-primary/[0.06]"
                              : "border-border hover:bg-muted",
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          <span className="text-xs font-bold">{meta.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                    {CAPTURE_META[shotDraft.capture].hint}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={shotDraft.required}
                    onChange={(e) => setShotDraft({ ...shotDraft, required: e.target.checked })}
                    className="h-4 w-4 rounded border-border"
                  />
                  <span className="font-medium">Required</span>
                  <span className="text-xs text-muted-foreground">
                    The crew can't close the walkthrough without it
                  </span>
                </label>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setShotDraft(null)}>
                Cancel
              </Button>
              <Button onClick={() => void saveShot()} disabled={!shotDraft?.label.trim() || busy}>
                {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {shotDraft?.id ? "Save" : "Add shot"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }
}
