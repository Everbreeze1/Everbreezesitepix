import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { selectIn } from "../../lib/chunked-in";
import { sendSignupConfirmationEmail } from "../email/signup-confirmation";
import { logAdminAction, logAdminRead } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * One customer account, everything about it, in one place.
 *
 * The users list could show fifty rows and toggle admin on them, and that was
 * the whole of it - no way to open an account. Every support question ("what
 * plan are they on", "did their confirmation email ever arrive", "what were
 * they doing when it broke") meant the SQL editor and the Supabase auth
 * dashboard, in two browser tabs, correlated by hand.
 *
 * Read-only by default. The actions at the bottom of this file are the four an
 * operator actually needs, and each one is logged.
 */

export interface PlatformUserDetail {
  id: string;
  fullName: string | null;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  avatarUrl: string | null;
  createdAt: string;
  isPlatformAdmin: boolean;
  adminRole: "support" | "billing" | "superadmin" | null;
  /**
   * From `auth.users`, which is the half of an account the product's own tables
   * cannot see. Null when the profile row has outlived its auth user - rare,
   * but it reads as "deleted from auth, still in profiles" rather than as a
   * loading failure.
   */
  auth: {
    emailConfirmedAt: string | null;
    lastSignInAt: string | null;
    provider: string | null;
    bannedUntil: string | null;
    createdAt: string | null;
  } | null;
  teams: Array<{
    id: string;
    name: string;
    plan: string;
    subscriptionStatus: string;
    isInternal: boolean;
    role: string;
    isOwner: boolean;
    /*
     * How many people a plan change here would affect.
     *
     * A plan belongs to the TEAM, so changing it from a person's page changes
     * it for everyone in that team. Without the number on screen the control
     * reads as if it applied to the one account being looked at.
     */
    memberCount: number;
  }>;
  projects: Array<{
    id: string;
    name: string;
    status: string;
    photoCount: number;
    storageBytes: number;
    updatedAt: string;
    deletedAt: string | null;
  }>;
  totals: { projects: number; photos: number; storageBytes: number; feedbackReports: number };
  /** What this person has actually told us, not just how many times. */
  feedback: Array<{
    id: string;
    kind: string;
    status: string;
    description: string | null;
    createdAt: string;
  }>;
  /** The tail of this user's API calls, newest first. See api_audit_logs. */
  recentActivity: Array<{
    id: string;
    route: string;
    op: string | null;
    httpStatus: number;
    durationMs: number | null;
    errorCode: string | null;
    createdAt: string;
  }>;
}

export const getPlatformUserDetailInputSchema = z.object({ userId: z.string().uuid() });

export async function getPlatformUserDetailService(
  ctx: AuthedContext,
  data: z.infer<typeof getPlatformUserDetailInputSchema>,
): Promise<PlatformUserDetail> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const { data: profile, error } = await (admin as any)
    .from("profiles")
    .select("id, full_name, email, company, job_title, avatar_url, created_at")
    .eq("id", data.userId)
    .single();
  if (error || !profile) throw new Error("User not found");

  // Auth metadata is a separate service, and it is allowed to fail without
  // taking the page down - a support view that shows nothing because GoTrue
  // hiccuped is worse than one showing everything except the last sign-in.
  let authInfo: PlatformUserDetail["auth"] = null;
  try {
    const { data: authUser } = await admin.auth.admin.getUserById(data.userId);
    const u = authUser?.user as any;
    if (u) {
      authInfo = {
        emailConfirmedAt: u.email_confirmed_at ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
        provider: u.app_metadata?.provider ?? null,
        bannedUntil: u.banned_until ?? null,
        createdAt: u.created_at ?? null,
      };
    }
  } catch {
    authInfo = null;
  }

  const [{ data: memberships }, { data: adminRow }, { count: feedbackCount }] = await Promise.all([
    (admin as any)
      .from("team_members")
      .select("role, team:teams(id, name, plan, subscription_status, is_internal, owner_id)")
      .eq("user_id", data.userId),
    (admin as any)
      .from("platform_admins")
      .select("user_id, role")
      .eq("user_id", data.userId)
      .maybeSingle(),
    (admin as any)
      .from("issue_reports")
      .select("id", { count: "exact", head: true })
      .eq("user_id", data.userId),
  ]);

  // Deleted projects are included deliberately: "where did my project go" is a
  // support question, and the answer lives in deleted_at.
  const { data: projectRows } = await (admin as any)
    .from("projects")
    .select("id, name, status, updated_at, deleted_at")
    .eq("created_by", data.userId)
    .order("updated_at", { ascending: false })
    .limit(200);
  const projects = (projectRows as any[]) ?? [];
  const projectIds = projects.map((p) => p.id as string);

  const photoRollups = new Map<string, { photoCount: number; storageBytes: number }>();
  if (projectIds.length) {
    const { data: rpcRows, error: rpcError } = await (admin as any).rpc("admin_project_rollups", {
      project_ids: projectIds,
    });
    if (!rpcError) {
      for (const r of ((rpcRows as any[]) ?? []) as any[]) {
        photoRollups.set(r.project_id, {
          photoCount: Number(r.photo_count ?? 0),
          storageBytes: Number(r.storage_bytes ?? 0),
        });
      }
    } else {
      const photos = await selectIn<{ project_id: string; size_bytes: number | null }>(
        projectIds,
        (ids) =>
          (admin as any).from("photos").select("project_id, size_bytes").in("project_id", ids),
        "admin user detail photos",
      );
      for (const ph of photos) {
        const cur = photoRollups.get(ph.project_id) ?? { photoCount: 0, storageBytes: 0 };
        cur.photoCount += 1;
        cur.storageBytes += ph.size_bytes ?? 0;
        photoRollups.set(ph.project_id, cur);
      }
    }
  }

  /*
   * Member counts for the teams above.
   *
   * One query for every membership row of those teams, counted here. The plan
   * control on this page acts on a whole team, and the count is what makes
   * that visible at the moment of clicking rather than afterwards.
   */
  const teamIdsForUser = ((memberships as any[]) ?? [])
    .filter((m) => m.team)
    .map((m) => m.team.id as string);
  const { data: teamMemberRows } = teamIdsForUser.length
    ? await (admin as any).from("team_members").select("team_id").in("team_id", teamIdsForUser)
    : { data: [] };
  const memberCountByTeam = new Map<string, number>();
  for (const row of ((teamMemberRows as any[]) ?? []) as Array<{ team_id: string }>) {
    memberCountByTeam.set(row.team_id, (memberCountByTeam.get(row.team_id) ?? 0) + 1);
  }

  // Their actual reports, not just a count. "What has this customer told us"
  // is the first question in a support conversation, and it lived one table
  // away with nothing joining it up.
  const { data: feedbackRows } = await (admin as any)
    .from("issue_reports")
    .select("id, kind, status, description, created_at")
    .eq("user_id", data.userId)
    .order("created_at", { ascending: false })
    .limit(20);

  const { data: activityRows } = await (admin as any)
    .from("api_audit_logs")
    .select("id, route, op, http_status, duration_ms, error_code, created_at")
    .eq("user_id", data.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  await logAdminRead(admin, {
    actorId: ctx.userId,
    targetType: "user",
    targetId: data.userId,
    metadata: { email: profile.email },
  });

  const projectList = projects.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    photoCount: photoRollups.get(p.id)?.photoCount ?? 0,
    storageBytes: photoRollups.get(p.id)?.storageBytes ?? 0,
    updatedAt: p.updated_at,
    deletedAt: p.deleted_at ?? null,
  }));

  return {
    id: profile.id,
    fullName: profile.full_name,
    email: profile.email,
    company: profile.company,
    jobTitle: profile.job_title ?? null,
    avatarUrl: profile.avatar_url ?? null,
    createdAt: profile.created_at,
    isPlatformAdmin: !!adminRow,
    adminRole: adminRow ? (((adminRow as any).role as any) ?? "superadmin") : null,
    auth: authInfo,
    teams: ((memberships as any[]) ?? [])
      .filter((m) => m.team)
      .map((m) => ({
        id: m.team.id,
        name: m.team.name,
        plan: m.team.plan,
        subscriptionStatus: m.team.subscription_status,
        isInternal: !!m.team.is_internal,
        role: m.role,
        isOwner: m.team.owner_id === data.userId,
        memberCount: memberCountByTeam.get(m.team.id) ?? 0,
      })),
    projects: projectList,
    totals: {
      projects: projectList.filter((p) => !p.deletedAt).length,
      photos: projectList.reduce((s, p) => s + p.photoCount, 0),
      storageBytes: projectList.reduce((s, p) => s + p.storageBytes, 0),
      feedbackReports: feedbackCount ?? 0,
    },
    feedback: ((feedbackRows as any[]) ?? []).map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      description: r.description,
      createdAt: r.created_at,
    })),
    recentActivity: ((activityRows as any[]) ?? []).map((r) => ({
      id: r.id,
      route: r.route,
      op: r.op,
      httpStatus: r.http_status,
      durationMs: r.duration_ms,
      errorCode: r.error_code,
      createdAt: r.created_at,
    })),
  };
}

// ---------------------------------------------------------------------------
// Support actions
// ---------------------------------------------------------------------------

/**
 * Every mutating support action takes a reason, and the reason goes in the
 * audit log next to the action.
 *
 * Not paperwork. These four actions are the ones that reach into a paying
 * customer's account, and an audit row reading "deleted user X" six weeks later
 * is only half an answer. The field is required rather than optional because an
 * optional one is empty.
 */
const reasonSchema = z.string().trim().min(3).max(500);

export const userSupportActionInputSchema = z.object({
  userId: z.string().uuid(),
  action: z.enum(["send_password_reset", "resend_confirmation", "suspend", "reinstate"]),
  reason: reasonSchema,
  /** Where the emailed links should land. Defaults to the production site. */
  origin: z.string().url().optional(),
});

export async function runUserSupportActionService(
  ctx: AuthedContext,
  data: z.infer<typeof userSupportActionInputSchema>,
): Promise<{ ok: true; message: string }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();

  const { data: authUser } = await admin.auth.admin.getUserById(data.userId);
  const email = (authUser?.user as any)?.email as string | undefined;
  if (!email) throw new Error("That account has no email address on file.");

  const origin = (data.origin ?? "https://everlumen.co").replace(/\/+$/, "");
  let message: string;

  switch (data.action) {
    case "send_password_reset": {
      // Routed through Supabase, so it uses the same Send Email hook every
      // other transactional message does - the one known to deliver.
      const { error } = await admin.auth.resetPasswordForEmail(email, {
        redirectTo: `${origin}/reset-password`,
      });
      if (error) throw new Error(error.message);
      message = `Password reset sent to ${email}.`;
      break;
    }
    case "resend_confirmation": {
      if ((authUser?.user as any)?.email_confirmed_at) {
        // Not an error: the operator asked a reasonable question and the answer
        // is "they are already confirmed, this is not their problem".
        return { ok: true, message: "That address is already confirmed. Nothing sent." };
      }
      /*
       * Sent by us over Resend, not handed to `auth.resend`.
       *
       * `auth.resend` is GoTrue's mailer, and GoTrue does not send this
       * itself: it calls the project's Send Email hook, and a hook URL that
       * does not answer means nothing is ever composed. Against production
       * that path returned 422 `hook_timeout_after_retry` - so the one button
       * in this console for "they never got their confirmation" was itself
       * silently sending nothing, which is the same fault the invite flow was
       * moved off in ../email/signup-confirmation.ts.
       */
      const res = await sendSignupConfirmationEmail(email, origin);
      if (!res.sent) throw new Error(res.reason ?? "The confirmation email could not be sent.");
      message = `Confirmation email resent to ${email}.`;
      break;
    }
    case "suspend": {
      /*
       * Banning, not signing out. GoTrue's admin API can only revoke a session
       * it is handed the JWT for, so "sign out everywhere by user id" is not
       * something it offers. A ban is what actually locks an account, and it is
       * reversible, which a forced password change is not.
       *
       * Long rather than permanent: an accidental permanent lockout of a paying
       * customer is worse than one that has to be renewed.
       */
      const { error } = await admin.auth.admin.updateUserById(data.userId, {
        ban_duration: "876000h",
      } as any);
      if (error) throw new Error(error.message);
      message = `${email} is suspended and cannot sign in.`;
      break;
    }
    case "reinstate": {
      const { error } = await admin.auth.admin.updateUserById(data.userId, {
        ban_duration: "none",
      } as any);
      if (error) throw new Error(error.message);
      message = `${email} can sign in again.`;
      break;
    }
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: `user_${data.action}`,
    targetType: "user",
    targetId: data.userId,
    metadata: { email, reason: data.reason },
  });

  return { ok: true, message };
}

export const deletePlatformUserInputSchema = z.object({
  userId: z.string().uuid(),
  reason: reasonSchema,
  /** Must equal the account's email. The typed confirmation, checked server-side. */
  confirmEmail: z.string().trim().min(1),
});

/**
 * Delete an account for good.
 *
 * The typed confirmation is verified here rather than only in the dialog,
 * because the dialog is not the only caller and this is the one action in the
 * console with no undo. Cascades are the database's job: `platform_admins`,
 * `team_members` and the profile all reference `auth.users` with ON DELETE
 * CASCADE, so removing the auth user is what removes the account.
 *
 * Their projects are NOT deleted. `projects.created_by` is the only link, and
 * silently destroying a team's work because one member left is not a support
 * action - it is data loss with a friendly button. The count is logged so the
 * orphaning is at least visible afterwards.
 */
export async function deletePlatformUserService(
  ctx: AuthedContext,
  data: z.infer<typeof deletePlatformUserInputSchema>,
): Promise<{ ok: true; orphanedProjects: number }> {
  await requirePlatformAdmin(ctx.userId, "owner");
  const admin = getSupabaseAdmin();

  if (data.userId === ctx.userId) {
    throw new Error("You cannot delete your own account from the admin console.");
  }

  const { data: authUser } = await admin.auth.admin.getUserById(data.userId);
  const email = ((authUser?.user as any)?.email as string | undefined) ?? null;
  if (!email) throw new Error("That account has no email address on file.");
  if (data.confirmEmail.trim().toLowerCase() !== email.toLowerCase()) {
    throw new Error("The typed email does not match this account. Nothing was deleted.");
  }

  const { count: orphanedProjects } = await (admin as any)
    .from("projects")
    .select("id", { count: "exact", head: true })
    .eq("created_by", data.userId)
    .is("deleted_at", null);

  // Logged BEFORE the delete: the row references the actor, not the target, so
  // it survives the cascade, but writing it first means a delete that half
  // succeeds still leaves a record that it was attempted.
  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "delete_user",
    targetType: "user",
    targetId: data.userId,
    metadata: { email, reason: data.reason, orphanedProjects: orphanedProjects ?? 0 },
  });

  const { error } = await admin.auth.admin.deleteUser(data.userId);
  if (error) throw new Error(error.message);

  return { ok: true, orphanedProjects: orphanedProjects ?? 0 };
}
