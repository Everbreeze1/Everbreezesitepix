import { api } from "@/lib/api";

/**
 * Team activity: what everyone else has been doing.
 *
 * Straight through `/v1/rpc`. The op resolves the caller's team, reads across
 * every member's projects with the service role, and returns only what they are
 * allowed to see, which is not something a client RLS query could assemble.
 */

export type ActivityKind = "photo" | "task" | "report" | "project";

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorAvatar: string | null;
  projectId: string | null;
  projectName: string | null;
  title: string | null;
};

export type MemberContribution = {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  photos: number;
  tasks: number;
  reports: number;
  lastActivityAt: string | null;
};

export type TeamActivity = {
  members: MemberContribution[];
  recent: ActivityItem[];
};

export async function getTeamActivity(): Promise<TeamActivity> {
  const result = await api.rpc<Partial<TeamActivity>>("getTeamActivity");
  /*
   * The op returns empty arrays for someone with no team rather than failing,
   * so a solo account gets an empty feed instead of an error. Defaulting here
   * too means a shape change cannot crash the screen.
   */
  return {
    members: result?.members ?? [],
    recent: result?.recent ?? [],
  };
}

/** What an activity line says happened. */
export function activityVerb(kind: ActivityKind): string {
  switch (kind) {
    case "photo":
      return "added a photo";
    case "task":
      return "worked a task";
    case "report":
      return "produced a report";
    case "project":
      return "updated a project";
    default:
      // `kind` is a string column upstream, so an unknown value is possible and
      // is better rendered vaguely than as "undefined".
      return "made a change";
  }
}

/** Display name for whoever did it. */
export function actorLabel(item: Pick<ActivityItem, "actorName" | "actorEmail">): string {
  return item.actorName?.trim() || item.actorEmail || "A teammate";
}
