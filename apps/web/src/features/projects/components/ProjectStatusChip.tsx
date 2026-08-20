import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/sitepix/client";
import { useAuth } from "@/hooks/use-auth";
import { qk } from "@/lib/query-keys";
import { STATUS_DOT } from "../constants";

/**
 * The three buckets a running job moves between. `archived` is deliberately not
 * here: it is not a step in this cycle, it takes the project off the active
 * list, and it already has its own row (with its own explanation) in the
 * project's overflow menu. A project that is archived still *reads* correctly
 * on this chip, and picking any of these three brings it back.
 */
const CHOICES = ["active", "on_hold", "completed"] as const;

/**
 * The project's status, changeable from the project.
 *
 * It used to be a plain `<span>`, so the only way to mark a job complete from
 * its own page was: overflow menu, "Edit details", a dialog of eleven fields,
 * change one select, "Save changes". Status is the field crews touch most and
 * it was four clicks and a form behind the thing it describes.
 *
 * Same shape as ProjectStageChip beside it, on purpose: the two fields sit
 * together in the header, they answer neighbouring questions (which bucket vs
 * where in the pipeline), so they should be operated the same way. The write is
 * optimistic and reverts on failure, which is what the projects list has always
 * done for the same field.
 *
 * Styled for the dark hero header (`bg-sidebar`), which is its only caller.
 */
export function ProjectStatusChip({
  projectId,
  status,
  onChanged,
}: {
  projectId: string;
  status: string;
  /** Optimistic local update, called again with the old value if the write fails. */
  onChanged: (status: string) => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);

  const current = STATUS_DOT[status] ?? STATUS_DOT.active;

  async function set(next: string) {
    if (next === status || saving) return;
    const previous = status;
    onChanged(next);
    setSaving(true);
    const { error } = await supabase.from("projects").update({ status: next }).eq("id", projectId);
    setSaving(false);
    if (error) {
      onChanged(previous);
      toast.error(error.message);
      return;
    }
    toast.success(`Status set to ${(STATUS_DOT[next] ?? STATUS_DOT.active).label}`);
    // The projects list filters and counts by status, the dashboard and the map
    // colour their pins by it, and none of them read this page's local state.
    if (user) {
      void qc.invalidateQueries({ queryKey: qk.projectsList(user.id) });
      void qc.invalidateQueries({ queryKey: qk.dashboard(user.id) });
      void qc.invalidateQueries({ queryKey: qk.mapProjects(user.id) });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={`Status: ${current.label}. Click to change it.`}
          aria-label={`Project status: ${current.label}. Change status`}
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold transition hover:bg-sidebar-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring disabled:opacity-70"
          style={{ color: current.text }}
          disabled={saving}
        >
          {saving ? (
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
          ) : (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: current.dot }}
            />
          )}
          {current.label}
          <ChevronDown className="h-3 w-3 shrink-0 opacity-70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Set status
        </DropdownMenuLabel>
        {CHOICES.map((key) => {
          const s = STATUS_DOT[key];
          return (
            <DropdownMenuItem key={key} disabled={key === status} onClick={() => void set(key)}>
              <span
                className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: s.dot }}
              />
              <span className="flex-1 truncate">{s.label}</span>
              {key === status && <Check className="ml-2 h-3.5 w-3.5 shrink-0 opacity-70" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
