import { getSupabaseAdmin } from "../../lib/supabase";
import type { AuthedContext } from "../../lib/user-context";
import { isMissingFunction } from "../../lib/postgrest";
import { rateLimit } from "../../lib/rate-limit";
import { ACTIVE_SUBSCRIPTION_STATUSES, PLAN_MEMBER_CAP } from "../../lib/team-plan";
import { insertNotification } from "../notifications/service";
import { sendTeamInviteEmail } from "../email/team-invite";
import { sendSignupConfirmationEmail } from "../email/signup-confirmation";
import {
  ROLE_LABEL,
  assignableRoles,
  can,
  canManageMember,
  normaliseRole,
  roleAllowedOnTier,
} from "@everlumen/shared/team-permissions";

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
// Invite a teammate by email - enforces plan cap, emails them.
// Plan itself is now Stripe-driven (see domains/billing) - never
// user-settable directly.
// ============================================================

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Mail a team invite.
 *
 * We send this ourselves. It deliberately does NOT go through
 * `auth.admin.inviteUserByEmail`, which this used to depend on entirely, because
 * GoTrue was wrong for this job in both directions:
 *
 *   ALREADY-REGISTERED ADDRESS - GoTrue refuses outright and sends nothing. Any
 *   address that had ever signed up hit this every single time, and the old code
 *   gave up there, so the invitee received nothing and the owner was left
 *   copying a raw 48-character token out of a code block. That is the "Invite
 *   link (email not sent)" box in the bug report.
 *
 *   BRAND-NEW ADDRESS - worse, and silent. GoTrue CREATES an auth user for the
 *   invited address. That account has no password, so the invitee cannot sign
 *   in; and when they follow the invite link and try to sign up,
 *   `acceptInviteSignupService` either trips its "an account already exists for
 *   this email - please sign in first" 409, or fails inside `createUser` with
 *   "already registered". Either way inviting someone who does not yet have an
 *   account created a ghost account that then blocked them from making a real
 *   one. Exactly the case a team invite exists to serve.
 *
 * `/invite/<token>` needs no GoTrue user at all: an existing user signs in and
 * accepts (`acceptInvite`), a new one sets a name and password in place
 * (`acceptInviteSignup`, which creates the account itself - unconfirmed, so the
 * ordinary confirmation mail still proves they own the inbox). One link, both
 * cases, and no dependency on the Auth Send Email hook.
 *
 * Nothing here reports whether the address was already registered: that would be
 * account enumeration by anyone who can create a team and type an address.
 */
/**
 * Who the invite is from.
 *
 * `label` is what the body copy says and keeps the old behaviour exactly -
 * name, else email, else "A teammate". `fullName` and `email` are handed on
 * separately because they end up in the From and Reply-To headers, where an
 * email address standing in for a missing name would read as a forgery rather
 * than a fallback (see `sendTeamInviteEmail`).
 */
async function loadInviter(supabaseAdmin: SupabaseAdmin, userId: string) {
  const { data: profile } = await supabaseAdmin
    .from("profiles" as any)
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();
  const fullName = ((profile as any)?.full_name as string | null) ?? null;
  const email = ((profile as any)?.email as string | null) ?? null;
  return { label: fullName || email || "A teammate", fullName, email };
}

async function sendInviteEmail(opts: {
  to: string;
  teamName: string;
  inviter: { label: string; fullName: string | null; email: string | null };
  acceptUrl: string;
  token: string;
}): Promise<{ sent: boolean; via: "resend" | null; reason: string | null }> {
  try {
    await sendTeamInviteEmail({
      to: opts.to,
      acceptUrl: opts.acceptUrl,
      teamName: opts.teamName,
      inviterName: opts.inviter.label,
      inviterFullName: opts.inviter.fullName,
      inviterEmail: opts.inviter.email,
      // Matches the 14-day expiry `inviteMemberService` stamps on the row.
      expiresInDays: 14,
    });
    return { sent: true, via: "resend", reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "send_failed";
    console.error("[teams] invite email failed", { to: opts.to, reason });
    return { sent: false, via: null, reason };
  }
}

/*
 * Per-token rate limits for the two PUBLIC invite ops (`lookupInvite`,
 * `acceptInviteSignup` - both registered with `pub()` in the RPC registry).
 *
 * Their only credential is the token, and the limiter in rpc/handle.ts is
 * keyed on the caller's IP and shared across every op, so a caller rotating
 * addresses gets an effectively unlimited budget against one invite. Keying on
 * the token instead caps how hard a single invite can be hammered no matter
 * where the requests come from - enough to make a scripted retry loop against
 * a leaked or guessed token expensive.
 */
const INVITE_LOOKUP_RATE = { limit: 30, windowMs: 60_000 };
const INVITE_SIGNUP_RATE = { limit: 5, windowMs: 15 * 60_000 };
const INVITE_CONFIRM_RATE = { limit: 4, windowMs: 15 * 60_000 };

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
 * it several awaits later - so two concurrent requests carrying the same token
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

/**
 * Whether each member has actually confirmed their email.
 *
 * An invitee who accepts through `acceptInviteSignup` gets an account that is
 * deliberately created unconfirmed (see the SECURITY note there), joins the
 * team immediately, and then cannot sign in until they click the confirmation
 * mail. The team list shows that, and ProjectTasks refuses to assign work to
 * them - so an owner whose new hire never got the mail can see why.
 *
 * This used to be one `auth.admin.getUserById` per member, justified in a
 * comment as "a page that loads once". It is not: AppSidebar calls getMyTeam on
 * every mount, making it 39% of all API traffic, and each call paid N HTTPS
 * round trips to GoTrue. `email_confirmed_for_users` answers the same question
 * for a whole team in one query.
 *
 * The per-member path is kept as a fallback because SQL here is applied by
 * hand, so this code ships before the function exists.
 *
 * A member missing from the map is "unknown", NOT "unconfirmed". Accusing a
 * working account of being stuck would block assigning work to someone who can
 * sign in perfectly well, so an id we could not resolve is left out and the
 * caller renders it as null.
 */
async function loadEmailConfirmed(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
): Promise<Map<string, boolean>> {
  const confirmed = new Map<string, boolean>();
  if (!userIds.length) return confirmed;

  const { data, error } = await (supabaseAdmin as any).rpc("email_confirmed_for_users", {
    user_ids: userIds,
  });
  if (!error) {
    for (const row of ((data as any[]) ?? []) as Array<{
      user_id: string;
      email_confirmed: boolean | null;
    }>) {
      if (typeof row.email_confirmed === "boolean") confirmed.set(row.user_id, row.email_confirmed);
    }
    return confirmed;
  }
  if (!isMissingFunction(error)) {
    // Not fatal: the team list is still worth rendering without this column.
    console.error("[teams] email_confirmed_for_users failed", error.message);
    return confirmed;
  }

  await Promise.all(
    userIds.map(async (id: string) => {
      try {
        const { data: user } = await supabaseAdmin.auth.admin.getUserById(id);
        confirmed.set(id, !!(user?.user as any)?.email_confirmed_at);
      } catch {
        // See the "unknown is not unconfirmed" note above.
      }
    }),
  );
  return confirmed;
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

  /*
   * Profiles and confirmation state together, not one after the other.
   *
   * Both depend only on `userIds`, so running them in sequence added a whole
   * round trip to the most-called operation in the product for no reason.
   */
  const [profilesResult, confirmed] = await Promise.all([
    userIds.length
      ? supabaseAdmin
          .from("profiles" as any)
          .select("id, email, full_name, avatar_url")
          .in("id", userIds)
      : Promise.resolve({ data: [] as any[] }),
    loadEmailConfirmed(supabaseAdmin, userIds),
  ]);

  const profiles: Record<
    string,
    { email: string | null; full_name: string | null; avatar_url: string | null }
  > = Object.fromEntries(((profilesResult.data as any[]) ?? []).map((p: any) => [p.id, p]));

  const members = (membersRes.data ?? []).map((m: any) => ({
    ...m,
    profile: profiles[m.user_id] ?? null,
    emailConfirmed: confirmed.has(m.user_id) ? confirmed.get(m.user_id)! : null,
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
    // Same rule as getCallerTeamPlan - this is what `useSubscription` on the
    // web reads, so the two must agree or the UI hides what the server serves.
    isActive: isInternal || ACTIVE_SUBSCRIPTION_STATUSES.has(team?.subscription_status as string),
    // Every plan shares the project record now, including Starter - small
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

// ============================================================
// The business profile: what trade this company is in, how big
// they are, what they came here to fix.
// ============================================================

/**
 * Save the answers from the account setup wizard.
 *
 * Creates the team if the caller has none. That is not a convenience: a trial
 * account has no team until somebody visits Teams or Pricing, so for most
 * people the first time we ask "what is your company called" IS the setup
 * wizard, and making them create a team first to answer a question about their
 * company would be the same friction moved one screen earlier.
 *
 * Two shapes of caller, one op:
 *
 *   * no team yet    - create it from `companyName`, caller becomes owner, then
 *                      write the profile onto it;
 *   * owner or admin - update in place.
 *
 * A plain member is refused. The profile is company-wide, and a crew member
 * changing the company's industry from their phone would silently re-order the
 * template library for everyone they work with.
 *
 * `teams` is service-role-only (20260811002000), so every write here goes
 * through the admin client by necessity. That makes the ownership check above
 * the only thing standing between a member and the row - it is load-bearing,
 * not defensive.
 *
 * Every field is optional and only what is present is written, so the wizard's
 * steps can save as they go and a skipped step leaves what was already there
 * alone rather than blanking it.
 */
export async function saveCompanyProfileService(ctx: AuthedContext, data: any) {
  const { userId } = ctx;
  const supabaseAdmin = getSupabaseAdmin();

  const { data: membership } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", userId)
    .maybeSingle();

  let teamId: string | null = (membership as any)?.team_id ?? null;

  if (!teamId) {
    const name = String(data.companyName ?? "").trim();
    if (!name) throw new Error("Tell us your company name to finish setting up.");

    const { data: team, error: teamErr } = await supabaseAdmin
      .from("teams" as any)
      .insert({ name, owner_id: userId, plan: "starter" })
      .select("id")
      .single();
    if (teamErr || !team) throw new Error(teamErr?.message ?? "Failed to create your company");
    teamId = (team as any).id as string;

    const { error: memErr } = await supabaseAdmin
      .from("team_members" as any)
      .insert({ team_id: teamId, user_id: userId, role: "owner" });
    if (memErr) throw new Error(memErr.message);
  } else {
    const role = (membership as any).role;
    if (role !== "owner" && role !== "admin") {
      throw new Error("Only owners and admins can change the company profile.");
    }
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof data.companyName === "string" && data.companyName.trim()) {
    patch.name = data.companyName.trim();
  }
  for (const key of [
    "industry",
    "team_size",
    "project_volume",
    "heard_from",
    "service_area",
  ] as const) {
    // `null` is a real answer here - it is how "actually, don't record that"
    // gets back out of the row - so only `undefined` means "not in this save".
    if (data[key] !== undefined) patch[key] = data[key];
  }
  for (const key of ["trades", "goals"] as const) {
    if (data[key] !== undefined) patch[key] = data[key] ?? [];
  }

  /*
   * Stamped on the server, from the answers, rather than sent by the client.
   * The wizard's last step and the Settings form both save through here, so a
   * profile filled in from Settings counts as done and the dashboard card
   * stops asking - which is what someone who just filled it in expects.
   *
   * Only ever set, never cleared: emptying a field later does not make the
   * account un-set-up, and re-showing the "finish setting up" card to someone
   * who did would read as the save having failed.
   */
  const { data: current } = await supabaseAdmin
    .from("teams" as any)
    .select("industry, team_size, profile_completed_at")
    .eq("id", teamId)
    .maybeSingle();

  const industry = patch.industry !== undefined ? patch.industry : (current as any)?.industry;
  const teamSize = patch.team_size !== undefined ? patch.team_size : (current as any)?.team_size;
  if (industry && teamSize && !(current as any)?.profile_completed_at) {
    patch.profile_completed_at = new Date().toISOString();
  }

  const { data: team, error } = await supabaseAdmin
    .from("teams" as any)
    .update(patch)
    .eq("id", teamId)
    .select("*")
    .single();
  if (error) throw new Error(error.message);

  return { team };
}

/**
 * Stop the dashboard asking this person to finish setting up.
 *
 * Per user, not per team: two admins on the same account get their own answer
 * to "not now", because one of them dismissing a banner is not a decision they
 * made on the other's behalf.
 *
 * Stored rather than kept in localStorage so it survives the phone-then-laptop
 * pattern that is most of how this product is used. A dismissal that only
 * holds on the device it happened on is a card that comes back every time they
 * pick up the other device.
 */
export async function dismissSetupPromptService(ctx: AuthedContext) {
  const { supabase, userId } = ctx;
  const { error } = await supabase
    .from("profiles" as any)
    .update({ setup_prompt_dismissed_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  return { dismissed: true };
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
   * one row matches, and this destructured only `data` - so the moment a race
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
    const inviter = await loadInviter(supabaseAdmin, userId);
    const origin = data.origin?.replace(/\/+$/, "") || "https://everlumen.co";
    const emailRes = await sendInviteEmail({
      to: email,
      teamName: (team as any).name,
      inviter,
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
    // Two different walls wearing the same number. `cap` is normally the seat
    // count this team actually bought, and the fix is to buy another one. At
    // PLAN_MEMBER_CAP it is the tier's own ceiling instead, and there is no
    // larger plan to sell them - telling a 50-user Team to "upgrade" points at
    // nothing. That is the Enterprise conversation.
    if (cap >= PLAN_MEMBER_CAP[plan]) {
      throw new Error(
        `${PLAN_MEMBER_CAP[plan]} users is the most a self-serve plan holds. ` +
          `Contact support about Enterprise access for a larger crew.`,
      );
    }
    throw new Error(
      `Your team is using all ${cap} of its seats. Add a seat from Settings, or remove a member.`,
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
  const inviter = await loadInviter(supabaseAdmin, userId);
  const origin = data.origin?.replace(/\/+$/, "") || "https://everlumen.co";
  const acceptUrl = `${origin}/invite/${token}`;

  const emailRes = await sendInviteEmail({
    to: email,
    teamName: (team as any).name,
    inviter,
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

  /*
   * Who may re-role whom - the matrix, not "owner only".
   *
   * This used to be a flat `team.owner_id !== userId`, which contradicted
   * section 4 in two directions at once: an Admin has `manage_users` and could
   * not use it, and a Manager's whole reason to exist ("promote a Standard user
   * over their own crew") was unreachable. `canManageMember` is the single
   * definition of that question and was already tested; it just was not called.
   *
   * It also keeps the guarantee the old line accidentally provided: the owner
   * row is immune to everyone, so a workspace can never end up with nobody who
   * can pay the bill.
   */
  const { data: caller } = await supabaseAdmin
    .from("team_members" as any)
    .select("role, team_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (!caller || (caller as any).team_id !== (target as any).team_id) {
    throw Object.assign(new Error("Member not found"), { status: 404 });
  }
  if (!canManageMember((caller as any).role, (target as any).role)) {
    throw Object.assign(
      new Error(
        `A ${ROLE_LABEL[normaliseRole((caller as any).role)]} cannot change that member's role.`,
      ),
      { status: 403 },
    );
  }

  /*
   * The role must be one this tier can actually hold.
   *
   * `assignableRoles()` is what the picker renders from, but the RPC is
   * reachable with a hand-made request, so a Starter account could otherwise
   * post `manager` and hold a role it never paid for. Same list, same source
   * (packages/shared/src/team-permissions.ts), checked on both sides.
   */
  const requested = normaliseRole(data.role);
  // Ownership moves by transfer, never by re-roling somebody into it. The zod
  // enum already omits `owner`, so this is unreachable through the RPC - it is
  // here because `AssignableRole` below requires it to be, and a guarantee the
  // compiler checks outlasts a schema somebody widens later.
  if (requested === "owner") {
    throw Object.assign(new Error("Ownership is transferred, not assigned."), { status: 400 });
  }

  const tier = await callerTierForTeam(supabaseAdmin, (target as any).team_id);
  if (!roleAllowedOnTier(requested, tier)) {
    throw Object.assign(
      new Error(`The ${ROLE_LABEL[requested]} role is not available on your current plan.`),
      { status: 403 },
    );
  }
  /*
   * Restricted is refused until the caller can actually scope them.
   *
   * `assignmentsEnforced` is true now that project_assignments and its RLS
   * exist (20260911000000). Before that migration the role would have granted
   * a full view rather than a narrow one - the failure mode this flag was
   * added to make impossible.
   */
  if (!assignableRoles(tier, { assignmentsEnforced: true }).includes(requested)) {
    throw Object.assign(new Error("That role cannot be assigned."), { status: 400 });
  }

  /*
   * `.select()` so the update has to prove it changed something.
   *
   * Without it this op could answer 200 having done nothing at all, and that is
   * not hypothetical: driving the phone against the deployed API, a role change
   * returned HTTP 200 with no error, wrote an audit row, and left the member's
   * role exactly as it was. The roster then refetched and redrew the OLD role,
   * so the screen looked like it had simply ignored the tap. An admin trying to
   * restrict somebody's access would have every reason to believe they had.
   *
   * PostgREST does not treat "matched no rows" as an error on UPDATE, so a
   * filter that finds nothing is indistinguishable from a write that worked.
   * Asking for the row back is what makes the difference visible: `updated` is
   * empty exactly when nothing was written, whatever the reason - a stale id, a
   * row that moved team, or a client that is not the service role and is being
   * filtered by RLS it cannot see.
   */
  const { data: updated, error } = await supabaseAdmin
    .from("team_members" as any)
    .update({ role: data.role })
    .eq("id", data.memberId)
    .select("id, role");
  if (error) throw new Error(error.message);
  if (!updated || (updated as unknown[]).length === 0) {
    throw Object.assign(
      new Error("That role change did not save. Reload the team and try again."),
      { status: 409 },
    );
  }

  /*
   * The assignments are KEPT across a role change. This used to wipe them.
   *
   * When the only writer was the Restricted scoping picker, a row here meant
   * one thing - a fence - and a fence left behind on somebody who is no longer
   * Restricted is stale state waiting to become live again if they are ever put
   * back. Clearing it was right for that meaning.
   *
   * The rows mean something else now as well. The projects list and the project
   * page write them to say who is on a job, for every role, so the same table
   * is a crew list; wiping it on a role change would quietly take a person off
   * every job they are staffed on, in response to an action ("make them a
   * Manager") that says nothing about staffing. That is data loss the admin did
   * not ask for and cannot see.
   *
   * The old risk is real and is handled where it belongs: an admin who puts
   * somebody back onto Restricted gets "Choose their jobs" in the same menu,
   * showing exactly which jobs are about to become that person's whole
   * workspace, before they are anyone's fence again.
   *
   * `scopedProjectCount` is what makes that visible rather than merely
   * available. Moving somebody TO Restricted turns whatever crew rows they
   * already had into their entire view of the workspace, so the number comes
   * back with the result and the roster says it out loud in the same breath as
   * "Set as Restricted". A silent inheritance is the thing worth avoiding here,
   * not the inheritance itself.
   */
  let scopedProjectCount: number | null = null;
  if (requested === "restricted") {
    const { data: memberRow } = await supabaseAdmin
      .from("team_members" as any)
      .select("user_id")
      .eq("id", data.memberId)
      .maybeSingle();
    if (memberRow) {
      const { count } = await supabaseAdmin
        .from("project_assignments" as any)
        .select("id", { count: "exact", head: true })
        .eq("user_id", (memberRow as any).user_id);
      scopedProjectCount = count ?? 0;
    }
  }

  return { ok: true, scopedProjectCount };
}

/** The billing tier a team is actually on, for role gating. */
async function callerTierForTeam(
  supabaseAdmin: SupabaseAdmin,
  teamId: string,
): Promise<"starter" | "pro" | "team"> {
  const { data: team } = await supabaseAdmin
    .from("teams" as any)
    .select("plan, subscription_status, is_internal")
    .eq("id", teamId)
    .maybeSingle();
  if ((team as any)?.is_internal) return "team";
  const active = ACTIVE_SUBSCRIPTION_STATUSES.has((team as any)?.subscription_status);
  const plan = (team as any)?.plan;
  if (!active) return "starter";
  return plan === "pro" || plan === "team" ? plan : "starter";
}

/**
 * Which jobs a Restricted member may reach.
 *
 * Owner/admin only, and the projects must be the team's own - the assignment
 * table has no team column, so without this check an admin could scope one of
 * their people onto another company's job by pasting its id.
 */
export async function setMemberProjectsService(ctx: AuthedContext, data: any) {
  const { userId } = ctx;
  const supabaseAdmin = getSupabaseAdmin();

  const { data: caller } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!caller) throw Object.assign(new Error("Create a team first."), { status: 403 });
  if (!can((caller as any).role, "manage_users")) {
    throw Object.assign(new Error("Only owners and admins can assign jobs."), { status: 403 });
  }
  const teamId = (caller as any).team_id;

  const { data: target } = await supabaseAdmin
    .from("team_members" as any)
    .select("id, team_id, user_id, role")
    .eq("id", data.memberId)
    .maybeSingle();
  if (!target || (target as any).team_id !== teamId) throw new Error("Member not found");

  // Assigning jobs to anyone else is a no-op with a misleading UI: every other
  // role already reaches every project through `are_teammates`.
  if (normaliseRole((target as any).role) !== "restricted") {
    throw new Error("Only Restricted members are scoped to specific jobs.");
  }

  const projectIds: string[] = Array.from(new Set(data.projectIds ?? []));
  if (projectIds.length) {
    const { data: members } = await supabaseAdmin
      .from("team_members" as any)
      .select("user_id")
      .eq("team_id", teamId);
    const memberIds = (members ?? []).map((m: any) => m.user_id);
    const { data: rows } = await supabaseAdmin
      .from("projects" as any)
      .select("id")
      .in("id", projectIds)
      .in("created_by", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
    const found = new Set((rows ?? []).map((r: any) => r.id));
    if (projectIds.some((id) => !found.has(id))) {
      throw Object.assign(new Error("That project is not part of your team."), { status: 403 });
    }
  }

  await supabaseAdmin
    .from("project_assignments" as any)
    .delete()
    .eq("user_id", (target as any).user_id);
  if (projectIds.length) {
    const { error } = await supabaseAdmin.from("project_assignments" as any).insert(
      projectIds.map((project_id) => ({
        project_id,
        user_id: (target as any).user_id,
        assigned_by: userId,
      })),
    );
    if (error) throw new Error(error.message);
  }

  return { ok: true, projectCount: projectIds.length };
}

/** The jobs a Restricted member currently holds, for the assignment dialog. */
export async function getMemberProjectsService(ctx: AuthedContext, data: any) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: caller } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!caller || !can((caller as any).role, "manage_users")) {
    throw Object.assign(new Error("Not allowed."), { status: 403 });
  }

  const { data: target } = await supabaseAdmin
    .from("team_members" as any)
    .select("user_id, team_id")
    .eq("id", data.memberId)
    .maybeSingle();
  if (!target || (target as any).team_id !== (caller as any).team_id) {
    throw new Error("Member not found");
  }

  const { data: rows } = await supabaseAdmin
    .from("project_assignments" as any)
    .select("project_id")
    .eq("user_id", (target as any).user_id);

  return { projectIds: (rows ?? []).map((r: any) => r.project_id as string) };
}

/*
 * ===========================================================================
 * THE SAME TABLE, READ FROM THE OTHER END
 * ===========================================================================
 * `setMemberProjects` answers "which jobs is this person on?" and is reached
 * from the roster. These two answer "who is on this job?" and are reached from
 * the projects list and the project itself, which is where the question is
 * actually asked - nobody opens Team Settings to staff a job they are looking
 * at.
 *
 * One table, `project_assignments`, so the two views can never disagree. What
 * an assignment MEANS still depends on the role at the other end of it, and
 * that distinction is the whole Pro/Team line:
 *
 *   every role except Restricted - the crew list. Who is on this job. It grants
 *     nothing, because they already reach every project through
 *     `are_teammates()`. This is what Pro has, on every plan.
 *   Restricted - the crew list AND the fence. `member_can_reach_project()`
 *     consults exactly these rows, so ticking a box here is what lets them in.
 *     Restricted is Team-only (`MIN_TIER` in team-permissions.ts).
 *
 * So the control is the same everywhere and honest on both plans: on Pro it
 * staffs a job, on Team it staffs a job and, for one role, scopes a person.
 */

/** Who may staff a job. Company-wide user management, or a Manager's own crew. */
function mayAssignCrew(role: unknown): boolean {
  return can(role as string, "manage_users") || can(role as string, "manage_own_crew");
}

/**
 * The team's own projects, as a set, for validating ids the browser sent.
 *
 * `project_assignments` has no team column - it points at a project and a user
 * - so "is this project ours?" has to be asked of `projects.created_by` against
 * the roster. Without it, an admin could paste another company's project id and
 * quietly attach one of their people to it.
 */
async function teamProjectIds(
  supabaseAdmin: SupabaseAdmin,
  teamId: string,
  projectIds: string[],
): Promise<Set<string>> {
  if (!projectIds.length) return new Set();
  const { data: members } = await supabaseAdmin
    .from("team_members" as any)
    .select("user_id")
    .eq("team_id", teamId);
  const memberIds = (members ?? []).map((m: any) => m.user_id);
  const { data: rows } = await supabaseAdmin
    .from("projects" as any)
    .select("id")
    .in("id", projectIds)
    .in("created_by", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
  return new Set((rows ?? []).map((r: any) => r.id as string));
}

/**
 * Who is assigned to each of these jobs.
 *
 * Takes a list rather than one id because the projects page renders a grid: one
 * request per card would be sixty requests to draw sixty avatar stacks. The
 * project page passes a single id and pays for exactly that.
 *
 * Returns `canAssign` alongside the data so the caller does not have to
 * re-derive the server's own answer from the roster and get it subtly wrong -
 * the button appears if and only if the write would be accepted.
 */
export async function getProjectAssigneesService(ctx: AuthedContext, data: any) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: caller } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  // A solo account has no team row. That is not an error, it is an empty crew.
  if (!caller) return { byProject: {} as Record<string, string[]>, canAssign: false };

  /*
   * Filtered through the CALLER's client, not the admin one.
   *
   * `setProjectAssignees` proves team ownership with the service role because
   * it has to reject a pasted id from another company. Reading is a different
   * question: a Restricted member is on this team and is deliberately fenced to
   * a few of its jobs, so answering "who is on job X" for a job they cannot
   * open would hand back the one thing their role exists to withhold. RLS
   * already knows exactly which projects each viewer may see, so the read asks
   * it rather than re-deciding.
   */
  const requested: string[] = Array.from(new Set(data.projectIds ?? []));
  let ids: string[] = [];
  if (requested.length) {
    const { data: visible } = await ctx.supabase.from("projects").select("id").in("id", requested);
    ids = ((visible ?? []) as any[]).map((r) => r.id as string);
  }

  const byProject: Record<string, string[]> = {};
  for (const id of ids) byProject[id] = [];
  if (ids.length) {
    const { data: rows } = await supabaseAdmin
      .from("project_assignments" as any)
      .select("project_id, user_id")
      .in("project_id", ids);
    for (const r of (rows ?? []) as any[]) {
      (byProject[r.project_id] ??= []).push(r.user_id as string);
    }
  }

  return { byProject, canAssign: mayAssignCrew((caller as any).role) };
}

/**
 * Replace the crew on one job.
 *
 * Whole-set rather than add/remove because the dialog is a list of tickboxes
 * and that is what it holds: sending the ticked set makes an untick a real
 * instruction instead of something the client has to remember to send as a
 * second call. Empty is legitimate - it is how a job is unstaffed.
 */
export async function setProjectAssigneesService(ctx: AuthedContext, data: any) {
  const { userId } = ctx;
  const supabaseAdmin = getSupabaseAdmin();

  const { data: caller } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!caller) throw Object.assign(new Error("Create a team first."), { status: 403 });
  if (!mayAssignCrew((caller as any).role)) {
    throw Object.assign(
      new Error(
        `A ${ROLE_LABEL[normaliseRole((caller as any).role)]} cannot change who is on a job.`,
      ),
      { status: 403 },
    );
  }
  const teamId = (caller as any).team_id as string;

  const ours = await teamProjectIds(supabaseAdmin, teamId, [data.projectId]);
  if (!ours.has(data.projectId)) {
    throw Object.assign(new Error("That project is not part of your team."), { status: 403 });
  }

  /*
   * Every id must be a teammate. Checked against `team_members` rather than
   * against `auth.users`, so a stale id - somebody who has left - is refused
   * instead of resurrecting an assignment nothing else would ever clear.
   */
  const userIds: string[] = Array.from(new Set(data.userIds ?? []));
  if (userIds.length) {
    const { data: rows } = await supabaseAdmin
      .from("team_members" as any)
      .select("user_id")
      .eq("team_id", teamId)
      .in("user_id", userIds);
    const found = new Set((rows ?? []).map((r: any) => r.user_id as string));
    const stranger = userIds.find((id) => !found.has(id));
    if (stranger) {
      throw Object.assign(new Error("That person is not on your team."), { status: 403 });
    }
  }

  const { data: existingRows } = await supabaseAdmin
    .from("project_assignments" as any)
    .select("user_id")
    .eq("project_id", data.projectId);
  const existing = new Set((existingRows ?? []).map((r: any) => r.user_id as string));

  await supabaseAdmin
    .from("project_assignments" as any)
    .delete()
    .eq("project_id", data.projectId);
  if (userIds.length) {
    const { error } = await supabaseAdmin.from("project_assignments" as any).insert(
      userIds.map((user_id) => ({
        project_id: data.projectId,
        user_id,
        assigned_by: userId,
      })),
    );
    if (error) throw new Error(error.message);
  }

  /*
   * Tell the people who were just added, and only them.
   *
   * Re-saving the dialog without changing anything must not re-notify the whole
   * crew, which is why this diffs against what was already there rather than
   * notifying everyone in `userIds`. `insertNotification` drops the actor's own
   * row, so assigning yourself stays silent.
   */
  const { data: proj } = await supabaseAdmin
    .from("projects" as any)
    .select("name")
    .eq("id", data.projectId)
    .maybeSingle();
  const projectName = ((proj as any)?.name as string) || "a project";
  await Promise.all(
    userIds
      .filter((id) => !existing.has(id))
      .map((recipientId) =>
        insertNotification(supabaseAdmin as any, {
          recipientId,
          actorId: userId,
          type: "project_assigned",
          title: `You were added to ${projectName}`,
          body: "Open the project to see the photos, tasks and documents on it.",
          linkPath: `/projects/${data.projectId}`,
          projectId: data.projectId,
          entityType: "project",
          entityId: data.projectId,
        }),
      ),
  );

  return { ok: true, count: userIds.length };
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
  if (!invite) return { invite: null, team: null, tier: "starter" as const };
  const { data: team } = await supabaseAdmin
    .from("teams" as any)
    .select("id, name")
    .eq("id", (invite as any).team_id)
    .single();
  /*
   * The tier comes back so the invite page can name the seat the way this team
   * names it: Team runs a hierarchy and calls the base seat Standard, flatter
   * plans call it Member. Without it that page printed the raw `role` column
   * under a CSS capitalize, so it said "Member" to somebody joining a Team
   * workspace where every other screen will say Standard.
   *
   * Deliberately the only thing added. This endpoint is public - it is reached
   * before the invitee has an account - so it stays limited to what the person
   * holding a valid, unexpired, single-use token needs in order to decide
   * whether to accept: the team's name, and what they are being offered.
   */
  const tier = await callerTierForTeam(supabaseAdmin, (invite as any).team_id);
  return { invite, team, tier };
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
   * over-cap count and both roll back - which errs toward refusing a seat
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
     * SECURITY - never modify an account that already exists.
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
     * invite an address - which is any signed-up user, since `createTeam`
     * is ungated and the only restriction is that the target isn't already
     * on a team - could read the token out of their own response, POST it
     * here with a password of their choosing, and take over that account
     * along with every project, photo, report and share link on it. The
     * victim received no notification, because the "joined your team"
     * notification is sent to the inviter.
     *
     * Signing up is only ever for an address with no account. An existing
     * user joins through the authenticated `acceptInvite` op, which proves
     * they control the address by making them log in first.
     */
    /*
     * The "reset your password" half matters for anyone caught by the old
     * invite path: `inviteUserByEmail` created a passwordless auth user for
     * every brand-new invitee, so they land here unable to sign in to an
     * account they never knowingly made. A reset is the way out, and they do
     * own the inbox. New invites no longer create that account at all.
     */
    throw Object.assign(
      new Error(
        "An account already exists for this email. Sign in first, then open this invite link again. If you've never set a password, use “Forgot password” to set one.",
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
   * created an account. `claimInvite` is the guard - one winner, everyone else
   * gets null. Any failure below releases the claim so a legitimate invitee
   * isn't left with a burned link.
   */
  const claimed = await claimInvite(supabaseAdmin, data.token, null);
  if (!claimed) throw new Error("This invite has already been used.");

  try {
    /*
     * SECURITY - do NOT pre-confirm this address.
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
     * then buys a squatted, unusable login rather than a live account - and the
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

      // Confirm the seat after taking it - same check-then-act race as
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
     * link - which needs the invite to still be open. So release it.
     */
    await releaseInviteClaim(supabaseAdmin, (claimed as any).id);
    throw err;
  }

  // Record who spent the token (claimInvite has no user id to write yet).
  await supabaseAdmin
    .from("team_invites" as any)
    .update({ accepted_by: userId })
    .eq("id", (claimed as any).id);

  const origin = data.origin?.replace(/\/+$/, "") || "https://everlumen.co";
  /*
   * The password goes with it so the link can be minted as a `signup`
   * confirmation rather than a magic link - see `sendSignupConfirmationEmail`.
   * It is the password this request just created the account with, so nothing
   * is being changed or revealed; GoTrue only needs it because
   * `generateLink({ type: "signup" })` takes one.
   */
  const confirmRes = await sendSignupConfirmationEmail(inviteEmail, origin, {
    password: data.password,
  });

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
  // signInWithPassword to succeed yet - same state /signup reaches when
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

  const inviter = await loadInviter(supabaseAdmin, userId);

  const origin = data.origin?.replace(/\/+$/, "") || "https://everlumen.co";
  const emailRes = await sendInviteEmail({
    to: (invite as any).email,
    teamName: (team as any).name,
    inviter,
    acceptUrl: `${origin}/invite/${(invite as any).token}`,
    token: (invite as any).token,
  });

  return { ok: true, emailSent: emailRes.sent, emailVia: emailRes.via };
}

/**
 * Send the signup confirmation again to a member who never confirmed.
 *
 * `resendInviteService` cannot help these people: their invite is spent, so it
 * throws "already accepted". What they are missing is the GoTrue confirmation
 * mail, and nothing in the product could ask for it again - the account sat
 * unconfirmed and unusable with the owner unable to do anything but guess.
 *
 * Owner or admin of that member's own team only, and refuses on an account that
 * is already confirmed so this cannot be used to mail an arbitrary teammate.
 */
export async function resendMemberConfirmationService(
  ctx: AuthedContext,
  data: { memberId: string; origin?: string },
) {
  const { userId } = ctx;
  const supabaseAdmin = getSupabaseAdmin();

  /*
   * Statuses on the throws, unlike the older ops in this file which let a bare
   * Error surface as a 500. A refusal is not a server fault, and reading it as
   * one turns every denied click into noise in whatever watches for 5xx.
   */
  const forbidden = () => Object.assign(new Error("Forbidden"), { status: 403 });

  const { data: caller } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", userId)
    .maybeSingle();
  if (!caller) throw forbidden();
  if ((caller as any).role !== "owner" && (caller as any).role !== "admin") throw forbidden();

  const { data: member } = await supabaseAdmin
    .from("team_members" as any)
    .select("id, team_id, user_id")
    .eq("id", data.memberId)
    .maybeSingle();
  if (!member) throw Object.assign(new Error("Member not found"), { status: 404 });
  // Same 403 as a role failure: which teams exist is not this caller's business.
  if ((member as any).team_id !== (caller as any).team_id) throw forbidden();

  const { data: target } = await supabaseAdmin.auth.admin.getUserById(
    (member as any).user_id as string,
  );
  const email = (target?.user as any)?.email as string | undefined;
  if (!email)
    throw Object.assign(new Error("That member has no email address on file."), { status: 422 });
  if ((target?.user as any)?.email_confirmed_at) {
    return { ok: true, alreadyConfirmed: true, emailSent: false };
  }

  const origin = data.origin?.replace(/\/+$/, "") || "https://everlumen.co";
  const res = await sendSignupConfirmationEmail(email, origin);
  return { ok: true, alreadyConfirmed: false, emailSent: res.sent };
}

/**
 * Send the signup confirmation again, asked for by the INVITEE rather than the
 * owner. Public: the invite token is the credential, exactly as it is for
 * `acceptInviteSignup`.
 *
 * Somebody who accepts an invite and never receives the confirmation is the
 * one person in this flow who cannot help themselves. Their account exists but
 * is inert, so they cannot sign in to ask for anything; `resendInvite` refuses
 * them because their invite is spent; and `resendMemberConfirmation` needs an
 * owner or admin to notice and press a button on a page the invitee cannot
 * see. That is how a new hire stays "added" for a week.
 *
 * It is safe to leave unauthenticated because of what it cannot do. The only
 * address it will ever mail is the one the invite was issued to, and it
 * refuses unless the account that spent this token still owns that address, so
 * a leaked token cannot redirect the mail anywhere. It carries no reply: the
 * result says only whether a message went out. And it is rate limited per
 * token, so the token cannot be used to pump mail at its own owner.
 */
export async function resendInviteConfirmationService(data: { token: string; origin?: string }) {
  const supabaseAdmin = getSupabaseAdmin();

  limitInviteOp("confirm", data.token, INVITE_CONFIRM_RATE);

  const { data: invite } = await supabaseAdmin
    .from("team_invites" as any)
    .select("email, accepted_at, accepted_by")
    .eq("token", data.token)
    .maybeSingle();
  if (!invite) throw new Error("Invite not found.");

  const email = String((invite as any).email ?? "").toLowerCase();
  const acceptedBy = (invite as any).accepted_by as string | null;
  /*
   * Only for an invite that was actually spent on a new account. An open
   * invite has no account to confirm - what that person needs is the invite
   * email, which is `resendInvite`.
   */
  if (!(invite as any).accepted_at || !acceptedBy) {
    throw new Error("This invite has not been accepted yet.");
  }

  const { data: target } = await supabaseAdmin.auth.admin.getUserById(acceptedBy);
  const account = target?.user as any;
  if (!account) throw new Error("That account no longer exists.");
  /*
   * The account must still hold the invited address. Without this an account
   * that later changed its email would have mail about it sent to an address
   * it no longer owns, and the check is what makes the whole op safe to leave
   * public: the recipient is pinned to the invite, not to anything the caller
   * supplies.
   */
  if (String(account.email ?? "").toLowerCase() !== email) {
    throw Object.assign(new Error("This invite is no longer available."), { status: 403 });
  }
  if (account.email_confirmed_at) {
    return { ok: true, alreadyConfirmed: true, emailSent: false };
  }

  const origin = data.origin?.replace(/\/+$/, "") || "https://everlumen.co";
  const res = await sendSignupConfirmationEmail(email, origin);
  return { ok: true, alreadyConfirmed: false, emailSent: res.sent };
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
