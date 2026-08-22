import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
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

  const [
    totalUsers,
    totalTeams,
    starterCount,
    proCount,
    teamCount,
    activeSubs,
    totalProjects,
    unattributedProjects,
    totalPhotos,
    signupRows,
    recentTeamsRows,
  ] = await Promise.all([
    countRows("profiles"),
    countRows("teams"),
    countRows("teams", (q) => q.eq("plan", "starter")),
    countRows("teams", (q) => q.eq("plan", "pro")),
    countRows("teams", (q) => q.eq("plan", "team")),
    countRows("teams", (q) => q.eq("subscription_status", "active")),
    countRows("projects", (q) => q.is("deleted_at", null)),
    countRowsOrNull("projects", (q) => q.is("deleted_at", null).is("team_id", null)),
    countRows("photos"),
    (admin as any)
      .from("profiles")
      .select("created_at")
      .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()),
    (admin as any)
      .from("teams")
      .select("id, name, plan, subscription_status, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const totalActiveSubs = activeSubs;
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

export async function checkIsPlatformAdminService(
  ctx: AuthedContext,
): Promise<{ isAdmin: boolean }> {
  try {
    await requirePlatformAdmin(ctx.userId);
    return { isAdmin: true };
  } catch {
    return { isAdmin: false };
  }
}
