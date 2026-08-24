import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { getProjectContributors, type ProjectContributor } from "@/lib/teams.functions";
import { relativeTime } from "@everlumen/shared";

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function contributionLine(c: ProjectContributor) {
  const parts: string[] = [];
  if (c.photos) parts.push(`${c.photos} ${c.photos === 1 ? "photo" : "photos"}`);
  if (c.tasks) parts.push(`${c.tasks} ${c.tasks === 1 ? "task" : "tasks"}`);
  if (c.reports) parts.push(`${c.reports} ${c.reports === 1 ? "document" : "documents"}`);
  return parts.join(" · ");
}

/**
 * The "N contributors" chip, with the answer attached to it.
 *
 * There were two of these on the project header and both were a bare `<span>`:
 * a number, the word "contributor", and nothing behind it. Hovering did
 * nothing, clicking did nothing, and the word itself is ambiguous in a product
 * that also assigns people to jobs - reported, exactly, as "there are a few
 * places that say Contributor but when I hover over it there is no
 * information". So the chip now says who they are, what each of them did here,
 * and - the part the count could never carry - that a contributor is a record
 * of what has happened rather than a decision about who is staffed.
 *
 * Controlled rather than left to Radix's own hover handling: a HoverCard opens
 * on hover and on keyboard focus but never on touch, and this chip sits in the
 * header of a page that is mostly read on a phone in the field. Holding `open`
 * here lets the same panel answer a tap.
 */
export function ContributorsChip({
  contributors,
  variant = "light",
  className,
}: {
  contributors: ProjectContributor[];
  /** `dark` for the project hero, which sits on the sidebar surface. */
  variant?: "light" | "dark";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (contributors.length === 0) return null;
  const dark = variant === "dark";
  const shown = contributors.slice(0, 8);
  const extra = contributors.length - shown.length;

  return (
    <HoverCard open={open} onOpenChange={setOpen} openDelay={120} closeDelay={120}>
      <HoverCardTrigger asChild>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={`${contributors.length} contributors - see who has worked on this project`}
          className={cn(
            "inline-flex items-center gap-2 rounded-full text-xs font-bold transition",
            dark
              ? "text-sidebar-foreground/70 hover:text-sidebar-foreground"
              : "text-muted-foreground hover:text-foreground",
            className,
          )}
        >
          <span className="flex -space-x-1.5">
            {contributors.slice(0, 3).map((c) => (
              <Avatar
                key={c.userId}
                className={cn("h-6 w-6 border-2", dark ? "border-sidebar" : "border-card")}
              >
                {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt="" /> : null}
                <AvatarFallback className="bg-foreground text-[9px] font-extrabold text-background">
                  {initials(c.fullName, c.email)}
                </AvatarFallback>
              </Avatar>
            ))}
          </span>
          <span className="underline decoration-dotted underline-offset-4">
            {contributors.length} {contributors.length === 1 ? "contributor" : "contributors"}
          </span>
        </button>
      </HoverCardTrigger>
      <HoverCardContent align="start" className="w-[300px] p-3">
        <p className="text-sm font-semibold text-foreground">Contributors</p>
        {/*
          The distinction is the whole reason this panel exists. Somebody
          reading "3 contributors" on a job they just staffed with five people
          needs to be told these are two different lists, not a bug.
        */}
        <p className="mt-1 text-xs leading-snug text-muted-foreground">
          People who have added photos, tasks or documents here. It is a record of what has
          happened, not who is staffed - the crew is set with Assign.
        </p>
        <ul className="mt-3 space-y-2">
          {shown.map((c) => (
            <li key={c.userId} className="flex items-center gap-2">
              <Avatar className="h-6 w-6 shrink-0">
                {c.avatarUrl ? <AvatarImage src={c.avatarUrl} alt="" /> : null}
                <AvatarFallback className="text-[9px] font-bold">
                  {initials(c.fullName, c.email)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-foreground">
                  {c.fullName ?? c.email ?? "Member"}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {contributionLine(c) || "No entries yet"}
                  {c.lastAt ? ` · ${relativeTime(c.lastAt)}` : ""}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {extra > 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            and {extra} {extra === 1 ? "other" : "others"}
          </p>
        )}
      </HoverCardContent>
    </HoverCard>
  );
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
    queryFn: () => fetchContributors({ data: { projectId } }),
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
