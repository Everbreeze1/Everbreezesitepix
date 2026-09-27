import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { listCrewCandidates } from "@/api/project-assignees";
import { crewName, type AssigneeMap } from "@/api/project-assignees-view";
import { AvatarStack, type AvatarSize } from "@/ui";

/**
 * Who is on each job, for a page of jobs at once.
 *
 * `getProjectAssignees` takes an array for exactly this: the list asks once for
 * every card rather than once per card. Names come from the team roster, the
 * same cached query the crew sheet reads, so a person is the same initials and
 * tint in the list as on the job.
 *
 * Silent on failure, like the crew row on the project screen: avatars are
 * context, and an error here must not stand between somebody and their jobs.
 */
export function useProjectCrews(projectIds: string[]) {
  const key = projectIds.join(",");
  const crewQuery = useQuery({
    queryKey: ["project-crews", key],
    queryFn: async () => {
      const result = await api.rpc<{ byProject?: AssigneeMap }>("getProjectAssignees", {
        projectIds,
      });
      return result?.byProject ?? {};
    },
    enabled: projectIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  const peopleQuery = useQuery({
    queryKey: ["crew-candidates"],
    queryFn: listCrewCandidates,
    enabled: projectIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });

  return useMemo(() => {
    const byProject = crewQuery.data ?? {};
    const people = peopleQuery.data ?? [];
    const out: Record<string, { name: string | null; uri: string | null }[]> = {};
    for (const [projectId, userIds] of Object.entries(byProject)) {
      out[projectId] = userIds.map((userId) => {
        const person = people.find((p) => p.userId === userId);
        return { name: person ? crewName(person) : null, uri: person?.avatarUrl ?? null };
      });
    }
    return out;
  }, [crewQuery.data, peopleQuery.data]);
}

/** One job's crew as overlapping initials. Draws nothing for an unstaffed job. */
export function ProjectCrewAvatars({
  people,
  size = "sm",
}: {
  people: { name: string | null; uri: string | null }[] | undefined;
  size?: AvatarSize;
}) {
  if (!people || people.length === 0) return null;
  return <AvatarStack people={people} max={3} size={size} />;
}
