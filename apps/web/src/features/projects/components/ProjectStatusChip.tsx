import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, CircleSlash, GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  isProjectStatus,
  type ProjectStatus,
} from "@everlumen/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/everlumen/client";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import { listProjectBoards, setProjectPipelineStage } from "@/lib/project-boards.functions";
import { STATUS_DOT } from "../constants";

/**
 * Black or white on a stage chip, whichever wins on WCAG contrast. Stage
 * colours are chosen per board, so a fixed foreground is unreadable on half of
 * them.
 */
function chipTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return "#ffffff";
  const n = parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const luminance =
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255);
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#111827" : "#ffffff";
}

/**
 * Where the project is, as ONE control.
 *
 * This header used to carry two chips side by side, and the client named the
 * problem straight away:
 *
 *   "Beside the statuses where Invoiced, Scheduled is, there is another status
 *    also that says complete, Active or onhold. we have to reconcile between
 *    these two statuses. The active onhold status is also on maps."
 *
 * They are one thing now. A project in a pipeline shows its stage, and the
 * stage owns the three-value bucket the map's pins and the project list's
 * filters are built on - move a job to "Paid" and it stops being an Active pin
 * in the same write, because that is what the stage says it counts as. A team
 * with no pipeline, or a project sitting outside one, sets the bucket
 * directly, which for them is the only status there has ever been.
 *
 * So there is never a second status to reconcile against: whichever vocabulary
 * a team uses, this chip is the one place it is set, and everything that reads
 * `projects.status` keeps reading exactly what it always did.
 *
 * Styled for the dark hero header (`bg-sidebar`), which is its only caller.
 */
export function ProjectStatusChip({
  projectId,
  status,
  stageId,
  onChanged,
}: {
  projectId: string;
  status: string;
  stageId: string | null | undefined;
  /** Optimistic local update, called again with the old values if a write fails. */
  onChanged: (next: { status: string; stageId: string | null }) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const boardsQuery = useQuery({
    queryKey: qk.projectBoards(user?.id ?? ""),
    queryFn: async () => (await listProjectBoards()).boards,
    enabled: !!user,
    staleTime: 60_000,
  });
  const boards = useMemo(
    () => (boardsQuery.data ?? []).filter((b) => b.stages.length > 0),
    [boardsQuery.data],
  );

  const current = useMemo(() => {
    if (!stageId) return null;
    for (const b of boards) {
      const s = b.stages.find((x) => x.id === stageId);
      if (s) return { stage: s, boardName: b.name };
    }
    return null;
  }, [boards, stageId]);

  const bucket = STATUS_DOT[status] ?? STATUS_DOT.active;
  // What the chip is showing: the stage where there is one, because it says the
  // same thing in the team's own words and in more detail.
  const label = current ? current.stage.name : bucket.label;

  /*
   * A project that has a stage, on a page whose pipelines have not arrived yet.
   *
   * Falling back to the bucket here would flash "Active" on a job the team
   * calls "Invoiced" for as long as the boards query takes, which is a smaller
   * version of the exact confusion this chip exists to remove. We do not know
   * what to say yet, so the chip says nothing yet. A stage that has genuinely
   * been deleted resolves to null once the query lands, and that one does fall
   * back to the bucket.
   *
   * The project list and the map keep their fallback: a placeholder on every
   * card in a grid is a worse trade than a brief flash on one badge.
   */
  const stagePending = !!stageId && !current && boardsQuery.isPending;

  /** The list, the map and the dashboard all read `projects.status`. */
  function invalidateStatusReaders() {
    if (!user) return;
    void qc.invalidateQueries({ queryKey: qk.projectsList(user.id) });
    void qc.invalidateQueries({ queryKey: qk.dashboard(user.id) });
    void qc.invalidateQueries({ queryKey: qk.mapProjects(user.id) });
  }

  async function setBucket(next: ProjectStatus) {
    if (next === status || saving) return;
    const previous = { status, stageId: stageId ?? null };
    onChanged({ status: next, stageId: previous.stageId });
    setSaving(true);
    const { error } = await supabase.from("projects").update({ status: next }).eq("id", projectId);
    setSaving(false);
    if (error) {
      onChanged(previous);
      toast.error(error.message);
      return;
    }
    toast.success(`Status set to ${PROJECT_STATUS_LABELS[next]}`);
    invalidateStatusReaders();
  }

  async function move(nextStageId: string | null) {
    if ((stageId ?? null) === nextStageId || saving) return;
    const previous = { status, stageId: stageId ?? null };
    const stage = nextStageId
      ? boards.flatMap((b) => b.stages).find((s) => s.id === nextStageId)
      : null;
    // Predicting the bucket rather than waiting for the round trip: the header,
    // the cover badge and every colour on this page come from it, and a stage
    // move that repaints in two steps looks like a bug.
    const optimisticStatus = stage && status !== "archived" ? stage.status : status;
    onChanged({ status: optimisticStatus, stageId: nextStageId });
    setSaving(true);
    try {
      const res = await setProjectPipelineStage({ data: { projectId, stageId: nextStageId } });
      const confirmed = isProjectStatus(res?.status) ? res.status : optimisticStatus;
      onChanged({ status: confirmed, stageId: nextStageId });
      if (stage) toast.success(`Moved to ${stage.name}`);
      invalidateStatusReaders();
      void qc.invalidateQueries({ queryKey: qk.projectBoards(user?.id ?? "") });
    } catch (e: any) {
      onChanged(previous);
      toast.error(e?.message ?? "Could not change the status");
    } finally {
      setSaving(false);
    }
  }

  if (stagePending) {
    return (
      <span
        aria-hidden
        className="inline-flex h-[26px] w-28 animate-pulse rounded-full bg-sidebar-foreground/10"
      />
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={
            current
              ? `${current.boardName}: ${current.stage.name}, which counts as ${bucket.label}. Click to change it.`
              : `Status: ${bucket.label}. Click to change it.`
          }
          aria-label={`Project status: ${label}. Change status`}
          className={
            current
              ? "inline-flex max-w-[240px] items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[1.4px] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-70"
              : "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition hover:bg-sidebar-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-70"
          }
          style={
            current
              ? { background: current.stage.color, color: chipTextColor(current.stage.color) }
              : { color: bucket.text }
          }
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : current ? (
            <GitBranch className="h-3 w-3 shrink-0" />
          ) : (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: bucket.dot }}
            />
          )}
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {/*
          The two vocabularies, stacked rather than side by side, and only one
          of them is ever live: a project standing in a stage takes its bucket
          from that stage, so offering the three here as well would be offering
          a way to make them disagree again.
        */}
        {current ? (
          // No board name over this line: the stage list below is grouped by
          // pipeline and already carries it, and naming it twice in one small
          // menu reads as two different things.
          <p className="px-2 py-1.5 text-xs leading-snug text-muted-foreground">
            At <span className="font-semibold text-foreground">{current.stage.name}</span>, which
            counts as <span className="font-semibold text-foreground">{bucket.label}</span> on the
            map and in filters.
          </p>
        ) : (
          <>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Set status
            </DropdownMenuLabel>
            {PROJECT_STATUSES.map((key) => {
              const s = STATUS_DOT[key];
              return (
                <DropdownMenuItem
                  key={key}
                  disabled={key === status}
                  onClick={() => void setBucket(key)}
                >
                  <span
                    className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: s.dot }}
                  />
                  <span className="flex-1 truncate">{s.label}</span>
                  {key === status && <Check className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />}
                </DropdownMenuItem>
              );
            })}
          </>
        )}

        {boards.map((b) => (
          <div key={b.id}>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {b.name}
            </DropdownMenuLabel>
            {[...b.stages]
              .sort((x, y) => x.position - y.position)
              .map((s) => (
                <DropdownMenuItem key={s.id} disabled={s.id === stageId} onClick={() => move(s.id)}>
                  <span
                    className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: s.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{s.name}</span>
                  {/* What moving there does to the bucket, before you move there. */}
                  <span className="ml-2 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {PROJECT_STATUS_LABELS[s.status]}
                  </span>
                </DropdownMenuItem>
              ))}
          </div>
        ))}

        {boards.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={!stageId} onClick={() => move(null)}>
              <CircleSlash className="mr-2 h-3.5 w-3.5" />
              Not in a pipeline
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
