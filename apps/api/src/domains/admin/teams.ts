import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { getStripe, priceIdToPlan } from "../../lib/stripe";
import { isMissingFunction, stripLikeWildcards } from "../../lib/postgrest";
import { selectIn } from "../../lib/chunked-in";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

export interface TeamRollup {
  memberCount: number;
  projectCount: number;
  photoCount: number;
  storageBytes: number;
}

const EMPTY_ROLLUP: TeamRollup = {
  memberCount: 0,
  projectCount: 0,
  photoCount: 0,
  storageBytes: 0,
};

/**
 * Member/project/photo/storage counts for a page of teams.
 *
 * Prefers `admin_team_rollups`, which does the whole thing as one set-based
 * query (see 20260822120000_admin_team_rollups.sql for why that matters: the
 * previous in-process version transferred the photo table on every page view
 * and misattributed projects for anyone in two teams).
 *
 * The fallback exists because SQL here is applied by hand in the Supabase SQL
 * editor, so this code ships before the function does. It is deliberately the
 * *corrected* algorithm rather than the old one - a project is counted for
 * every team whose member created it - and it chunks its `IN (...)` filters,
 * which the original did not, so it no longer fails outright above ~398 ids.
 * It is still the slow path, and it is meant to stop being reachable the moment
 * the migration runs.
 */
async function loadTeamRollups(
  admin: ReturnType<typeof getSupabaseAdmin>,
  teamIds: string[],
): Promise<Map<string, TeamRollup>> {
  const out = new Map<string, TeamRollup>();
  if (!teamIds.length) return out;

  const { data: rpcRows, error: rpcError } = await (admin as any).rpc("admin_team_rollups", {
    team_ids: teamIds,
  });

  if (!rpcError) {
    for (const r of ((rpcRows as any[]) ?? []) as any[]) {
      out.set(r.team_id, {
        memberCount: Number(r.member_count ?? 0),
        projectCount: Number(r.project_count ?? 0),
        photoCount: Number(r.photo_count ?? 0),
        storageBytes: Number(r.storage_bytes ?? 0),
      });
    }
    for (const id of teamIds) if (!out.has(id)) out.set(id, { ...EMPTY_ROLLUP });
    return out;
  }

  if (!isMissingFunction(rpcError)) throw new Error(rpcError.message);

  // ---- Fallback: pre-migration path. ----
  const { data: memberRows, error: memberError } = await (admin as any)
    .from("team_members")
    .select("team_id, user_id")
    .in("team_id", teamIds);
  if (memberError) throw new Error(memberError.message);
  const members = (memberRows as any[]) ?? [];

  // team -> its members, and member -> ALL of their teams. The second one is
  // the bug this replaces: a Map<user_id, team_id> silently kept one team.
  const membersByTeam = new Map<string, Set<string>>();
  const teamsByMember = new Map<string, string[]>();
  for (const m of members) {
    if (!membersByTeam.has(m.team_id)) membersByTeam.set(m.team_id, new Set());
    membersByTeam.get(m.team_id)!.add(m.user_id);
    teamsByMember.set(m.user_id, [...(teamsByMember.get(m.user_id) ?? []), m.team_id]);
  }

  const memberIds = [...teamsByMember.keys()];
  const projects = await selectIn<{ id: string; created_by: string }>(
    memberIds,
    (ids) =>
      (admin as any)
        .from("projects")
        .select("id, created_by")
        .in("created_by", ids)
        .is("deleted_at", null),
    "admin team rollup projects",
  );

  const teamsByProject = new Map<string, string[]>();
  for (const p of projects) teamsByProject.set(p.id, teamsByMember.get(p.created_by) ?? []);

  const photos = await selectIn<{ project_id: string; size_bytes: number | null }>(
    projects.map((p) => p.id),
    (ids) => (admin as any).from("photos").select("project_id, size_bytes").in("project_id", ids),
    "admin team rollup photos",
  );

  for (const id of teamIds) {
    out.set(id, { ...EMPTY_ROLLUP, memberCount: membersByTeam.get(id)?.size ?? 0 });
  }
  for (const p of projects) {
    for (const teamId of teamsByProject.get(p.id) ?? []) {
      const roll = out.get(teamId);
      if (roll) roll.projectCount += 1;
    }
  }
  for (const ph of photos) {
    for (const teamId of teamsByProject.get(ph.project_id) ?? []) {
      const roll = out.get(teamId);
      if (!roll) continue;
      roll.photoCount += 1;
      roll.storageBytes += ph.size_bytes ?? 0;
    }
  }
  return out;
}

/** Per-project photo counts, same RPC-with-fallback shape as `loadTeamRollups`. */
async function loadProjectRollups(
  admin: ReturnType<typeof getSupabaseAdmin>,
  projectIds: string[],
): Promise<Map<string, { photoCount: number; storageBytes: number }>> {
  const out = new Map<string, { photoCount: number; storageBytes: number }>();
  if (!projectIds.length) return out;

  const { data: rpcRows, error: rpcError } = await (admin as any).rpc("admin_project_rollups", {
    project_ids: projectIds,
  });

  if (!rpcError) {
    for (const r of ((rpcRows as any[]) ?? []) as any[]) {
      out.set(r.project_id, {
        photoCount: Number(r.photo_count ?? 0),
        storageBytes: Number(r.storage_bytes ?? 0),
      });
    }
  } else if (isMissingFunction(rpcError)) {
    const photos = await selectIn<{ project_id: string; size_bytes: number | null }>(
      projectIds,
      (ids) => (admin as any).from("photos").select("project_id, size_bytes").in("project_id", ids),
      "admin project rollup photos",
    );
    for (const ph of photos) {
      const cur = out.get(ph.project_id) ?? { photoCount: 0, storageBytes: 0 };
      cur.photoCount += 1;
      cur.storageBytes += ph.size_bytes ?? 0;
      out.set(ph.project_id, cur);
    }
  } else {
    throw new Error(rpcError.message);
  }

  for (const id of projectIds) if (!out.has(id)) out.set(id, { photoCount: 0, storageBytes: 0 });
  return out;
}

export interface PlatformTeam {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  isInternal: boolean;
  memberCount: number;
  projectCount: number;
  photoCount: number;
  storageBytes: number;
  createdAt: string;
  /*
   * The business profile, from the account setup wizard. Null until a company
   * answers, which is most of the point of surfacing it here: "which
   * industries are actually signing up, and how many of them never told us"
   * is not answerable from billing rows.
   *
   * Ids, not labels. The admin UI resolves them through the same
   * packages/shared list the wizard renders, so a relabelled industry reads
   * correctly here without a backfill.
   */
  industry: string | null;
  trades: string[];
  teamSize: string | null;
  projectVolume: string | null;
  goals: string[];
  heardFrom: string | null;
  serviceArea: string | null;
  profileCompletedAt: string | null;
}

export const listPlatformTeamsInputSchema = z.object({
  search: z.string().trim().max(200).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listPlatformTeamsService(
  ctx: AuthedContext,
  data: z.infer<typeof listPlatformTeamsInputSchema>,
): Promise<{ teams: PlatformTeam[]; nextCursor: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  let query = (admin as any)
    .from("teams")
    .select(
      "id, name, plan, subscription_status, stripe_customer_id, is_internal, created_at, " +
        "industry, trades, team_size, project_volume, goals, heard_from, service_area, profile_completed_at",
    )
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);
  if (data.cursor) query = query.lt("created_at", data.cursor);
  // `.ilike()` is a single filter, not a parsed expression, so the client
  // encodes it and a comma is harmless. The wildcards are not: a search for
  // "100%" would otherwise match every team starting "100".
  if (data.search) query = query.ilike("name", `%${stripLikeWildcards(data.search)}%`);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows as any[]) ?? [];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;
  const teamIds = page.map((t) => t.id as string);

  const rollups = await loadTeamRollups(admin, teamIds);

  return {
    teams: page.map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      subscriptionStatus: t.subscription_status,
      stripeCustomerId: t.stripe_customer_id,
      isInternal: t.is_internal,
      memberCount: (rollups.get(t.id) ?? EMPTY_ROLLUP).memberCount,
      projectCount: (rollups.get(t.id) ?? EMPTY_ROLLUP).projectCount,
      photoCount: (rollups.get(t.id) ?? EMPTY_ROLLUP).photoCount,
      storageBytes: (rollups.get(t.id) ?? EMPTY_ROLLUP).storageBytes,
      createdAt: t.created_at,
      industry: t.industry ?? null,
      trades: Array.isArray(t.trades) ? t.trades : [],
      teamSize: t.team_size ?? null,
      projectVolume: t.project_volume ?? null,
      goals: Array.isArray(t.goals) ? t.goals : [],
      heardFrom: t.heard_from ?? null,
      serviceArea: t.service_area ?? null,
      profileCompletedAt: t.profile_completed_at ?? null,
    })),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

export interface PlatformTeamDetail {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  isInternal: boolean;
  createdAt: string;
  /**
   * What this company said they do and what they came here to fix.
   *
   * The list view counts industries; this is where you read one company's
   * actual answers, `goals` above all. That column is the only place the
   * product records what a customer's problem is in their own words, and until
   * it was shown here it went in and never came back out.
   *
   * Ids rather than labels, resolved through packages/shared by the page - see
   * the same field on `PlatformTeam`.
   */
  businessProfile: {
    industry: string | null;
    trades: string[];
    teamSize: string | null;
    projectVolume: string | null;
    goals: string[];
    heardFrom: string | null;
    serviceArea: string | null;
    completedAt: string | null;
  };
  members: Array<{ id: string; fullName: string | null; email: string | null; role: string }>;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    photoCount: number;
    storageBytes: number;
    updatedAt: string;
  }>;
}

export const getPlatformTeamDetailInputSchema = z.object({ teamId: z.string().uuid() });

/**
 * Read-only "inspect team" view for support debugging - deliberately does NOT
 * mint a session or let the admin act as the team, only lets them see what's
 * in the team's workspace via the service-role key.
 */
export async function getPlatformTeamDetailService(
  ctx: AuthedContext,
  data: z.infer<typeof getPlatformTeamDetailInputSchema>,
): Promise<PlatformTeamDetail> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: team, error: teamError } = await (admin as any)
    .from("teams")
    .select(
      "id, name, plan, subscription_status, stripe_customer_id, stripe_subscription_id, is_internal, created_at, " +
        "industry, trades, team_size, project_volume, goals, heard_from, service_area, profile_completed_at",
    )
    .eq("id", data.teamId)
    .single();
  if (teamError || !team) throw new Error("Team not found");

  const { data: memberRows } = await (admin as any)
    .from("team_members")
    .select("user_id, role")
    .eq("team_id", data.teamId);
  const members = (memberRows as any[]) ?? [];
  const memberIds = members.map((m) => m.user_id as string);

  const { data: profileRows } = memberIds.length
    ? await (admin as any).from("profiles").select("id, full_name, email").in("id", memberIds)
    : { data: [] };
  const profileById = new Map(((profileRows as any[]) ?? []).map((p) => [p.id, p]));

  const projects = await selectIn<{
    id: string;
    name: string;
    status: string;
    created_by: string;
    updated_at: string;
  }>(
    memberIds,
    (ids) =>
      (admin as any)
        .from("projects")
        .select("id, name, status, created_by, updated_at")
        .in("created_by", ids)
        .order("updated_at", { ascending: false }),
    "admin team detail projects",
  );
  const projectIds = projects.map((p) => p.id);

  const projectRollups = await loadProjectRollups(admin, projectIds);

  return {
    id: team.id,
    name: team.name,
    plan: team.plan,
    subscriptionStatus: team.subscription_status,
    stripeCustomerId: team.stripe_customer_id,
    stripeSubscriptionId: team.stripe_subscription_id,
    isInternal: team.is_internal,
    createdAt: team.created_at,
    businessProfile: {
      industry: team.industry ?? null,
      trades: Array.isArray(team.trades) ? team.trades : [],
      teamSize: team.team_size ?? null,
      projectVolume: team.project_volume ?? null,
      goals: Array.isArray(team.goals) ? team.goals : [],
      heardFrom: team.heard_from ?? null,
      serviceArea: team.service_area ?? null,
      completedAt: team.profile_completed_at ?? null,
    },
    members: members.map((m) => ({
      id: m.user_id,
      fullName: profileById.get(m.user_id)?.full_name ?? null,
      email: profileById.get(m.user_id)?.email ?? null,
      role: m.role,
    })),
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      photoCount: projectRollups.get(p.id)?.photoCount ?? 0,
      storageBytes: projectRollups.get(p.id)?.storageBytes ?? 0,
      updatedAt: p.updated_at,
    })),
  };
}

export const syncTeamBillingInputSchema = z.object({ teamId: z.string().uuid() });

/** Manually re-pulls subscription status from Stripe - for when a webhook was missed or delayed. */
export async function syncTeamBillingService(
  ctx: AuthedContext,
  data: z.infer<typeof syncTeamBillingInputSchema>,
): Promise<{ subscriptionStatus: string; plan: string }> {
  await requirePlatformAdmin(ctx.userId, "billing");
  const admin = getSupabaseAdmin();

  const { data: team, error: teamError } = await (admin as any)
    .from("teams")
    .select("id, plan, stripe_subscription_id")
    .eq("id", data.teamId)
    .single();
  if (teamError || !team) throw new Error("Team not found");
  if (!team.stripe_subscription_id) {
    throw new Error("This team has no Stripe subscription to sync.");
  }

  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(team.stripe_subscription_id);
  const priceId = subscription.items.data[0]?.price?.id;
  const plan = priceIdToPlan(priceId) ?? team.plan;

  const { error: updateError } = await (admin as any)
    .from("teams")
    .update({ subscription_status: subscription.status, plan })
    .eq("id", data.teamId);
  if (updateError) throw new Error(updateError.message);

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "sync_team_billing",
    targetType: "team",
    targetId: data.teamId,
    metadata: { subscriptionStatus: subscription.status, plan },
  });

  return { subscriptionStatus: subscription.status, plan };
}
