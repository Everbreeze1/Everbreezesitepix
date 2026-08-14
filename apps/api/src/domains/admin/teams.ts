import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { getStripe, priceIdToPlan } from "../../lib/stripe";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

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
    .select("id, name, plan, subscription_status, stripe_customer_id, is_internal, created_at")
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);
  if (data.cursor) query = query.lt("created_at", data.cursor);
  if (data.search) query = query.ilike("name", `%${data.search}%`);

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows as any[]) ?? [];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;
  const teamIds = page.map((t) => t.id as string);

  const { data: memberRows } = teamIds.length
    ? await (admin as any).from("team_members").select("team_id, user_id").in("team_id", teamIds)
    : { data: [] };
  const members = (memberRows as any[]) ?? [];
  const memberCountByTeam = new Map<string, number>();
  const teamByMemberId = new Map<string, string>();
  for (const m of members) {
    memberCountByTeam.set(m.team_id, (memberCountByTeam.get(m.team_id) ?? 0) + 1);
    teamByMemberId.set(m.user_id, m.team_id);
  }
  const memberIds = members.map((m) => m.user_id as string);

  const { data: projectRows } = memberIds.length
    ? await (admin as any).from("projects").select("id, created_by").in("created_by", memberIds)
    : { data: [] };
  const projects = (projectRows as any[]) ?? [];
  const projectCountByTeam = new Map<string, number>();
  const teamByProjectId = new Map<string, string>();
  for (const p of projects) {
    const teamId = teamByMemberId.get(p.created_by);
    if (!teamId) continue;
    projectCountByTeam.set(teamId, (projectCountByTeam.get(teamId) ?? 0) + 1);
    teamByProjectId.set(p.id, teamId);
  }
  const projectIds = projects.map((p) => p.id as string);

  const { data: photoRows } = projectIds.length
    ? await (admin as any).from("photos").select("project_id, size_bytes").in("project_id", projectIds)
    : { data: [] };
  const photos = (photoRows as any[]) ?? [];
  const photoCountByTeam = new Map<string, number>();
  const storageBytesByTeam = new Map<string, number>();
  for (const ph of photos) {
    const teamId = teamByProjectId.get(ph.project_id);
    if (!teamId) continue;
    photoCountByTeam.set(teamId, (photoCountByTeam.get(teamId) ?? 0) + 1);
    storageBytesByTeam.set(teamId, (storageBytesByTeam.get(teamId) ?? 0) + (ph.size_bytes ?? 0));
  }

  return {
    teams: page.map((t) => ({
      id: t.id,
      name: t.name,
      plan: t.plan,
      subscriptionStatus: t.subscription_status,
      stripeCustomerId: t.stripe_customer_id,
      isInternal: t.is_internal,
      memberCount: memberCountByTeam.get(t.id) ?? 0,
      projectCount: projectCountByTeam.get(t.id) ?? 0,
      photoCount: photoCountByTeam.get(t.id) ?? 0,
      storageBytes: storageBytesByTeam.get(t.id) ?? 0,
      createdAt: t.created_at,
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
    .select("id, name, plan, subscription_status, stripe_customer_id, stripe_subscription_id, is_internal, created_at")
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

  const { data: projectRows } = memberIds.length
    ? await (admin as any)
        .from("projects")
        .select("id, name, status, created_by, updated_at")
        .in("created_by", memberIds)
        .order("updated_at", { ascending: false })
    : { data: [] };
  const projects = (projectRows as any[]) ?? [];
  const projectIds = projects.map((p) => p.id as string);

  const { data: photoRows } = projectIds.length
    ? await (admin as any).from("photos").select("project_id, size_bytes").in("project_id", projectIds)
    : { data: [] };
  const photos = (photoRows as any[]) ?? [];
  const photoCountByProject = new Map<string, number>();
  const storageBytesByProject = new Map<string, number>();
  for (const ph of photos) {
    photoCountByProject.set(ph.project_id, (photoCountByProject.get(ph.project_id) ?? 0) + 1);
    storageBytesByProject.set(
      ph.project_id,
      (storageBytesByProject.get(ph.project_id) ?? 0) + (ph.size_bytes ?? 0),
    );
  }

  return {
    id: team.id,
    name: team.name,
    plan: team.plan,
    subscriptionStatus: team.subscription_status,
    stripeCustomerId: team.stripe_customer_id,
    stripeSubscriptionId: team.stripe_subscription_id,
    isInternal: team.is_internal,
    createdAt: team.created_at,
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
      photoCount: photoCountByProject.get(p.id) ?? 0,
      storageBytes: storageBytesByProject.get(p.id) ?? 0,
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
  await requirePlatformAdmin(ctx.userId);
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
