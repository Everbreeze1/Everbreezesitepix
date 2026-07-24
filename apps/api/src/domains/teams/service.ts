import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";


type TeamPlan = "starter" | "pro" | "team";

const PLAN_MEMBER_CAP: Record<TeamPlan, number> = {
  starter: 2,
  pro: 50,
  team: 50,
};

function effectiveMemberLimit(team: any): number {
  return team?.member_limit ?? PLAN_MEMBER_CAP[(team?.plan as TeamPlan) ?? "starter"];
}

// ============================================================
// Get current user's team (the one they own OR belong to)
// ============================================================

// ============================================================
// Create a team (the caller becomes owner)
// ============================================================

// ============================================================
// Invite a teammate by email — enforces plan cap, emails them.
// Plan itself is now Stripe-driven (see domains/billing) — never
// user-settable directly.
// ============================================================

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendInviteEmail(opts: {
  to: string;
  teamName: string;
  inviterName: string;
  acceptUrl: string;
  token: string;
}) {
  try {
    const supabaseAdmin = getSupabaseAdmin();

    // Use Supabase auth invite — emails are sent via the configured
    // Send Email hook (dreamlit.send_supabase_auth_email).
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(opts.to, {
      redirectTo: opts.acceptUrl,
      data: {
        team_name: opts.teamName,
        inviter_name: opts.inviterName,
        invite_token: opts.token,
        accept_url: opts.acceptUrl,
      },
    });

    if (error) {
      // If the user already exists, Supabase refuses to "invite" them.
      // That's fine — they already have an account and can accept the
      // invite by visiting acceptUrl directly. Log and continue.
      const msg = (error.message ?? "").toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        return { sent: false, alreadyRegistered: true };
      }
      console.error("[teams] inviteUserByEmail error", error);
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error("[teams] invite email error", e);
    return { sent: false };
  }
}



// ============================================================
// Revoke a pending invite
// ============================================================

// ============================================================
// Remove a team member
// ============================================================

// ============================================================
// Update a member's role (owner only)
// ============================================================

// ============================================================
// Leave team (members only; owner cannot leave)
// ============================================================

// ============================================================
// Lookup an invite by token
// ============================================================

// ============================================================
// Accept an invite
// ============================================================

// ============================================================
// Accept an invite + create a new account in one step.
// Public (no auth middleware): the invite token is the authorization.
// Returns the email so the client can sign in with the new password.
// ============================================================

// ============================================================
// Resend a pending invite email (best-effort).
// ============================================================

// ============================================================
// Team activity: per-member contribution counts + recent feed
// across photos, tasks, and reports for the caller's team.
// ============================================================
export interface TeamMemberContribution {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  photos: number;
  tasks: number;
  reports: number;
  lastActivityAt: string | null;
}

export type TeamActivityKind = "photo" | "task" | "report" | "project";
export interface TeamActivityItem {
  id: string;
  kind: TeamActivityKind;
  at: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  actorAvatar: string | null;
  projectId: string | null;
  projectName: string | null;
  title: string | null;
}


// ============================================================
// Per-project contributors: distinct users who uploaded photos, created
// tasks, or built reports on a single project. Used to render avatars on
// the project detail page.
// ============================================================
export interface ProjectContributor {
  userId: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
  photos: number;
  tasks: number;
  reports: number;
  lastAt: string | null;
}

export async function getMyTeamService(ctx: AuthedContext) {
    const { supabase, userId } = ctx;

    const { data: membership } = await supabase
      .from("team_members" as any)
      .select("team_id, role")
      .eq("user_id", userId)
      .maybeSingle();

    if (!membership) {
      return { team: null, members: [], invites: [], myRole: null as string | null };
    }

    const teamId = (membership as any).team_id as string;

    const [teamRes, membersRes, invitesRes] = await Promise.all([
      supabase.from("teams" as any).select("*").eq("id", teamId).maybeSingle(),
      supabase
        .from("team_members" as any)
        .select("id, user_id, role, created_at")
        .eq("team_id", teamId)
        .order("created_at", { ascending: true }),
      supabase
        .from("team_invites" as any)
        .select("id, email, role, token, expires_at, accepted_at, created_at")
        .eq("team_id", teamId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
    ]);

    const supabaseAdmin = getSupabaseAdmin();
    const userIds = (membersRes.data ?? []).map((m: any) => m.user_id);
    let profiles: Record<string, { email: string | null; full_name: string | null; avatar_url: string | null }> = {};
    if (userIds.length) {
      const { data: profs } = await supabaseAdmin
        .from("profiles" as any)
        .select("id, email, full_name, avatar_url")
        .in("id", userIds);
      profiles = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p]));
    }

    const members = (membersRes.data ?? []).map((m: any) => ({
      ...m,
      profile: profiles[m.user_id] ?? null,
    }));

    const team = (teamRes.data ?? null) as any;
    const plan: TeamPlan = (team?.plan as TeamPlan) ?? "starter";
    const isInternal = !!team?.is_internal;
    const memberLimit = effectiveMemberLimit(team);

    return {
      team,
      members,
      invites: invitesRes.data ?? [],
      myRole: (membership as any).role as string,
      plan,
      memberLimit,
      subscriptionStatus: (team?.subscription_status as string) ?? "inactive",
      isInternal,
      isActive: isInternal || team?.subscription_status === "active",
      sharingEnabled: isInternal || plan !== "starter",
    };
  }

export async function createTeamService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: existing } = await supabaseAdmin
      .from("team_members" as any)
      .select("team_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) throw new Error("You already belong to a team.");

    const { data: team, error: teamErr } = await supabaseAdmin
      .from("teams" as any)
      .insert({ name: data.name, owner_id: userId, plan: "starter" })
      .select("*")
      .single();
    if (teamErr || !team) throw new Error(teamErr?.message ?? "Failed to create team");

    const { error: memErr } = await supabaseAdmin
      .from("team_members" as any)
      .insert({ team_id: (team as any).id, user_id: userId, role: "owner" });
    if (memErr) throw new Error(memErr.message);

    return { team };
  }

export async function inviteMemberService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();

    // Caller must be owner/admin
    const { data: membership } = await supabaseAdmin
      .from("team_members" as any)
      .select("team_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) throw new Error("Create a team first.");
    const role = (membership as any).role;
    if (role !== "owner" && role !== "admin") throw new Error("Only owners/admins can invite.");
    const teamId = (membership as any).team_id;

    // Load team for plan + cap
    const { data: team } = await supabaseAdmin
      .from("teams" as any)
      .select("id, name, plan, member_limit")
      .eq("id", teamId)
      .single();
    if (!team) throw new Error("Team not found");

    // If the invite already exists, resend the email instead of blocking the workflow.
    const { data: dup } = await supabaseAdmin
      .from("team_invites" as any)
      .select("*")
      .eq("team_id", teamId)
      .eq("email", data.email)
      .is("accepted_at", null)
      .maybeSingle();

    if (dup) {
      const { data: inviterProfile } = await supabaseAdmin
        .from("profiles" as any)
        .select("full_name, email")
        .eq("id", userId)
        .maybeSingle();
      const inviterName =
        (inviterProfile as any)?.full_name ||
        (inviterProfile as any)?.email ||
        "A teammate";
      const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
      const emailRes = await sendInviteEmail({
        to: data.email,
        teamName: (team as any).name,
        inviterName,
        acceptUrl: `${origin}/invite/${(dup as any).token}`,
        token: (dup as any).token,
      });


      return { invite: dup, emailSent: emailRes.sent, resent: true };
    }

    const plan = ((team as any).plan as TeamPlan) ?? "starter";
    const cap = effectiveMemberLimit(team);

    // Count current members + pending invites against the cap
    const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
      supabaseAdmin
        .from("team_members" as any)
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId),
      supabaseAdmin
        .from("team_invites" as any)
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .is("accepted_at", null),
    ]);
    const used = (memberCount ?? 0) + (inviteCount ?? 0);
    if (used >= cap) {
      if (plan === "starter") {
        throw new Error(
          `Starter is limited to ${cap} users (you + 1). Upgrade to Pro or Team to invite more.`,
        );
      }
      throw new Error(`Your team is at its ${cap}-user limit. Upgrade or remove a member to add more.`);
    }

    // Don't invite users already in a team
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles" as any)
      .select("id")
      .eq("email", data.email)
      .maybeSingle();
    if (existingProfile) {
      const { data: alreadyIn } = await supabaseAdmin
        .from("team_members" as any)
        .select("team_id")
        .eq("user_id", (existingProfile as any).id)
        .maybeSingle();
      if (alreadyIn) throw new Error("That user already belongs to a team.");
    }

    const token = generateToken();
    const { data: invite, error } = await supabaseAdmin
      .from("team_invites" as any)
      .insert({
        team_id: teamId,
        email: data.email,
        role: data.role,
        token,
        invited_by: userId,
      })
      .select("*")
      .single();
    if (error || !invite) throw new Error(error?.message ?? "Failed to create invite");

    // Send the email (best effort)
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles" as any)
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const inviterName =
      (inviterProfile as any)?.full_name ||
      (inviterProfile as any)?.email ||
      "A teammate";
    const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
    const acceptUrl = `${origin}/invite/${token}`;

    const emailRes = await sendInviteEmail({
      to: data.email,
      teamName: (team as any).name,
      inviterName,
      acceptUrl,
      token,
    });


    return { invite, emailSent: emailRes.sent };
  }

export async function revokeInviteService(ctx: AuthedContext, data: any) {
    const { supabase } = ctx;
    const { error } = await supabase.from("team_invites" as any).delete().eq("id", data.inviteId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

export async function removeMemberService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const { data: target } = await supabaseAdmin
      .from("team_members" as any)
      .select("id, team_id, user_id, role")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!target) throw new Error("Member not found");
    if ((target as any).role === "owner") throw new Error("Cannot remove the owner.");

    const { data: caller } = await supabaseAdmin
      .from("team_members" as any)
      .select("role, team_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!caller || (caller as any).team_id !== (target as any).team_id) throw new Error("Forbidden");
    if ((caller as any).role !== "owner" && (caller as any).role !== "admin") throw new Error("Forbidden");

    const { error } = await supabaseAdmin.from("team_members" as any).delete().eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

export async function updateMemberRoleService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const { data: target } = await supabaseAdmin
      .from("team_members" as any)
      .select("id, team_id, role")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!target) throw new Error("Member not found");
    if ((target as any).role === "owner") throw new Error("Cannot change owner role.");

    const { data: team } = await supabaseAdmin
      .from("teams" as any)
      .select("owner_id")
      .eq("id", (target as any).team_id)
      .single();
    if (!team || (team as any).owner_id !== userId) throw new Error("Only the owner can change roles.");

    const { error } = await supabaseAdmin
      .from("team_members" as any)
      .update({ role: data.role })
      .eq("id", data.memberId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

export async function leaveTeamService(ctx: AuthedContext) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();
    const { data: m } = await supabaseAdmin
      .from("team_members" as any)
      .select("id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (!m) return { ok: true };
    if ((m as any).role === "owner") throw new Error("Owners must delete the team instead.");
    const { error } = await supabaseAdmin.from("team_members" as any).delete().eq("id", (m as any).id);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

export async function lookupInviteService(data: any) {
    const supabaseAdmin = getSupabaseAdmin();
    const { data: invite } = await supabaseAdmin
      .from("team_invites" as any)
      .select("id, team_id, email, role, expires_at, accepted_at")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite) return { invite: null, team: null };
    const { data: team } = await supabaseAdmin
      .from("teams" as any)
      .select("id, name")
      .eq("id", (invite as any).team_id)
      .single();
    return { invite, team };
  }

export async function acceptInviteService(ctx: AuthedContext, data: any) {
    const { userId, claims } = ctx;
    const userEmail = (claims as any)?.email as string | undefined;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: invite } = await supabaseAdmin
      .from("team_invites" as any)
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite) throw new Error("Invite not found or already used.");
    if ((invite as any).accepted_at) throw new Error("This invite has already been used.");
    if (new Date((invite as any).expires_at) < new Date()) throw new Error("This invite has expired.");
    if (userEmail && userEmail.toLowerCase() !== (invite as any).email.toLowerCase()) {
      throw new Error(`This invite is for ${(invite as any).email}. Sign in with that email to accept.`);
    }

    const { data: existing } = await supabaseAdmin
      .from("team_members" as any)
      .select("team_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing) throw new Error("You already belong to a team. Leave it first.");

    // Re-check the cap at accept time, in case it changed
    const teamId = (invite as any).team_id;
    const { data: team } = await supabaseAdmin
      .from("teams" as any)
      .select("plan, member_limit, owner_id")
      .eq("id", teamId)
      .single();
    const cap = effectiveMemberLimit(team);
    const { count: memberCount } = await supabaseAdmin
      .from("team_members" as any)
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId);
    if ((memberCount ?? 0) >= cap) {
      throw new Error("This team is full. Ask the owner to upgrade or free a seat.");
    }

    const { error: insErr } = await supabaseAdmin.from("team_members" as any).insert({
      team_id: teamId,
      user_id: userId,
      role: (invite as any).role,
    });
    if (insErr) throw new Error(insErr.message);

    await supabaseAdmin
      .from("team_invites" as any)
      .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", (invite as any).id);

    return { ok: true, teamId };
  }

export async function acceptInviteSignupService(data: any) {
    const supabaseAdmin = getSupabaseAdmin();

    const { data: invite } = await supabaseAdmin
      .from("team_invites" as any)
      .select("*")
      .eq("token", data.token)
      .maybeSingle();
    if (!invite) throw new Error("Invite not found or already used.");
    if ((invite as any).accepted_at) throw new Error("This invite has already been used.");
    if (new Date((invite as any).expires_at) < new Date()) throw new Error("This invite has expired.");

    const inviteEmail = ((invite as any).email as string).toLowerCase();
    const teamId = (invite as any).team_id as string;

    // Cap check
    const { data: team } = await supabaseAdmin
      .from("teams" as any)
      .select("plan, member_limit, owner_id")
      .eq("id", teamId)
      .single();
    const cap = effectiveMemberLimit(team);
    const { count: memberCount } = await supabaseAdmin
      .from("team_members" as any)
      .select("id", { count: "exact", head: true })
      .eq("team_id", teamId);
    if ((memberCount ?? 0) >= cap) {
      throw new Error("This team is full. Ask the owner to upgrade or free a seat.");
    }

    // Find or create the auth user for the invited email.
    let userId: string | null = null;

    // Check if a profile already exists for this email
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles" as any)
      .select("id")
      .eq("email", inviteEmail)
      .maybeSingle();

    if (existingProfile) {
      userId = (existingProfile as any).id as string;
      // Update password + name so they can log in with what they just typed.
      const { error: updErr } = await (supabaseAdmin as any).auth.admin.updateUserById(userId, {
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (updErr) throw new Error(updErr.message);
    } else {
      const { data: created, error: createErr } = await (supabaseAdmin as any).auth.admin.createUser({
        email: inviteEmail,
        password: data.password,
        email_confirm: true,
        user_metadata: { full_name: data.fullName },
      });
      if (createErr || !created?.user) {
        throw new Error(createErr?.message ?? "Failed to create account");
      }
      userId = created.user.id as string;
    }

    if (!userId) throw new Error("Failed to resolve user");

    // Upsert profile
    await supabaseAdmin
      .from("profiles" as any)
      .upsert(
        { id: userId, email: inviteEmail, full_name: data.fullName },
        { onConflict: "id" },
      );

    // Ensure they're not already in another team
    const { data: existingMembership } = await supabaseAdmin
      .from("team_members" as any)
      .select("team_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (existingMembership && (existingMembership as any).team_id !== teamId) {
      throw new Error("You already belong to a team. Leave it first.");
    }

    if (!existingMembership) {
      const { error: insErr } = await supabaseAdmin.from("team_members" as any).insert({
        team_id: teamId,
        user_id: userId,
        role: (invite as any).role,
      });
      if (insErr) throw new Error(insErr.message);
    }

    await supabaseAdmin
      .from("team_invites" as any)
      .update({ accepted_at: new Date().toISOString(), accepted_by: userId })
      .eq("id", (invite as any).id);

    return { ok: true, email: inviteEmail, teamId };
  }

export async function resendInviteService(ctx: AuthedContext, data: any) {
    const { userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();

    const { data: invite } = await supabaseAdmin
      .from("team_invites" as any)
      .select("id, team_id, email, token, expires_at, accepted_at")
      .eq("id", data.inviteId)
      .maybeSingle();
    if (!invite) throw new Error("Invite not found");
    if ((invite as any).accepted_at) throw new Error("This invite has already been accepted.");

    const { data: caller } = await supabaseAdmin
      .from("team_members" as any)
      .select("team_id, role")
      .eq("user_id", userId)
      .maybeSingle();
    if (!caller || (caller as any).team_id !== (invite as any).team_id) throw new Error("Forbidden");
    if ((caller as any).role !== "owner" && (caller as any).role !== "admin") throw new Error("Forbidden");

    const { data: team } = await supabaseAdmin
      .from("teams" as any)
      .select("name")
      .eq("id", (invite as any).team_id)
      .single();

    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles" as any)
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const inviterName =
      (inviterProfile as any)?.full_name ||
      (inviterProfile as any)?.email ||
      "A teammate";

    const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
    const emailRes = await sendInviteEmail({
      to: (invite as any).email,
      teamName: (team as any).name,
      inviterName,
      acceptUrl: `${origin}/invite/${(invite as any).token}`,
      token: (invite as any).token,
    });

    return { ok: true, emailSent: emailRes.sent };
  }

export async function getTeamActivityService(ctx: AuthedContext) {
    const { supabase, userId } = ctx;
    const supabaseAdmin = getSupabaseAdmin();

    // Resolve team via the caller's membership.
    const { data: membership } = await supabase
      .from("team_members" as any)
      .select("team_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership) {
      return {
        members: [] as TeamMemberContribution[],
        recent: [] as TeamActivityItem[],
      };
    }
    const teamId = (membership as any).team_id as string;

    const { data: memberRows } = await supabaseAdmin
      .from("team_members" as any)
      .select("user_id, role")
      .eq("team_id", teamId);
    const memberIds = (memberRows ?? []).map((m: any) => m.user_id as string);
    if (memberIds.length === 0) {
      return {
        members: [] as TeamMemberContribution[],
        recent: [] as TeamActivityItem[],
      };
    }

    const { data: profiles } = await supabaseAdmin
      .from("profiles" as any)
      .select("id, full_name, email, avatar_url")
      .in("id", memberIds);
    const profileMap = new Map<string, any>();
    for (const p of profiles ?? []) profileMap.set((p as any).id, p);
    const roleMap = new Map<string, string>();
    for (const m of memberRows ?? []) roleMap.set((m as any).user_id, (m as any).role);

    // Pull all projects owned by any team member (the app already treats
    // these as the team's shared workspace).
    const { data: projectRows } = await supabaseAdmin
      .from("projects" as any)
      .select("id, name, created_by, created_at, updated_at")
      .in("created_by", memberIds)
      .order("updated_at", { ascending: false })
      .limit(200);
    const projects = (projectRows ?? []) as any[];
    const projectIds = projects.map((p) => p.id as string);
    const projectMap = new Map<string, any>();
    for (const p of projects) projectMap.set(p.id, p);

    // Pull recent photos/tasks/reports across those projects, scoped to team
    // members.
    const recentLimit = 200;
    const [photosRes, tasksRes, reportsRes] = await Promise.all([
      projectIds.length
        ? supabaseAdmin
            .from("photos" as any)
            .select("id, project_id, uploaded_by, caption, created_at")
            .in("project_id", projectIds)
            .in("uploaded_by", memberIds)
            .order("created_at", { ascending: false })
            .limit(recentLimit)
        : Promise.resolve({ data: [] as any[] }),
      projectIds.length
        ? supabaseAdmin
            .from("tasks" as any)
            .select("id, project_id, created_by, title, created_at")
            .in("project_id", projectIds)
            .in("created_by", memberIds)
            .order("created_at", { ascending: false })
            .limit(recentLimit)
        : Promise.resolve({ data: [] as any[] }),
      projectIds.length
        ? supabaseAdmin
            .from("project_reports" as any)
            .select("id, project_id, created_by, title, created_at")
            .in("project_id", projectIds)
            .in("created_by", memberIds)
            .order("created_at", { ascending: false })
            .limit(recentLimit)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const photos = (photosRes as any).data ?? [];
    const tasks = (tasksRes as any).data ?? [];
    const reports = (reportsRes as any).data ?? [];

    // Build per-member contribution stats.
    const counts = new Map<string, { photos: number; tasks: number; reports: number; lastAt: number }>();
    function bump(uid: string, key: "photos" | "tasks" | "reports", iso: string) {
      let c = counts.get(uid);
      if (!c) {
        c = { photos: 0, tasks: 0, reports: 0, lastAt: 0 };
        counts.set(uid, c);
      }
      c[key] += 1;
      const t = new Date(iso).getTime();
      if (t > c.lastAt) c.lastAt = t;
    }
    for (const p of photos) bump(p.uploaded_by, "photos", p.created_at);
    for (const t of tasks) bump(t.created_by, "tasks", t.created_at);
    for (const r of reports) bump(r.created_by, "reports", r.created_at);

    const members: TeamMemberContribution[] = memberIds.map((uid) => {
      const c = counts.get(uid);
      const prof = profileMap.get(uid);
      return {
        userId: uid,
        fullName: prof?.full_name ?? null,
        email: prof?.email ?? null,
        avatarUrl: prof?.avatar_url ?? null,
        role: roleMap.get(uid) ?? "member",
        photos: c?.photos ?? 0,
        tasks: c?.tasks ?? 0,
        reports: c?.reports ?? 0,
        lastActivityAt: c && c.lastAt > 0 ? new Date(c.lastAt).toISOString() : null,
      };
    });

    // Merge recent items into a single activity feed.
    const feed: TeamActivityItem[] = [];
    const mkActor = (uid: string) => {
      const prof = profileMap.get(uid);
      return {
        actorId: uid,
        actorName: prof?.full_name ?? null,
        actorEmail: prof?.email ?? null,
        actorAvatar: prof?.avatar_url ?? null,
      };
    };
    const mkProj = (pid: string | null) => {
      if (!pid) return { projectId: null, projectName: null };
      const p = projectMap.get(pid);
      return { projectId: pid, projectName: p?.name ?? null };
    };
    for (const p of photos) {
      feed.push({
        id: `photo:${p.id}`,
        kind: "photo",
        at: p.created_at,
        ...mkActor(p.uploaded_by),
        ...mkProj(p.project_id),
        title: p.caption ?? null,
      });
    }
    for (const t of tasks) {
      feed.push({
        id: `task:${t.id}`,
        kind: "task",
        at: t.created_at,
        ...mkActor(t.created_by),
        ...mkProj(t.project_id),
        title: t.title ?? null,
      });
    }
    for (const r of reports) {
      feed.push({
        id: `report:${r.id}`,
        kind: "report",
        at: r.created_at,
        ...mkActor(r.created_by),
        ...mkProj(r.project_id),
        title: r.title ?? null,
      });
    }
    for (const proj of projects.slice(0, 50)) {
      feed.push({
        id: `project:${proj.id}`,
        kind: "project",
        at: proj.created_at,
        ...mkActor(proj.created_by),
        projectId: proj.id,
        projectName: proj.name ?? null,
        title: proj.name ?? null,
      });
    }
    feed.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return {
      members: members.sort((a, b) => {
        // Owner first, then by recency, then by total contributions.
        if (a.role === "owner" && b.role !== "owner") return -1;
        if (b.role === "owner" && a.role !== "owner") return 1;
        const at = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
        const bt = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
        if (at !== bt) return bt - at;
        return (b.photos + b.tasks + b.reports) - (a.photos + a.tasks + a.reports);
      }),
      recent: feed.slice(0, 25),
    };
  }

export async function getProjectContributorsService(ctx: AuthedContext, data: any) {
    const { supabase } = ctx;
    const supabaseAdmin = getSupabaseAdmin();

    // RLS-scoped ownership check: caller must be able to see the project.
    const { data: proj } = await supabase
      .from("projects")
      .select("id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (!proj) return { contributors: [] as ProjectContributor[] };

    const [photosRes, tasksRes, reportsRes] = await Promise.all([
      supabaseAdmin.from("photos" as any).select("uploaded_by, created_at").eq("project_id", data.projectId),
      supabaseAdmin.from("tasks" as any).select("created_by, created_at").eq("project_id", data.projectId),
      supabaseAdmin.from("project_reports" as any).select("created_by, created_at").eq("project_id", data.projectId),
    ]);

    const counts = new Map<string, { photos: number; tasks: number; reports: number; lastAt: number }>();
    function bump(uid: string | null, key: "photos" | "tasks" | "reports", iso: string) {
      if (!uid) return;
      let c = counts.get(uid);
      if (!c) {
        c = { photos: 0, tasks: 0, reports: 0, lastAt: 0 };
        counts.set(uid, c);
      }
      c[key] += 1;
      const t = new Date(iso).getTime();
      if (t > c.lastAt) c.lastAt = t;
    }
    for (const p of (photosRes.data ?? []) as any[]) bump(p.uploaded_by, "photos", p.created_at);
    for (const t of (tasksRes.data ?? []) as any[]) bump(t.created_by, "tasks", t.created_at);
    for (const r of (reportsRes.data ?? []) as any[]) bump(r.created_by, "reports", r.created_at);

    const ids = Array.from(counts.keys());
    if (ids.length === 0) return { contributors: [] as ProjectContributor[] };

    const { data: profiles } = await supabaseAdmin
      .from("profiles" as any)
      .select("id, full_name, email, avatar_url")
      .in("id", ids);
    const profileMap = new Map<string, any>();
    for (const p of profiles ?? []) profileMap.set((p as any).id, p);

    const contributors: ProjectContributor[] = ids.map((uid) => {
      const c = counts.get(uid)!;
      const p = profileMap.get(uid);
      return {
        userId: uid,
        fullName: p?.full_name ?? null,
        email: p?.email ?? null,
        avatarUrl: p?.avatar_url ?? null,
        photos: c.photos,
        tasks: c.tasks,
        reports: c.reports,
        lastAt: c.lastAt > 0 ? new Date(c.lastAt).toISOString() : null,
      };
    });

    contributors.sort((a, b) => {
      const at = a.lastAt ? new Date(a.lastAt).getTime() : 0;
      const bt = b.lastAt ? new Date(b.lastAt).getTime() : 0;
      if (at !== bt) return bt - at;
      return (b.photos + b.tasks + b.reports) - (a.photos + a.tasks + a.reports);
    });

    return { contributors };
  }
