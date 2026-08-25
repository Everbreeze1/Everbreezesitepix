import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { isMissingFunction, stripLikeWildcards } from "../../lib/postgrest";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * The teams screen, brought up to the users screen.
 *
 * Teams was the last list still assembling itself in Node: a name search, a
 * cursor, per-row rollups fanned out after the fact, and tiles that counted
 * whatever page happened to be loaded. It could not answer who is past due, who
 * is on a paid plan with nothing backing it, or which teams use the most
 * storage - the last of those because sorting was fixed to newest-first.
 *
 * `admin_team_directory` answers the whole screen in one query.
 */

export const TEAM_STATUSES = [
  "active",
  "past_due",
  "canceled",
  "internal",
  "unpaid_plan",
  "no_profile",
  "dormant",
] as const;
export type TeamStatusFilter = (typeof TEAM_STATUSES)[number];

export const TEAM_SORTS = [
  "created",
  "name",
  "members",
  "projects",
  "storage",
  "activity",
] as const;

export interface DirectoryTeam {
  id: string;
  name: string;
  plan: string;
  subscriptionStatus: string;
  isInternal: boolean;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  owner: { name: string | null; email: string | null };
  memberCount: number;
  projectCount: number;
  photoCount: number;
  storageBytes: number;
  lastActivityAt: string | null;
  industry: string | null;
  teamSize: string | null;
  profileCompletedAt: string | null;
}

export const listTeamDirectoryInputSchema = z.object({
  search: z.string().trim().max(200).optional(),
  plan: z.enum(["starter", "pro", "team"]).optional(),
  status: z.enum(TEAM_STATUSES).optional(),
  sort: z.enum(TEAM_SORTS).default("created"),
  desc: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

function mapRow(r: any): DirectoryTeam {
  return {
    id: r.id,
    name: r.name,
    plan: r.plan,
    subscriptionStatus: r.subscription_status,
    isInternal: !!r.is_internal,
    stripeCustomerId: r.stripe_customer_id,
    stripeSubscriptionId: r.stripe_subscription_id,
    createdAt: r.created_at,
    owner: { name: r.owner_name ?? null, email: r.owner_email ?? null },
    memberCount: Number(r.member_count ?? 0),
    projectCount: Number(r.project_count ?? 0),
    photoCount: Number(r.photo_count ?? 0),
    storageBytes: Number(r.storage_bytes ?? 0),
    lastActivityAt: r.last_activity_at ?? null,
    industry: r.industry ?? null,
    teamSize: r.team_size ?? null,
    profileCompletedAt: r.profile_completed_at ?? null,
  };
}

export async function listTeamDirectoryService(
  ctx: AuthedContext,
  data: z.infer<typeof listTeamDirectoryInputSchema>,
): Promise<{
  teams: DirectoryTeam[];
  total: number;
  offset: number;
  limit: number;
  degraded: boolean;
}> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: rows, error } = await (admin as any).rpc("admin_team_directory", {
    p_search: data.search ?? null,
    p_plan: data.plan ?? null,
    p_status: data.status ?? null,
    p_sort: data.sort,
    p_desc: data.desc,
    p_limit: data.limit,
    p_offset: data.offset,
  });

  if (!error) {
    const list = (rows as any[]) ?? [];
    return {
      teams: list.map(mapRow),
      total: list.length ? Number(list[0].total_count ?? 0) : 0,
      offset: data.offset,
      limit: data.limit,
      degraded: false,
    };
  }
  if (!isMissingFunction(error)) throw new Error(error.message);

  /*
   * Pre-migration fallback: name search and paging only.
   *
   * Deliberately not a reimplementation of the filters and sorts, for the same
   * reason the user directory's fallback is not - filtering a fetched page
   * filters only what was fetched, and a confidently wrong count is worse than
   * an absent one. `degraded` tells the screen to say so.
   */
  let query = (admin as any)
    .from("teams")
    .select(
      "id, name, plan, subscription_status, is_internal, stripe_customer_id, " +
        "stripe_subscription_id, created_at, industry, team_size, profile_completed_at",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range(data.offset, data.offset + data.limit - 1);
  if (data.search) query = query.ilike("name", `%${stripLikeWildcards(data.search)}%`);

  const { data: teams, count, error: teamError } = await query;
  if (teamError) throw new Error(teamError.message);

  return {
    teams: ((teams as any[]) ?? []).map((t) => ({
      ...mapRow(t),
      owner: { name: null, email: null },
      memberCount: 0,
      projectCount: 0,
      photoCount: 0,
      storageBytes: 0,
      lastActivityAt: null,
    })),
    total: count ?? 0,
    offset: data.offset,
    limit: data.limit,
    degraded: true,
  };
}

/**
 * The industry mix, over every team.
 *
 * This is the panel the setup wizard's business profile was collected for, and
 * it has been tallying whatever page was loaded - captioned to admit it, which
 * is honest but not useful. A distribution over an arbitrary fifty rows is not
 * a distribution.
 */
export async function getTeamIndustryMixService(ctx: AuthedContext): Promise<{
  mix: Array<{ industry: string; count: number }>;
  totalTeams: number;
  answered: number;
  unavailable: boolean;
}> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: rows, error } = await (admin as any).rpc("admin_team_industry_mix");
  if (error) {
    if (isMissingFunction(error)) {
      return { mix: [], totalTeams: 0, answered: 0, unavailable: true };
    }
    throw new Error(error.message);
  }

  const list = ((rows as any[]) ?? []) as Array<{
    industry: string;
    n: number;
    total_teams: number;
  }>;
  const totalTeams = list.length ? Number(list[0].total_teams ?? 0) : 0;
  return {
    mix: list.map((r) => ({ industry: r.industry, count: Number(r.n) })),
    totalTeams,
    // How many told us what they do - the number the panel exists to move.
    answered: list.filter((r) => r.industry !== "__none").reduce((sum, r) => sum + Number(r.n), 0),
    unavailable: false,
  };
}

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  // Same formula-injection defence as the user export: quoting is transport,
  // the apostrophe is what stops a spreadsheet evaluating the cell.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportTeamsInputSchema = listTeamDirectoryInputSchema
  .omit({ limit: true, offset: true })
  .extend({ max: z.number().int().min(1).max(5000).default(5000) });

export async function exportTeamsService(
  ctx: AuthedContext,
  data: z.infer<typeof exportTeamsInputSchema>,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  await requirePlatformAdmin(ctx.userId);

  const first = await listTeamDirectoryService(ctx, { ...data, limit: 200, offset: 0 });
  const all: DirectoryTeam[] = [...first.teams];
  while (all.length < Math.min(first.total, data.max)) {
    const next = await listTeamDirectoryService(ctx, {
      ...data,
      limit: 200,
      offset: all.length,
    });
    if (!next.teams.length) break;
    all.push(...next.teams);
  }

  const header = [
    "id",
    "name",
    "plan",
    "subscription_status",
    "complimentary",
    "owner_name",
    "owner_email",
    "members",
    "projects",
    "photos",
    "storage_bytes",
    "last_activity",
    "industry",
    "team_size",
    "profile_completed",
    "created",
    "stripe_customer_id",
    "stripe_subscription_id",
  ];
  const lines = [header.join(",")];
  for (const t of all.slice(0, data.max)) {
    lines.push(
      [
        t.id,
        t.name,
        t.plan,
        t.subscriptionStatus,
        t.isInternal,
        t.owner.name,
        t.owner.email,
        t.memberCount,
        t.projectCount,
        t.photoCount,
        t.storageBytes,
        t.lastActivityAt,
        t.industry,
        t.teamSize,
        t.profileCompletedAt,
        t.createdAt,
        t.stripeCustomerId,
        t.stripeSubscriptionId,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  await logAdminAction(getSupabaseAdmin(), {
    actorId: ctx.userId,
    action: "export_teams",
    targetType: "team_directory",
    targetId: null,
    metadata: { rows: all.length, filters: { ...data } },
  });

  return {
    csv: lines.join("\n"),
    rows: Math.min(all.length, data.max),
    truncated: first.total > data.max,
  };
}
