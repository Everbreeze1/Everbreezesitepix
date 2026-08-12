import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  ListPlus,
  Loader2,
  Plus,
  Settings2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { SURFACE_BUTTON } from "@/components/ui/surface";
import { friendlyError } from "@/lib/supabase-errors";
import {
  RunnerCard,
  RunnerCardSkeleton,
  RunnerGrid,
  RunnerPanelHeader,
  RunnerStatusPill,
} from "./runner/runner-ui";
import { toneForProgress } from "./runner/runner-tokens";
import { BlueprintItemBadge } from "./BlueprintItemBadge";

/**
 * The Checklists panel: a list of records on this job, and the fastest possible
 * way to start another one.
 *
 * It used to be the whole feature. Opening a checklist raised an 88vh dialog
 * that carried the entire runner — every answer widget, the photo picker, the
 * bulk-paste flow, complete/delete/save-as-template — which is why a checklist
 * could not be printed, linked to, or shared with the customer it was filled in
 * for. All of that now lives at
 * `/projects/$projectId/checklists/$checklistId` (`ChecklistDocumentPage`), and
 * this panel is a list again.
 *
 * Creating one is a menu, not a form. The old flow was: click New checklist →
 * modal → choose template in a select → name it → choose an assignee → Create →
 * modal closes → find the card → click it → *now* start typing items. Six steps
 * before the first item. A blueprint template is one click and you land on the
 * page ready to fill it in; a blank one is one click and you land with the title
 * selected.
 */

interface Template {
  id: string;
  name: string;
  description: string | null;
}

interface Checklist {
  id: string;
  project_id: string;
  name: string;
  created_at: string;
  created_by: string;
  assigned_to: string | null;
  completed_at: string | null;
  snapshot?: any;
  /** The checklist template this was copied from, for the blueprint badge. */
  template_id?: string | null;
}

/**
 * Just enough of an item to draw a progress bar.
 *
 * Deliberately narrower than the runner's `ChecklistItem`: this panel renders no
 * answers, so it selects what it counts and nothing else. It used to pull
 * `response_value`, `description` and every note for every item on every
 * checklist in the project purely to caption "3/8 done".
 */
interface ChecklistItemCount {
  id: string;
  checklist_id: string;
  position: number;
  required: boolean;
  completed_at: string | null;
}

/** The name a blank checklist starts life with, before the user renames it. */
const UNTITLED = "Untitled checklist";

export function ProjectChecklists({
  projectId,
  blueprintSources,
  onChanged,
}: {
  projectId: string;
  /**
   * Source template id → the blueprint that brought it in. A lookup, not a
   * `template_id !== null` test: applying a checklist template directly (below,
   * and in ApplyTemplateDialog) also stamps `template_id`, so a null-check would
   * badge hand-applied checklists as blueprint output.
   */
  blueprintSources?: Record<string, { blueprintId: string | null; blueprintName: string | null }>;
  /** Lets the host refresh its tab counts without remounting this panel. */
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [items, setItems] = useState<ChecklistItemCount[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [creating, setCreating] = useState(false);
  const [tab, setTab] = useState<"active" | "completed">("active");
  /** When this browser last wrote, so realtime can defer to a create in flight. */
  const lastLocalEdit = useRef(0);

  /**
   * `silent` keeps the panel on screen while it refreshes.
   *
   * Every refetch used to flip the whole panel back to a spinner, and three
   * unfiltered realtime handlers called it — so ticking a box made the list you
   * were reading disappear and come back.
   */
  const load = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!silent) setLoading(true);
      try {
        const [clRes, tplRes] = await Promise.all([
          supabase
            .from("project_checklists" as any)
            .select(
              "id, project_id, name, created_at, created_by, assigned_to, completed_at, snapshot, template_id",
            )
            .eq("project_id", projectId)
            .order("created_at", { ascending: true }),
          supabase
            .from("checklist_templates" as any)
            .select("id, name, description")
            .eq("archived", false)
            .order("name", { ascending: true }),
        ]);
        if (clRes.error) throw clRes.error;

        const clList = ((clRes.data as any[]) ?? []) as Checklist[];
        setChecklists(clList);
        setTemplates(((tplRes.data as any[]) ?? []) as Template[]);

        if (!clList.length) {
          setItems([]);
          setLoadError(false);
          return;
        }

        /*
         * Items, for the progress bars only.
         *
         * The panel no longer renders a single answer, so it selects the columns
         * it counts and nothing more — it used to pull `response_value` and
         * every note for every item on every checklist in the project purely to
         * draw a "3/8 done" caption.
         */
        const itRes = await supabase
          .from("project_checklist_items" as any)
          .select("id, checklist_id, position, required, completed_at")
          .in(
            "checklist_id",
            clList.map((c) => c.id),
          )
          .order("position", { ascending: true });
        if (itRes.error) throw itRes.error;
        setItems(((itRes.data as any[]) ?? []) as ChecklistItemCount[]);
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

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // Our own writes echo back here; defer to a create still in flight.
        if (Date.now() - lastLocalEdit.current < 2000) {
          refresh();
          return;
        }
        void load({ silent: true });
      }, 400);
    };
    const ch = supabase
      .channel(`project-checklists:${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_checklist_items" },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "project_checklists",
          filter: `project_id=eq.${projectId}`,
        },
        refresh,
      )
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(ch);
    };
  }, [projectId, load]);

  const itemsByChecklist = useMemo(() => {
    const map = new Map<string, ChecklistItemCount[]>();
    for (const it of items) {
      const arr = map.get(it.checklist_id) ?? [];
      arr.push(it);
      map.set(it.checklist_id, arr);
    }
    return map;
  }, [items]);

  const openRecord = (checklistId: string, isNew = false) =>
    void navigate({
      to: "/projects/$projectId/checklists/$checklistId",
      params: { projectId, checklistId },
      search: isNew ? { new: 1 } : {},
    });

  /**
   * Materialise a template onto this project and open it.
   *
   * Takes the id as an argument rather than reading it from state: the old
   * Templates tab called `setApplyingTemplate(id)` and then invoked this
   * immediately, which read the *previous* render's value — so the first tap did
   * nothing and the second applied whichever template you pressed before.
   */
  const applyTemplate = async (templateId: string) => {
    if (!templateId || !user) return;
    lastLocalEdit.current = Date.now();
    setCreating(true);
    let createdId: string | null = null;
    try {
      const tpl = templates.find((t) => t.id === templateId);
      if (!tpl) throw new Error("That template is no longer available");

      const { data: tplItems, error: tplErr } = await supabase
        .from("checklist_template_items" as any)
        .select("position, label, required, item_type, description")
        .eq("template_id", templateId)
        .order("position", { ascending: true });
      if (tplErr) throw tplErr;

      const { data: created, error } = await supabase
        .from("project_checklists" as any)
        .insert({
          project_id: projectId,
          template_id: templateId,
          name: tpl.name,
          created_by: user.id,
        })
        .select("id")
        .single();
      if (error || !created) throw error ?? new Error("Couldn't create that checklist");
      createdId = (created as any).id as string;

      // Renumber from zero rather than trusting the template's stored positions,
      // so a template with gaps or duplicates still lands in order.
      const rows = ((tplItems as any[]) ?? []).map((it: any, idx: number) => ({
        checklist_id: createdId,
        position: idx,
        label: it.label,
        required: it.required ?? false,
        item_type: it.item_type ?? "checkbox",
        description: it.description ?? null,
      }));
      if (rows.length) {
        const { error: itErr } = await supabase.from("project_checklist_items" as any).insert(rows);
        if (itErr) throw itErr;
      }
      onChanged?.();
      openRecord(createdId);
    } catch (e: any) {
      // Cascades to items, so a partial apply never survives.
      if (createdId) {
        await supabase
          .from("project_checklists" as any)
          .delete()
          .eq("id", createdId);
      }
      toast.error(friendlyError(e, "Couldn't add that checklist"));
    } finally {
      setCreating(false);
    }
  };

  /**
   * A blank checklist, in one click.
   *
   * No name prompt: the record is created with a placeholder and the page opens
   * with the title box selected, so naming it is the first thing you type rather
   * than a modal you clear before you can start. Nothing is lost if the user
   * never renames it — the placeholder is a real name, not an empty row.
   */
  const createBlank = async () => {
    if (!user) return;
    lastLocalEdit.current = Date.now();
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("project_checklists" as any)
        .insert({ project_id: projectId, name: UNTITLED, created_by: user.id })
        .select("id")
        .single();
      if (error || !data) throw error ?? new Error("Couldn't create that checklist");
      onChanged?.();
      openRecord((data as any).id as string, true);
    } catch (e: any) {
      toast.error(friendlyError(e, "Couldn't create that checklist"));
    } finally {
      setCreating(false);
    }
  };

  const activeCount = checklists.filter((c) => !c.completed_at).length;

  const newMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button className={cn(SURFACE_BUTTON, "bg-primary")} disabled={creating}>
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          New checklist
          <ChevronDown className="h-3.5 w-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuItem onClick={() => void createBlank()}>
          <ListPlus className="mr-2 h-4 w-4" />
          <span className="flex-1">
            Blank checklist
            <span className="block text-[11px] text-muted-foreground">
              Name it and type the items
            </span>
          </span>
        </DropdownMenuItem>
        {templates.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              From a template
            </DropdownMenuLabel>
            {/* Scrolls rather than paginates: a company with 30 templates should
                still reach any of them without leaving this menu. */}
            <div className="max-h-64 overflow-y-auto">
              {templates.map((t) => (
                <DropdownMenuItem key={t.id} onClick={() => void applyTemplate(t.id)}>
                  <ClipboardList className="mr-2 h-4 w-4" />
                  <span className="flex-1 truncate">
                    {t.name}
                    {t.description && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {t.description}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
            </div>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings/checklists">
            <Settings2 className="mr-2 h-4 w-4" />
            Design a template
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div>
      <RunnerPanelHeader
        eyebrow="Project"
        title="Checklists"
        description={
          checklists.length === 0
            ? "Task lists that travel with this job — printable and shareable once filled in. For multi-phase processes with sign-off, use Workflows."
            : activeCount === 0
              ? `All ${checklists.length} checklist${checklists.length === 1 ? "" : "s"} on this job are complete.`
              : `${activeCount} still open on this job.`
        }
        actions={newMenu}
      />

      {/* Filter strip. Deliberately plain toggle buttons rather than
          role="tablist"/role="tab": half-implemented tab semantics are worse
          than none — a screen reader would promise arrow-key navigation and an
          associated tabpanel that don't exist here. */}
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {(
          [
            { key: "active", label: "Active" },
            { key: "completed", label: "Completed" },
          ] as const
        ).map((t) => {
          const count =
            t.key === "active"
              ? checklists.filter((c) => !c.completed_at).length
              : checklists.filter((c) => c.completed_at).length;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTab(t.key)}
              className={`font-manrope relative min-h-11 px-3 py-2 text-sm font-bold transition-colors ${
                active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs font-medium text-muted-foreground">({count})</span>
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <RunnerGrid>
          <RunnerCardSkeleton />
          <RunnerCardSkeleton />
          <RunnerCardSkeleton />
        </RunnerGrid>
      ) : loadError ? (
        <ErrorState
          className="mt-6"
          title="Couldn't load checklists"
          description="You may be offline. Nothing has been lost — try again once you have a connection."
          onRetry={() => void load()}
        />
      ) : tab === "completed" ? (
        <div className="mt-6">
          {checklists.filter((c) => c.completed_at).length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No completed checklists yet"
              description="Fill out a checklist and mark it complete to save it here."
              action={
                <Button variant="outline" onClick={() => setTab("active")}>
                  Go to active checklists
                </Button>
              }
            />
          ) : (
            <RunnerGrid>
              {checklists
                .filter((c) => c.completed_at)
                .map((c) => {
                  /*
                   * A completed checklist is counted from its snapshot, not from
                   * the live item rows: the snapshot IS the record, and it is
                   * what the sealed page and the shared link both show.
                   */
                  const snapItems = Array.isArray(c.snapshot?.items) ? c.snapshot.items : [];
                  const done = snapItems.filter((it: any) => it.completed_at).length;
                  return (
                    <RunnerCard
                      key={c.id}
                      icon={ClipboardList}
                      tone="complete"
                      title={c.name}
                      statusLabel="Complete"
                      meta={
                        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                          <span>{`${done}/${snapItems.length} answered`}</span>
                          <BlueprintItemBadge
                            source={c.template_id ? blueprintSources?.[c.template_id] : null}
                          />
                        </span>
                      }
                      done={done}
                      total={snapItems.length}
                      progressLabel={`${c.name} progress`}
                      onOpen={() => openRecord(c.id)}
                    />
                  );
                })}
            </RunnerGrid>
          )}
        </div>
      ) : (
        (() => {
          const visible = checklists.filter((c) => !c.completed_at);
          if (visible.length === 0) {
            return (
              // The action belongs here, not in prose telling the reader to go
              // hunt for a button somewhere else on the page.
              <EmptyState
                icon={ClipboardList}
                title={checklists.length ? "Nothing open right now" : "No checklists yet"}
                description={
                  checklists.length
                    ? "Every checklist on this job is complete."
                    : "QA walks, punch lists, safety checks — start from a template or paste a list you already have."
                }
                className="mt-6"
                action={newMenu}
              />
            );
          }
          return (
            <RunnerGrid>
              {visible.map((cl) => {
                const its = itemsByChecklist.get(cl.id) ?? [];
                const done = its.filter((x) => x.completed_at).length;
                const requiredOpen = its.filter((x) => x.required && !x.completed_at).length;
                const tone = toneForProgress(done, its.length, false);
                return (
                  <RunnerCard
                    key={cl.id}
                    icon={ClipboardList}
                    tone={tone}
                    title={cl.name}
                    meta={
                      <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span>
                          {its.length === 0 ? "No items yet" : `${done}/${its.length} done`}
                        </span>
                        <BlueprintItemBadge
                          source={cl.template_id ? blueprintSources?.[cl.template_id] : null}
                        />
                      </span>
                    }
                    detail={
                      requiredOpen > 0 ? (
                        <RunnerStatusPill tone="blocked" icon={AlertCircle}>
                          {requiredOpen} required open
                        </RunnerStatusPill>
                      ) : undefined
                    }
                    done={done}
                    total={its.length}
                    progressLabel={`${cl.name} progress`}
                    onOpen={() => openRecord(cl.id)}
                  />
                );
              })}
            </RunnerGrid>
          );
        })()
      )}
    </div>
  );
}
