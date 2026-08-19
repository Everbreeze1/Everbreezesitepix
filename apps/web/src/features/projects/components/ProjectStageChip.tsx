import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, CircleSlash, GitBranch } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import { listProjectBoards, setProjectPipelineStage } from "@/lib/project-boards.functions";

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
 * The project's pipeline stage, on the project.
 *
 * The stage is a field on the project, so the project's own page is where it
 * should be legible without opening a board. It is also where the difference
 * between the two is easiest to see: the status pill beside this one is the
 * wide bucket (Active, On hold, Completed), and this is where the job is inside
 * that bucket.
 *
 * Renders nothing until the team has a pipeline with stages, so a workspace
 * that never made one sees no dead control.
 */
export function ProjectStageChip({
  projectId,
  stageId,
  onChanged,
}: {
  projectId: string;
  stageId: string | null | undefined;
  /** Optimistic local update, called again with the old value if the write fails. */
  onChanged: (stageId: string | null) => void;
}) {
  const { user } = useAuth();

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

  if (boards.length === 0) return null;

  async function move(next: string | null) {
    const previous = stageId ?? null;
    if (previous === next) return;
    onChanged(next);
    try {
      await setProjectPipelineStage({ data: { projectId, stageId: next } });
    } catch (e: any) {
      toast.error(e?.message ?? "Could not change the stage");
      onChanged(previous);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={
            current
              ? `${current.boardName}: ${current.stage.name}. Click to move it.`
              : "Put this project into a pipeline"
          }
          className="inline-flex max-w-[240px] items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-extrabold uppercase tracking-[1.4px] transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          style={
            current
              ? {
                  background: current.stage.color,
                  color: chipTextColor(current.stage.color),
                }
              : undefined
          }
        >
          <GitBranch className="h-3 w-3 shrink-0" />
          <span className="truncate">{current ? current.stage.name : "No pipeline stage"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        {boards.map((b, i) => (
          <div key={b.id}>
            {i > 0 && <DropdownMenuSeparator />}
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
                  <span className="truncate">{s.name}</span>
                </DropdownMenuItem>
              ))}
          </div>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!stageId} onClick={() => move(null)}>
          <CircleSlash className="mr-2 h-3.5 w-3.5" />
          Not in a pipeline
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
