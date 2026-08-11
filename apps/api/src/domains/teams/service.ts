import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";
import { rateLimit } from "../../lib/rate-limit";
import { ACTIVE_SUBSCRIPTION_STATUSES, PLAN_MEMBER_CAP } from "../../lib/team-plan";
import { insertNotification } from "../notifications/service";
import { sendTeamInviteEmail } from "../email/team-invite";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

type TeamPlan = "starter" | "pro" | "team";

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

/**
 * Mail a team invite, by whichever route works.
 *
 * This used to be GoTrue or nothing. `auth.admin.inviteUserByEmail` refuses —
 * and sends nothing — for an address that ALREADY HAS AN ACCOUNT, for a
 * rate-limited address, and for any error out of the Send Email hook. All three
 * returned `{ sent: false }` with no second attempt, so the invitee got nothing
 * and the owner was left copying a raw 48-character token out of a code block.
 * That is exactly the "Invite link (email not sent)" the bug report shows, and
 * the already-registered branch is the most common of the three: inviting anyone
 * who has ever signed up hit it every single time.
 *
 * So GoTrue is now an optimisation, not the only path. When it declines for any
 * reason we send the invite ourselves through Resend, which needs no GoTrue user
 * because `/invite/<token>` handles both accept-as-existing-user and
 * sign-up-in-place.
 *
 * `alreadyRegistered` is deliberately NOT returned any more. Telling the caller
 * "that address already has a SitePix account" is account enumeration by anyone
 * who can create a team and type an address — and now that the mail goes out
 * regardless, there is nothing left to explain.
 */
async function sendInviteEmail(opts: {
  to: string;
  teamName: string;
  inviterName: string;
  acceptUrl: string;
  token: string;
}): Promise<{ sent: boolean; via: "gotrue" | "resend" | null; reason: string | null }> {
  let reason: string | null = null;

  try {
    const supabaseAdmin = getSupabaseAdmin();
    // Preferred when it works: GoTrue also provisions the auth user, so the
    // invitee lands with a session already established.
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(opts.to, {
      redirectTo: opts.acceptUrl,
      data: {
        team_name: opts.teamName,
        inviter_name: opts.inviterName,
        invite_token: opts.token,
        accept_url: opts.acceptUrl,
      },
    });
    if (!error) return { sent: true, via: "gotrue", reason: null };
    reason = error.message ?? "gotrue_error";
  } catch (e) {
    reason = e instanceof Error ? e.message : "gotrue_threw";
  }

  try {
    await sendTeamInviteEmail({ to: opts.to, acceptUrl: opts.acceptUrl });
    console.warn("[teams] invite sent via resend fallback", { reason });
    return { sent: true, via: "resend", reason };
  } catch (e) {
    console.error("[teams] invite email failed on both routes", { reason, error: e });
    return { sent: false, via: null, reason };
  }
}

/*
 * Ask GoTrue to mail the signup confirmation for an account created through
 * the invite flow. `auth.admin.createUser` never sends anything, so without
 * this an invitee would be left holding an unconfirmed account with no way to
 * confirm it. Routed through Supabase — and therefore through the same Send
 * Email hook the invite itself uses — rather than lib/send-email.ts, so it
 * lands in the pipeline that is already known to deliver.
 *
 * Best effort: a mail failure must not roll back an account that now exists.
 */
async function sendSignupConfirmationEmail(email: string, origin: string) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const { error } = await supabaseAdmin.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: `${origin}/dashboard` },
    });
    if (error) {
      console.error("[teams] signup confirmation email error", error);
      return { sent: false };
    }
    return { sent: true };
  } catch (e) {
    console.error("[teams] signup confirmation email error", e);
    return { sent: false };
  }
}

/*
 * Per-token rate limits for the two PUBLIC invite ops (`lookupInvite`,
 * `acceptInviteSignup` — both registered with `pub()` in the RPC registry).
 *
 * Their only credential is the token, and the limiter in rpc/handle.ts is
 * keyed on the caller's IP and shared across every op, so a caller rotating
 * addresses gets an effectively unlimited budget against one invite. Keying on
 * the token instead caps how hard a single invite can be hammered no matter
 * where the requests come from — enough to make a scripted retry loop against
 * a leaked or guessed token expensive.
 */
const INVITE_LOOKUP_RATE = { limit: 30, windowMs: 60_000 };
const INVITE_SIGNUP_RATE = { limit: 5, windowMs: 15 * 60_000 };

function limitInviteOp(scope: string, token: string, rate: { limit: number; windowMs: number }) {
  const rl = rateLimit({ key: `invite:${scope}:${token}`, ...rate });
  if (!rl.ok) {
    throw Object.assign(
      new Error("Too many attempts on this invite. Please try again in a few minutes."),
      { status: 429 },
    );
  }
}

/*
 * Claim an invite atomically.
 *
 * Both accept paths used to read the row, check `accepted_at`, and only write
 * it several awaits later — so two concurrent requests carrying the same token
 * both passed the check and both went on to join a team. This conditional
 * UPDATE is the whole guard: Postgres serialises it, exactly one caller gets a
 * row back and everyone else gets null. Expiry is folded into the same
 * statement so a token can't be claimed in the gap after it lapses.
 *
 * Claim BEFORE creating anything. If the work that follows fails, call
 * `releaseInviteClaim` so the invite isn't burned.
 */
async function claimInvite(admin: SupabaseAdmin, token: string, acceptedBy: string | null) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("team_invites" as any)
    .update({ accepted_at: now, accepted_by: acceptedBy })
    .eq("token", token)
    .is("accepted_at", null)
    .gt("expires_at", now)
    .select("*")
    .maybeSingle();
  // A losing race and a broken statement both come back with no row, and the
  // caller turns either into "already used". Log so the second one is findable.
  if (error) console.error("[teams] failed to claim invite", error);
  return data as any;
}

/** Undo a claim so a downstream failure doesn't spend a one-time invite. */
async function releaseInviteClaim(admin: SupabaseAdmin, inviteId: string) {
  const { error } = await admin
    .from("team_invites" as any)
    .update({ accepted_at: null, accepted_by: null })
    .eq("id", inviteId);
  if (error) console.error("[teams] failed to release invite claim", inviteId, error);
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
    supabase
      .from("teams" as any)
      .select("*")
      .eq("id", teamId)
      .maybeSingle(),
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
  let profiles: Record<
    string,
    { email: string | null; full_name: string | null; avatar_url: string | null }
  > = {};
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
    // Same rule as getCallerTeamPlan — this is what `useSubscription` on the
    // web reads, so the two must agree or the UI hides what the server serves.
    isActive: isInternal || ACTIVE_SUBSCRIPTION_STATUSES.has(team?.subscription_status as string),
    // Every plan shares the project record now, including Starter — small
    // crews are the point of Starter's second seat, and a seat that can't see
    // the shared work is not a seat. Plans differ by seat count (Starter 2,
    // Pro/Team 50), enforced via teams.member_limit. Mirrors the DB predicate
    // in supabase/migrations/20260803040000_starter_project_sharing.sql.
    sharingEnabled: true,
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

  /*
   * Normalise once, here, and use `email` everywhere below.
   *
   * The duplicate probe matched on the raw string, so "Crew@x.com" and
   * "crew@x.com" were two different open invites for the same person. Storing
   * one canonical form lets the partial unique index in 20260813000000 be a
   * plain (team_id, email) rather than an expression index that a
   * case-sensitive `.eq()` would silently fail to use.
   */
  const email: string = String(data.email ?? "")
    .trim()
    .toLowerCase();

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

  /*
   * If the invite already exists, resend the email instead of blocking.
   *
   * `.maybeSingle()` returns `{ data: null, error: PGRST116 }` when more than
   * one row matches, and this destructured only `data` — so the moment a race
   * produced two open invites for one address, `dup` was null forever and every
   * later invite inserted yet another row instead of resending. `.limit(1)` with
   * a deterministic order makes the probe answer correctly even mid-cleanup, and
   * the error is no longer discarded.
   */
  const { data: dup, error: dupErr } = await supabaseAdmin
    .from("team_invites" as any)
    .select("*")
    .eq("team_id", teamId)
    .eq("email", email)
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dupErr) console.error("[teams] invite duplicate probe failed", dupErr);

  if (dup) {
    const { data: inviterProfile } = await supabaseAdmin
      .from("profiles" as any)
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const inviterName =
      (inviterProfile as any)?.full_name || (inviterProfile as any)?.email || "A teammate";
    const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
    const emailRes = await sendInviteEmail({
      to: email,
      teamName: (team as any).name,
      inviterName,
      acceptUrl: `${origin}/invite/${(dup as any).token}`,
      token: (dup as any).token,
    });

    return { invite: dup, emailSent: emailRes.sent, emailVia: emailRes.via, resent: true };
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
    throw new Error(
      `Your team is at its ${cap}-user limit. Upgrade or remove a member to add more.`,
    );
  }

  // Don't invite users already in a team
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles" as any)
    .select("id")
    .eq("email", email)
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
      email,
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
    (inviterProfile as any)?.full_name || (inviterProfile as any)?.email || "A teammate";
  const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
  const acceptUrl = `${origin}/invite/${token}`;

  const emailRes = await sendInviteEmail({
    to: email,
    teamName: (team as any).name,
    inviterName,
    acceptUrl,
    token,
  });

  return { invite, emailSent: emailRes.sent, emailVia: emailRes.via };
}

export async function revokeInviteService(ctx: AuthedContext, data: any) {
  const { supabase } = ctx;
  const { error } = await supabase
    .from("team_invites" as any)
    .delete()
    .eq("id", data.inviteId);
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
  if ((caller as any).role !== "owner" && (caller as any).role !== "admin")
    throw new Error("Forbidden");

  const { error } = await supabaseAdmin
    .from("team_members" as any)
    .delete()
    .eq("id", data.memberId);
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
  if (!team || (team as any).owner_id !== userId)
    throw new Error("Only the owner can change roles.");

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
  const { error } = await supabaseAdmin
    .from("team_members" as any)
    .delete()
    .eq("id", (m as any).id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function lookupInviteService(data: any) {
  const supabaseAdmin = getSupabaseAdmin();

  limitInviteOp("lookup", data.token, INVITE_LOOKUP_RATE);

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
  if (new Date((invite as any).expires_at) < new Date())
    throw new Error("This invite has expired.");
  if (userEmail && userEmail.toLowerCase() !== (invite as any).email.toLowerCase()) {
    throw new Error(
      `This invite is for ${(invite as any).email}. Sign in with that email to accept.`,
    );
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

  // Spend the token before inserting the membership, so two concurrent accepts
  // can't both add a seat (see claimInvite).
  const claimed = await claimInvite(supabaseAdmin, data.token, userId);
  if (!claimed) throw new Error("This invite has already been used.");

  const { data: inserted, error: insErr } = await supabaseAdmin
    .from("team_members" as any)
    .insert({
      team_id: teamId,
      user_id: userId,
      role: (invite as any).role,
    })
    .select("id")
    .single();
  if (insErr || !inserted) {
    await releaseInviteClaim(supabaseAdmin, (claimed as any).id);
    throw new Error(insErr?.message ?? "Could not join the team.");
  }

  /*
   * Confirm the seat AFTER taking it.
   *
   * The cap check above is check-then-act: two people accepting two different
   * invites at the same moment both read `memberCount` before either inserts,
   * so both pass and the team ends up over its paid seat count. `claimInvite`
   * only makes a single *token* single-use; it does nothing about two distinct
   * tokens racing.
   *
   * Re-counting after the insert closes that: whoever ends up beyond the cap
   * sees it and gives the seat back. Concurrent accepts can both observe an
   * over-cap count and both roll back — which errs toward refusing a seat
   * rather than selling one that wasn't paid for, and the invite is released so
   * either can simply try again.
   *
   * The real fix is a database constraint (an exclusion constraint, or a
   * trigger counting rows per team); this is what is available without a
   * migration.
   */
  const { count: finalCount } = await supabaseAdmin
    .from("team_members" as any)
    .select("id", { count: "exact", head: true })
    .eq("team_id", teamId);
  if ((finalCount ?? 0) > cap) {
    await supabaseAdmin
      .from("team_members" as any)
      .delete()
      .eq("id", (inserted as any).id);
    await releaseInviteClaim(supabaseAdmin, (claimed as any).id);
    throw new Error("This team is full. Ask the owner to upgrade or free a seat.");
  }

  await insertNotification(supabaseAdmin, {
    recipientId: (invite as any).invited_by,
    actorId: userId,
    type: "team_invite_accepted",
    title: `${userEmail ?? "A new teammate"} joined your team`,
    linkPath: "/teams",
    entityType: "team_invite",
    entityId: (invite as any).id,
  });

  return { ok: true, teamId };
}

export async function acceptInviteSignupService(data: any) {
  const supabaseAdmin = getSupabaseAdmin();

  limitInviteOp("signup", data.token, INVITE_SIGNUP_RATE);

  const { data: invite } = await supabaseAdmin
    .from("team_invites" as any)
    .select("*")
    .eq("token", data.token)
    .maybeSingle();
  if (!invite) throw new Error("Invite not found or already used.");
  if ((invite as any).accepted_at) throw new Error("This invite has already been used.");
  if (new Date((invite as any).expires_at) < new Date())
    throw new Error("This invite has expired.");

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
    /*
     * SECURITY — never modify an account that already exists.
     *
     * This operation is PUBLIC: it is registered with `pub()` in the RPC
     * registry, so there is no Authorization header and the caller has
     * proven nothing about who they are. It used to call
     * `auth.admin.updateUserById(userId, { password, email_confirm: true })`
     * right here, which turned a team invite into an unauthenticated
     * password reset for the invited address.
     *
     * The invite token is not a secret from the inviter, either:
     * `inviteMemberService` returns the inserted row with `select("*")` and
     * `getMyTeamService` selects `token` explicitly. So anyone who could
     * invite an address — which is any signed-up user, since `createTeam`
     * is ungated and the only restriction is that the target isn't already
     * on a team — could read the token out of their own response, POST it
     * here with a password of their choosing, and take over that account
     * along with every project, photo, report and share link on it. The
     * victim received no notification, because the "joined your team"
     * notification is sent to the inviter.
     *
     * Signing up is only ever for an address with no account. An existing
     * user joins through the authenticated `acceptInvite` op, which proves
     * they control the address by making them log in first.
     */
    throw Object.assign(
      new Error(
        "An account already exists for this email. Please sign in first, then open the invite link again to join the team.",
      ),
      { status: 409 },
    );
  }

  /*
   * Spend the token now, before an account exists.
   *
   * The `accepted_at` check above is a courtesy that produces a good error
   * message; it is not the guard. Everything between that read and this write
   * is an await, so two requests carrying the same token both got here and both
   * created an account. `claimInvite` is the guard — one winner, everyone else
   * gets null. Any failure below releases the claim so a legitimate invitee
   * isn't left with a burned link.
   */
  const claimed = await claimInvite(supabaseAdmin, data.token, null);
  if (!claimed) throw new Error("This invite has already been used.");

  try {
    /*
     * SECURITY — do NOT pre-confirm this address.
     *
     * This op is public and the invite token is its only credential, so the
     * caller has proven they hold a token, not that they can read the invited
     * inbox. Those were the same thing right up until the token turned out to
     * be readable from the client (team_invites was SELECTable by the anon
     * key), at which point `email_confirm: true` handed anyone who scraped a
     * token a pre-confirmed, immediately usable account under someone else's
     * address with a password of their choosing.
     *
     * Creating the user unconfirmed puts the invite path on exactly the same
     * footing as the ordinary /signup path: the account is inert until whoever
     * actually receives the mail clicks the confirmation link. A scraped token
     * then buys a squatted, unusable login rather than a live account — and the
     * confirmation mail lands in the victim's inbox, so they find out.
     */
    const { data: created, error: createErr } = await (supabaseAdmin as any).auth.admin.createUser({
      email: inviteEmail,
      password: data.password,
      user_metadata: { full_name: data.fullName },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message ?? "Failed to create account");
    }
    userId = created.user.id as string;

    if (!userId) throw new Error("Failed to resolve user");

    // Upsert profile
    await supabaseAdmin
      .from("profiles" as any)
      .upsert({ id: userId, email: inviteEmail, full_name: data.fullName }, { onConflict: "id" });

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
      const { data: inserted, error: insErr } = await supabaseAdmin
        .from("team_members" as any)
        .insert({
          team_id: teamId,
          user_id: userId,
          role: (invite as any).role,
        })
        .select("id")
        .single();
      if (insErr || !inserted) throw new Error(insErr?.message ?? "Could not join the team.");

      // Confirm the seat after taking it — same check-then-act race as
      // acceptInviteService, and the same compensating rollback. Throwing here
      // lands in the catch below, which releases the invite so the person can
      // retry once a seat frees up.
      const { count: finalCount } = await supabaseAdmin
        .from("team_members" as any)
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId);
      if ((finalCount ?? 0) > cap) {
        await supabaseAdmin
          .from("team_members" as any)
          .delete()
          .eq("id", (inserted as any).id);
        throw new Error("This team is full. Ask the owner to upgrade or free a seat.");
      }
    }
  } catch (err) {
    /*
     * Nothing durable survives a failure here except possibly the auth user,
     * and the 409 branch above tells that person to sign in and reopen the
     * link — which needs the invite to still be open. So release it.
     */
    await releaseInviteClaim(supabaseAdmin, (claimed as any).id);
    throw err;
  }

  // Record who spent the token (claimInvite has no user id to write yet).
  await supabaseAdmin
    .from("team_invites" as any)
    .update({ accepted_by: userId })
    .eq("id", (claimed as any).id);

  const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
  const confirmRes = await sendSignupConfirmationEmail(inviteEmail, origin);

  await insertNotification(supabaseAdmin, {
    recipientId: (invite as any).invited_by,
    actorId: userId,
    type: "team_invite_accepted",
    title: `${data.fullName ?? inviteEmail} joined your team`,
    linkPath: "/teams",
    entityType: "team_invite",
    entityId: (invite as any).id,
  });

  // `emailConfirmationRequired` tells the client not to expect
  // signInWithPassword to succeed yet — same state /signup reaches when
  // `signUp` comes back without a session.
  return {
    ok: true,
    email: inviteEmail,
    teamId,
    emailConfirmationRequired: true,
    confirmationEmailSent: confirmRes.sent,
  };
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
  if ((caller as any).role !== "owner" && (caller as any).role !== "admin")
    throw new Error("Forbidden");

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
    (inviterProfile as any)?.full_name || (inviterProfile as any)?.email || "A teammate";

  const origin = data.origin?.replace(/\/+$/, "") || "https://everbreezesitepix.com";
  const emailRes = await sendInviteEmail({
    to: (invite as any).email,
    teamName: (team as any).name,
    inviterName,
    acceptUrl: `${origin}/invite/${(invite as any).token}`,
    token: (invite as any).token,
  });

  return { ok: true, emailSent: emailRes.sent, emailVia: emailRes.via };
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
  const counts = new Map<
    string,
    { photos: number; tasks: number; reports: number; lastAt: number }
  >();
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
      return b.photos + b.tasks + b.reports - (a.photos + a.tasks + a.reports);
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
    supabaseAdmin
      .from("photos" as any)
      .select("uploaded_by, created_at")
      .eq("project_id", data.projectId),
    supabaseAdmin
      .from("tasks" as any)
      .select("created_by, created_at")
      .eq("project_id", data.projectId),
    supabaseAdmin
      .from("project_reports" as any)
      .select("created_by, created_at")
      .eq("project_id", data.projectId),
  ]);

  const counts = new Map<
    string,
    { photos: number; tasks: number; reports: number; lastAt: number }
  >();
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
    return b.photos + b.tasks + b.reports - (a.photos + a.tasks + a.reports);
  });

  return { contributors };
}
