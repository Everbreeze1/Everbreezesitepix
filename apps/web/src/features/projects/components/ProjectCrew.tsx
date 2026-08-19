import { useMemo } from "react";
import { UserPlus, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTeamMembers } from "@/hooks/use-team-members";
import { useSubscription } from "@/hooks/use-subscription";
import { normaliseRole, roleLabelForTier } from "@sitepix/shared/team-permissions";

/**
 * The crew on a job: who was put on it, as opposed to who has happened to
 * touch it.
 *
 * Deliberately a different thing from `ProjectContributors`, which counts who
 * has already uploaded a photo, opened a task or written a document here. That
 * count is a record of what happened; this is a decision somebody made. A new
 * hire assigned to Monday's job is crew and not yet a contributor, and the
 * person who uploaded one photo in March is a contributor and not crew.
 *
 * Takes `userIds` rather than fetching them, because the projects grid resolves
 * every visible card in one request (`useProjectAssignees`) and one query per
 * card would be sixty requests to draw one screen.
 */
export function ProjectCrew({
  userIds,
  canAssign,
  onAssign,
  variant = "light",
  max = 4,
  className,
}: {
  userIds: string[];
  canAssign: boolean;
  onAssign: () => void;
  /** `dark` for the project hero, which sits on the sidebar surface. */
  variant?: "light" | "dark";
  max?: number;
  className?: string;
}) {
  const { members } = useTeamMembers();
  const { tier } = useSubscription();

  const crew = useMemo(() => {
    const byId = new Map(members.map((m) => [m.user_id, m]));
    return userIds
      .map((id) => byId.get(id))
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => (a.full_name ?? a.email ?? "").localeCompare(b.full_name ?? b.email ?? ""));
  }, [members, userIds]);

  const dark = variant === "dark";
  const shown = crew.slice(0, max);
  const extra = crew.length - shown.length;

  // Nothing assigned and nothing the viewer could do about it: render nothing
  // rather than an empty row that says "0 crew" on every card in the grid.
  if (crew.length === 0 && !canAssign) return null;

  return (
    <TooltipProvider delayDuration={150}>
      <div className={cn("flex items-center gap-2", className)}>
        {crew.length > 0 && (
          <div className="flex -space-x-1.5">
            {shown.map((m) => {
              const name = m.full_name || m.email || "Teammate";
              return (
                <Tooltip key={m.user_id}>
                  <TooltipTrigger asChild>
                    <Avatar
                      className={cn("h-6 w-6 border-2", dark ? "border-sidebar" : "border-card")}
                    >
                      {m.avatar_url ? <AvatarImage src={m.avatar_url} alt={name} /> : null}
                      <AvatarFallback className="bg-foreground text-[9px] font-extrabold text-background">
                        {initials(m.full_name, m.email)}
                      </AvatarFallback>
                    </Avatar>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    <div className="font-medium">{name}</div>
                    <div className="text-muted-foreground">
                      {roleLabelForTier(m.role, tier)}
                      {normaliseRole(m.role) === "restricted"
                        ? " - this job is one of the few they can see"
                        : " - assigned to this job"}
                    </div>
                  </TooltipContent>
                </Tooltip>
              );
            })}
            {extra > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full border-2 bg-muted text-[9px] font-extrabold text-muted-foreground",
                      dark ? "border-sidebar" : "border-card",
                    )}
                  >
                    +{extra}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[240px] text-xs">
                  {crew
                    .slice(max)
                    .map((m) => m.full_name || m.email || "Teammate")
                    .join(", ")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        )}

        {canAssign && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={(e) => {
                  // Cards wrap this in a link to the project. Without these the
                  // click navigates and the dialog opens behind the new page.
                  e.preventDefault();
                  e.stopPropagation();
                  onAssign();
                }}
                aria-label={crew.length === 0 ? "Assign teammates to this job" : "Change the crew"}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border border-dashed px-2 py-1 font-manrope text-[11px] font-bold transition",
                  dark
                    ? "border-sidebar-foreground/25 text-sidebar-foreground/70 hover:border-sidebar-ring hover:text-sidebar-foreground"
                    : "border-border text-muted-foreground hover:border-primary hover:text-primary",
                )}
              >
                {crew.length === 0 ? (
                  <>
                    <UserPlus className="h-3 w-3" /> Assign
                  </>
                ) : (
                  <Users className="h-3 w-3" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-[240px] text-xs">
              {crew.length === 0
                ? "Nobody is on this job yet. Pick the teammates working it."
                : "Change who is on this job."}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
