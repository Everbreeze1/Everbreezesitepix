import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin, type AdminRole } from "../../lib/admin-context";
import { escapeLikeValue, isMissingFunction, isMissingTable } from "../../lib/postgrest";
import { sendSignupConfirmationEmail } from "../email/signup-confirmation";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * The users screen, rebuilt.
 *
 * It could previously do two things: match a substring, and toggle platform
 * admin. Everything an operator actually asks - who is suspended, who never
 * confirmed, who belongs to no team, who has gone quiet, how many users are
 * there at all - was unanswerable, and the answers it did give were assembled
 * in Node by fetching a page and fanning out per row. That cannot sort or
 * filter on anything it has not already fetched, and it does not survive
 * growth.
 *
 * `admin_user_directory` does the whole screen in one query. This file is a
 * thin mapping over it, plus the actions the screen needs.
 */

export const USER_STATUSES = [
  "active",
  "unconfirmed",
  "suspended",
  "no_team",
  "dormant",
  "admin",
] as const;
export type UserStatusFilter = (typeof USER_STATUSES)[number];

export const USER_SORTS = [
  "joined",
  "last_seen",
  "name",
  "storage",
  "projects",
  "activity",
] as const;

export interface DirectoryUser {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  createdAt: string;
  team: { id: string; name: string; plan: string; role: string } | null;
  /** Memberships in total. >1 means the team above is only their primary one. */
  teamCount: number;
  isPlatformAdmin: boolean;
  adminRole: AdminRole | null;
  emailConfirmed: boolean;
  suspended: boolean;
  lastSignInAt: string | null;
  lastSeenAt: string | null;
  requests30d: number;
  projectCount: number;
  storageBytes: number;
  feedbackCount: number;
}

export const listUserDirectoryInputSchema = z.object({
  search: z.string().trim().max(200).optional(),
  plan: z.enum(["starter", "pro", "team"]).optional(),
  status: z.enum(USER_STATUSES).optional(),
  sort: z.enum(USER_SORTS).default("joined"),
  desc: z.boolean().default(true),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

function mapRow(r: any): DirectoryUser {
  return {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    company: r.company,
    createdAt: r.created_at,
    team: r.team_id
      ? { id: r.team_id, name: r.team_name, plan: r.team_plan, role: r.team_role }
      : null,
    teamCount: Number(r.team_count ?? 0),
    isPlatformAdmin: !!r.is_platform_admin,
    adminRole: (r.admin_role as AdminRole | null) ?? (r.is_platform_admin ? "superadmin" : null),
    emailConfirmed: !!r.email_confirmed,
    suspended: !!r.banned_until && new Date(r.banned_until).getTime() > Date.now(),
    lastSignInAt: r.last_sign_in_at ?? null,
    lastSeenAt: r.last_seen_at ?? null,
    requests30d: Number(r.requests_30d ?? 0),
    projectCount: Number(r.project_count ?? 0),
    storageBytes: Number(r.storage_bytes ?? 0),
    feedbackCount: Number(r.feedback_count ?? 0),
  };
}

export async function listUserDirectoryService(
  ctx: AuthedContext,
  data: z.infer<typeof listUserDirectoryInputSchema>,
): Promise<{
  users: DirectoryUser[];
  total: number;
  offset: number;
  limit: number;
  degraded: boolean;
}> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: rows, error } = await (admin as any).rpc("admin_user_directory", {
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
      users: list.map(mapRow),
      // total_count rides on every row; an empty page legitimately means zero.
      total: list.length ? Number(list[0].total_count ?? 0) : 0,
      offset: data.offset,
      limit: data.limit,
      degraded: false,
    };
  }
  if (!isMissingFunction(error)) throw new Error(error.message);

  /*
   * Pre-migration fallback: search and paginate only.
   *
   * Deliberately NOT a reimplementation of the filters and sorts. Doing them in
   * Node over a page of rows would filter only what happened to be fetched,
   * which produces confidently wrong counts - worse than saying so. `degraded`
   * is surfaced to the UI, which tells the operator the migration is pending
   * rather than silently showing them a filter that does not filter.
   */
  let query = (admin as any)
    .from("profiles")
    .select("id, full_name, email, company, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(data.offset, data.offset + data.limit - 1);
  if (data.search) {
    const like = escapeLikeValue(data.search);
    query = query.or(`full_name.ilike.${like},email.ilike.${like},company.ilike.${like}`);
  }
  const { data: profiles, count, error: profileError } = await query;
  if (profileError) throw new Error(profileError.message);

  const page = (profiles as any[]) ?? [];
  const userIds = page.map((p) => p.id);
  const [{ data: memberships }, { data: adminRows }] = await Promise.all([
    userIds.length
      ? (admin as any)
          .from("team_members")
          .select("user_id, role, team:teams(id, name, plan)")
          .in("user_id", userIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? (admin as any).from("platform_admins").select("user_id").in("user_id", userIds)
      : Promise.resolve({ data: [] }),
  ]);
  const teamByUser = new Map<string, any>();
  for (const m of ((memberships as any[]) ?? []).filter((m) => m.team)) {
    if (!teamByUser.has(m.user_id)) {
      teamByUser.set(m.user_id, {
        id: m.team.id,
        name: m.team.name,
        plan: m.team.plan,
        role: m.role,
      });
    }
  }
  const adminSet = new Set(((adminRows as any[]) ?? []).map((r) => r.user_id));

  return {
    users: page.map((p) => ({
      id: p.id,
      fullName: p.full_name,
      email: p.email,
      company: p.company,
      createdAt: p.created_at,
      team: teamByUser.get(p.id) ?? null,
      teamCount: teamByUser.has(p.id) ? 1 : 0,
      isPlatformAdmin: adminSet.has(p.id),
      adminRole: adminSet.has(p.id) ? ("superadmin" as AdminRole) : null,
      emailConfirmed: true,
      suspended: false,
      lastSignInAt: null,
      lastSeenAt: null,
      requests30d: 0,
      projectCount: 0,
      storageBytes: 0,
      feedbackCount: 0,
    })),
    total: count ?? 0,
    offset: data.offset,
    limit: data.limit,
    degraded: true,
  };
}

// ---------------------------------------------------------------------------
// Admin role
// ---------------------------------------------------------------------------

export const setAdminRoleInputSchema = z.object({
  userId: z.string().uuid(),
  /** null revokes platform admin entirely. */
  role: z.enum(["support", "billing", "superadmin"]).nullable(),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Grant, narrow, or revoke platform admin.
 *
 * Replaces the binary toggle. The roles have existed in `platform_admins` and
 * been enforced by `requirePlatformAdmin` since they were added, but nothing in
 * the product could set them - so every admin was a superadmin by default and
 * the capability system was decorative. This is the missing half.
 */
export async function setAdminRoleService(
  ctx: AuthedContext,
  data: z.infer<typeof setAdminRoleInputSchema>,
): Promise<{ ok: true; role: AdminRole | null }> {
  await requirePlatformAdmin(ctx.userId, "owner");
  const admin = getSupabaseAdmin();

  /*
   * Never leave the platform with no superadmin.
   *
   * Broader than the old last-admin guard, and it has to be: narrowing the only
   * superadmin to `support` locks out grant, revoke and delete for everyone
   * without removing a single row, so a check that only counted admins would
   * wave it through. Counted with the target excluded so a no-op stays a no-op.
   */
  if (data.role !== "superadmin") {
    const { count, error: countError } = await (admin as any)
      .from("platform_admins")
      .select("user_id", { count: "exact", head: true })
      .eq("role", "superadmin")
      .neq("user_id", data.userId);
    if (countError && !isMissingColumnish(countError)) throw new Error(countError.message);
    if (!countError && (count ?? 0) === 0) {
      throw new Error(
        "This is the last superadmin. Promote someone else to superadmin before changing this one.",
      );
    }
  }

  if (data.role === null) {
    const { error } = await (admin as any)
      .from("platform_admins")
      .delete()
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await (admin as any)
      .from("platform_admins")
      .upsert(
        { user_id: data.userId, granted_by: ctx.userId, role: data.role },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: data.role === null ? "revoke_platform_admin" : "set_admin_role",
    targetType: "user",
    targetId: data.userId,
    metadata: { role: data.role, reason: data.reason },
  });

  return { ok: true, role: data.role };
}

/** The role column arrives by hand-run migration; treat its absence as "no roles yet". */
function isMissingColumnish(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || /column .*role.* does not exist/i.test(error.message ?? "");
}

// ---------------------------------------------------------------------------
// Support notes
// ---------------------------------------------------------------------------

export interface UserNote {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string | null; name: string | null; email: string | null };
}

export const listUserNotesInputSchema = z.object({ userId: z.string().uuid() });

export async function listUserNotesService(
  ctx: AuthedContext,
  data: z.infer<typeof listUserNotesInputSchema>,
): Promise<{ notes: UserNote[]; unavailable: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: rows, error } = await (admin as any)
    .from("user_notes")
    .select("id, body, created_at, author_id")
    .eq("user_id", data.userId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    if (isMissingTable(error)) {
      return {
        notes: [],
        unavailable:
          "Run supabase/migrations/20260823100000_admin_user_directory.sql - the user_notes table is not in this database yet.",
      };
    }
    throw new Error(error.message);
  }

  const list = (rows as any[]) ?? [];
  const authorIds = Array.from(new Set(list.map((n) => n.author_id).filter(Boolean)));
  const { data: profiles } = authorIds.length
    ? await (admin as any).from("profiles").select("id, full_name, email").in("id", authorIds)
    : { data: [] };
  const byId = new Map(((profiles as any[]) ?? []).map((p) => [p.id, p]));

  return {
    notes: list.map((n) => ({
      id: n.id,
      body: n.body,
      createdAt: n.created_at,
      author: {
        id: n.author_id ?? null,
        name: byId.get(n.author_id)?.full_name ?? null,
        email: byId.get(n.author_id)?.email ?? null,
      },
    })),
    unavailable: null,
  };
}

export const addUserNoteInputSchema = z.object({
  userId: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

export async function addUserNoteService(
  ctx: AuthedContext,
  data: z.infer<typeof addUserNoteInputSchema>,
): Promise<{ ok: true }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();

  const { error } = await (admin as any)
    .from("user_notes")
    .insert({ user_id: data.userId, author_id: ctx.userId, body: data.body });
  if (error) throw new Error(error.message);

  // Not logged to admin_audit_log: a note is already attributed and timestamped,
  // and duplicating it into the audit trail would bury the actions that matter.
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Team membership
// ---------------------------------------------------------------------------

export const setUserTeamRoleInputSchema = z.object({
  userId: z.string().uuid(),
  teamId: z.string().uuid(),
  role: z.enum(["owner", "admin", "manager", "standard", "restricted", "member"]),
  reason: z.string().trim().min(3).max(500),
});

/**
 * Change a member's role inside their team, from the admin console.
 *
 * The product has this too, but only for someone who is already an owner of
 * that team and can sign in. The support case is the opposite one: the owner
 * has left, or locked themselves out, and somebody needs to be promoted before
 * anyone can do anything. That previously required the SQL editor.
 *
 * Deliberately does NOT move a user between teams. Membership carries their
 * projects, assignments and permissions by inference (see the attribution note
 * in admin_team_rollups), so a "move" is not one update - it is a migration,
 * and doing it as a dropdown would quietly detach a person from their work.
 */
export async function setUserTeamRoleService(
  ctx: AuthedContext,
  data: z.infer<typeof setUserTeamRoleInputSchema>,
): Promise<{ ok: true }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();

  const { data: membership, error: readError } = await (admin as any)
    .from("team_members")
    .select("id, role")
    .eq("user_id", data.userId)
    .eq("team_id", data.teamId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!membership) throw new Error("That user is not a member of that team.");

  const { error } = await (admin as any)
    .from("team_members")
    .update({ role: data.role })
    .eq("id", membership.id);
  if (error) throw new Error(error.message);

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "set_user_team_role",
    targetType: "user",
    targetId: data.userId,
    metadata: {
      teamId: data.teamId,
      from: (membership as any).role,
      to: data.role,
      reason: data.reason,
    },
  });

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);

  /*
   * Formula injection, defused with a leading apostrophe.
   *
   * A cell beginning `=`, `+`, `-`, `@`, or a tab/CR is executed as a formula
   * by Excel, Sheets and LibreOffice - so a customer who sets their display
   * name to `=HYPERLINK(...)` gets it run on the machine of whoever opens the
   * export. CSV quoting does NOT prevent this: quoting is how the value
   * survives transport, and the spreadsheet evaluates what it finds inside the
   * quotes. The apostrophe is the mitigation, and it has to come first.
   */
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const exportUsersInputSchema = listUserDirectoryInputSchema
  .omit({ limit: true, offset: true })
  .extend({
    /** Hard ceiling. An unbounded export is how an admin screen becomes an outage. */
    max: z.number().int().min(1).max(5000).default(5000),
  });

/**
 * The current view, as CSV.
 *
 * Exports what the filters currently select rather than everything, because
 * that is what the operator is looking at and what they mean by "export this".
 * The row count is returned so the UI can say when the cap truncated it - a
 * silently short export is worse than a refused one.
 */
export async function exportUsersService(
  ctx: AuthedContext,
  data: z.infer<typeof exportUsersInputSchema>,
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  await requirePlatformAdmin(ctx.userId);

  const page = await listUserDirectoryService(ctx, {
    ...data,
    limit: Math.min(data.max, 200),
    offset: 0,
  });

  const all: DirectoryUser[] = [...page.users];
  // Paged rather than one huge query: the function is fast but the payload is
  // not, and 5,000 rows in one response is a memory spike on a small dyno.
  while (all.length < Math.min(page.total, data.max)) {
    const next = await listUserDirectoryService(ctx, {
      ...data,
      limit: 200,
      offset: all.length,
    });
    if (!next.users.length) break;
    all.push(...next.users);
  }

  const header = [
    "id",
    "name",
    "email",
    "company",
    "joined",
    "team",
    "team_role",
    "plan",
    "admin_role",
    "email_confirmed",
    "suspended",
    "last_sign_in",
    "last_seen",
    "requests_30d",
    "projects",
    "storage_bytes",
    "feedback_reports",
  ];
  const lines = [header.join(",")];
  for (const u of all.slice(0, data.max)) {
    lines.push(
      [
        u.id,
        u.fullName,
        u.email,
        u.company,
        u.createdAt,
        u.team?.name,
        u.team?.role,
        u.team?.plan,
        u.adminRole,
        u.emailConfirmed,
        u.suspended,
        u.lastSignInAt,
        u.lastSeenAt,
        u.requests30d,
        u.projectCount,
        u.storageBytes,
        u.feedbackCount,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  await logAdminAction(getSupabaseAdmin(), {
    actorId: ctx.userId,
    action: "export_users",
    targetType: "user_directory",
    targetId: null,
    metadata: { rows: all.length, filters: { ...data } },
  });

  return {
    csv: lines.join("\n"),
    rows: Math.min(all.length, data.max),
    truncated: page.total > data.max,
  };
}

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

export const bulkUserActionInputSchema = z.object({
  userIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(["suspend", "reinstate", "resend_confirmation"]),
  reason: z.string().trim().min(3).max(500),
  /** Where the emailed links should land. Defaults to the production site. */
  origin: z.string().url().optional(),
});

/**
 * The same support actions, over a selection.
 *
 * Bounded at 100 and run sequentially: each one is a GoTrue round trip, and a
 * parallel burst of a hundred is how a support action becomes an auth outage.
 *
 * Partial success is reported rather than hidden. Suspending 40 accounts where
 * 3 fail is a real outcome an operator needs to see per account, and an
 * all-or-nothing error message would throw away the 37 that worked.
 *
 * Deliberately excludes delete. Bulk-deleting accounts is not a support
 * gesture, and the one irreversible action in the console stays one at a time,
 * behind its typed confirmation.
 */
export async function runBulkUserActionService(
  ctx: AuthedContext,
  data: z.infer<typeof bulkUserActionInputSchema>,
): Promise<{ succeeded: number; failed: Array<{ userId: string; reason: string }> }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();
  const origin = (data.origin ?? "https://everlumen.co").replace(/\/+$/, "");

  let succeeded = 0;
  const failed: Array<{ userId: string; reason: string }> = [];

  for (const userId of data.userIds) {
    try {
      if (data.action === "resend_confirmation") {
        const { data: authUser } = await admin.auth.admin.getUserById(userId);
        const email = (authUser?.user as any)?.email as string | undefined;
        if (!email) throw new Error("no email on file");
        if ((authUser?.user as any)?.email_confirmed_at) {
          // Already confirmed is a no-op, not a failure.
          succeeded += 1;
          continue;
        }
        /*
         * Ours to deliver, for the reason spelled out on the single-account
         * version of this in ./user-detail.ts: `auth.resend` delegates to the
         * Send Email hook, and a hook that does not answer drops the message
         * without an error anyone here would see. Selecting forty unconfirmed
         * accounts and being told "40 done" while nothing was sent is the
         * worst version of that bug, because it also closes the ticket.
         */
        const res = await sendSignupConfirmationEmail(email, origin);
        if (!res.sent) throw new Error(res.reason ?? "confirmation email could not be sent");
      } else {
        const { error } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: data.action === "suspend" ? "876000h" : "none",
        } as any);
        if (error) throw new Error(error.message);
      }
      succeeded += 1;
    } catch (e: any) {
      failed.push({ userId, reason: String(e?.message ?? e).slice(0, 200) });
    }
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: `bulk_user_${data.action}`,
    targetType: "user",
    targetId: null,
    metadata: {
      reason: data.reason,
      requested: data.userIds.length,
      succeeded,
      failed: failed.length,
      userIds: data.userIds,
    },
  });

  return { succeeded, failed };
}
