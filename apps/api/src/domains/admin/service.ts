import { getSupabaseAdmin } from "../../lib/supabase";
import {
  getPlatformAdminRole,
  requirePlatformAdmin,
  type AdminRole,
} from "../../lib/admin-context";
import type { AuthedContext } from "../../lib/user-context";

export interface AdminMetrics {
  totalUsers: number;
  totalTeams: number;
  teamsByPlan: { starter: number; pro: number; team: number };
  subscriptions: { active: number; inactive: number };
  totalProjects: number;
  /**
   * Live projects belonging to no team.
   *
   * The Teams page sums per-team project counts and the Overview counts every
   * project, so these are exactly the rows that make the two disagree. Shown
   * rather than reconciled away: a project with no team is a real state (its
   * creator is in no team), and a total that quietly excluded them would be
   * the more confusing of the two numbers.
   */
  unattributedProjects: number | null;
  totalPhotos: number;
  signupsLast30Days: Array<{ date: string; count: number }>;
  recentTeams: Array<{
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    createdAt: string;
  }>;
}

async function countRows(table: string, filters?: (q: any) => any): Promise<number> {
  const admin = getSupabaseAdmin();
  let q = (admin as any).from(table).select("id", { count: "exact", head: true });
  if (filters) q = filters(q);
  const { count } = await q;
  return count ?? 0;
}

/**
 * A count that can honestly answer "I do not know".
 *
 * `countRows` discards the error and returns 0, which is fine over a column
 * that certainly exists and wrong over one that may not: reporting
 * "0 unattributed projects" before the team_id migration has run is a
 * confident claim about data we cannot see, and it is the reading an operator
 * would act on. Null renders as "unknown" instead.
 */
async function countRowsOrNull(table: string, filters?: (q: any) => any): Promise<number | null> {
  const admin = getSupabaseAdmin();
  let q = (admin as any).from(table).select("id", { count: "exact", head: true });
  if (filters) q = filters(q);
  const { count, error } = await q;
  if (error) return null;
  return count ?? 0;
}

export async function getAdminMetricsService(ctx: AuthedContext): Promise<AdminMetrics> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  /*
   * One read of `teams`, not six.
   *
   * This used to fire a separate head-count per plan, another for active
   * subscriptions, another for the total, and then select the recent rows -
   * six round trips to a table that is smaller than the query list. Combined
   * with the rest this page made eleven, and measured at a median of 6.3
   * seconds to render the admin landing screen.
   *
   * `teams` is the smallest table here and every figure on this page derived
   * from it is a tally over the same rows, so it is read once and counted in
   * memory. The head counts below stay as counts: `profiles`, `projects` and
   * `photos` are the tables that actually grow, and pulling them to count them
   * is the mistake admin_team_rollups exists to undo.
   *
   * If `teams` ever reaches the tens of thousands this should become a SQL
   * function like the other rollups. It is three rows today.
   */
  const [totalUsers, totalProjects, unattributedProjects, totalPhotos, signupRows, teamRows] =
    await Promise.all([
      countRows("profiles"),
      countRows("projects", (q) => q.is("deleted_at", null)),
      countRowsOrNull("projects", (q) => q.is("deleted_at", null).is("team_id", null)),
      countRows("photos"),
      (admin as any)
        .from("profiles")
        .select("created_at")
        .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
      (admin as any).from("teams").select("id, name, plan, subscription_status, created_at"),
    ]);

  const teams = ((teamRows.data as any[]) ?? []) as Array<{
    id: string;
    name: string;
    plan: string;
    subscription_status: string;
    created_at: string;
  }>;
  const totalTeams = teams.length;
  const starterCount = teams.filter((t) => t.plan === "starter").length;
  const proCount = teams.filter((t) => t.plan === "pro").length;
  const teamCount = teams.filter((t) => t.plan === "team").length;
  const totalActiveSubs = teams.filter((t) => t.subscription_status === "active").length;
  const recentTeamsRows = {
    data: [...teams].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20),
  };
  const buckets = new Map<string, number>();
  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  ((signupRows.data as Array<{ created_at: string }>) ?? []).forEach((r) => {
    const day = r.created_at.slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + 1);
  });

  return {
    totalUsers,
    totalTeams,
    teamsByPlan: { starter: starterCount, pro: proCount, team: teamCount },
    subscriptions: { active: totalActiveSubs, inactive: totalTeams - totalActiveSubs },
    totalProjects,
    unattributedProjects,
    totalPhotos,
    signupsLast30Days: Array.from(buckets.entries()).map(([date, count]) => ({ date, count })),
    recentTeams: ((recentTeamsRows.data as any[]) ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      subscriptionStatus: t.subscription_status,
      createdAt: t.created_at,
    })),
  };
}

/**
 * Is the caller an admin, and with which role.
 *
 * The role is returned, not just the boolean, because the console needs it to
 * decide what to *offer*. Capabilities were enforced server-side from the day
 * they landed and shown nowhere, so a `support` admin saw every billing control
 * on the page and learned it was not for them by clicking it and reading a 403
 * in a toast. A button that cannot work should not look like one that can.
 *
 * This is a convenience, never the boundary: `requirePlatformAdmin` on each
 * service is what actually decides, and it re-reads the role from the database
 * on every call.
 */
export async function checkIsPlatformAdminService(
  ctx: AuthedContext,
): Promise<{ isAdmin: boolean; role: AdminRole | null }> {
  const role = await getPlatformAdminRole(ctx.userId);
  return { isAdmin: role !== null, role };
}
