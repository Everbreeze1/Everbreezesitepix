import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getProjectContributors, type ProjectContributor } from "@/lib/teams.functions";
import { relativeTime } from "@sitepix/shared";

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

interface Props {
  projectId: string;
  /** When true, render compact stacked avatars (for header rows). */
  compact?: boolean;
}

export function ProjectContributors({ projectId, compact = false }: Props) {
  const fetchContributors = getProjectContributors;
  const { data, isLoading } = useQuery({
    queryKey: ["project-contributors", projectId],
    queryFn: async () =>
      (await fetchContributors({ data: { projectId } })) as { contributors: ProjectContributor[] },
    staleTime: 30_000,
  });

  if (isLoading || !data) {
    if (compact) return null;
    return null;
  }
  const contributors = data.contributors;
  if (contributors.length === 0) {
    if (compact) return null;
    return null;
  }

  if (compact) {
    const shown = contributors.slice(0, 4);
    const extra = contributors.length - shown.length;
    return (
      <TooltipProvider delayDuration={150}>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-2">
            {shown.map((c) => (
              <Tooltip key={c.userId}>
                <TooltipTrigger asChild>
                  <Avatar className="h-7 w-7 border-2 border-background ring-0">
                    <AvatarImage src={c.avatarUrl ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {initials(c.fullName, c.email)}
                    </AvatarFallback>
                  </Avatar>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="font-medium">{c.fullName ?? c.email ?? "Member"}</div>
                  <div className="text-muted-foreground">
                    {c.photos} photos · {c.tasks} tasks · {c.reports} reports
                  </div>
                  {c.lastAt && (
                    <div className="text-muted-foreground">
                      Last active {relativeTime(c.lastAt)}
                    </div>
                  )}
                </TooltipContent>
              </Tooltip>
            ))}
            {extra > 0 && (
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium text-muted-foreground">
                +{extra}
              </div>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {contributors.length} {contributors.length === 1 ? "contributor" : "contributors"}
          </span>
        </div>
      </TooltipProvider>
    );
  }

  return (
    <Card className="mt-6 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold">Contributors</h2>
          <Badge variant="secondary" className="ml-1">
            {contributors.length}
          </Badge>
        </div>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {contributors.map((c) => (
          <li
            key={c.userId}
            className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/50 p-2.5"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <Avatar className="h-8 w-8 shrink-0">
                <AvatarImage src={c.avatarUrl ?? undefined} />
                <AvatarFallback className="text-xs">{initials(c.fullName, c.email)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {c.fullName ?? c.email ?? "Member"}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {c.photos} photos · {c.tasks} tasks · {c.reports} reports
                </div>
              </div>
            </div>
            {c.lastAt && (
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {relativeTime(c.lastAt)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
