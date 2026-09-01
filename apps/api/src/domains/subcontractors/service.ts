import { getSupabaseAdmin } from "../../lib/supabase";
import { sendSignupConfirmationEmail } from "../email/signup-confirmation";
import { rateLimit } from "../../lib/rate-limit";
import { getCallerTeamPlan } from "../../lib/team-plan";
import { sendTeamInviteEmail } from "../email/team-invite";
import type { AuthedContext } from "../../lib/user-context";

/**
 * Subcontractor access - Team tier.
 *
 * An outside firm gets a real login scoped to named projects, and does NOT
 * occupy a paid seat. The seat exemption is not a rule enforced here; it is a
 * consequence of where the rows live. `effectiveMemberLimit` in
 * domains/teams/service.ts counts `team_members`, and nothing in this file ever
 * writes to that table. A subcontractor is invisible to the seat count by
 * construction, which is the only way it stays true when somebody later edits
 * one of these two files without reading the other.
 *
 * What they can actually reach is decided by RLS, not by this service - see
 * `subcontractor_can_reach_project()` in
 * supabase/migrations/20260910000000_subcontractor_access.sql. The functions
 * below manage grants; the database enforces them.
 */

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

/** Same shape and budget as the team-invite limiters this mirrors. */
const LOOKUP_RATE = { limit: 30, windowMs: 60_000 };
const SIGNUP_RATE = { limit: 5, windowMs: 15 * 60_000 };

function limitByToken(scope: string, token: string, rate: { limit: number; windowMs: number }) {
  const rl = rateLimit({ key: `subcontractor:${scope}:${token}`, ...rate });
  if (!rl.ok) {
    throw Object.assign(
      new Error("Too many attempts on this invite. Please try again in a few minutes."),
      { status: 429 },
    );
  }
}

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function forbidden(message: string) {
  return Object.assign(new Error(message), { status: 403 });
}

/**
 * Caller must be an owner/admin of a team on the Team plan.
 *
 * Both halves matter and they fail differently: the wrong role is a 403 the
 * user can do nothing about, while the wrong plan is a sales message. Saying
 * "requires the Team plan" to a Standard user would send them to buy something
 * they already have.
 */
async function requireTeamAdmin(ctx: AuthedContext) {
  const supabaseAdmin = getSupabaseAdmin();
  const { data: membership } = await supabaseAdmin
    .from("team_members" as any)
    .select("team_id, role")
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!membership) throw forbidden("Create a team first.");

  const role = (membership as any).role;
  if (role !== "owner" && role !== "admin") {
    throw forbidden("Only owners and admins can manage subcontractors.");
  }

  const plan = await getCallerTeamPlan(ctx.supabase, ctx.userId);
  if (!plan.isTeam) {
    throw forbidden("Subcontractor access requires the Team plan.");
  }

  return { supabaseAdmin, teamId: (membership as any).team_id as string };
}

/**
 * Every project id must belong to the caller's team.
 *
 * Without this the RPC accepts any uuid, and an admin could grant an outside
 * firm access to another company's job by pasting its id - the assignment table
 * has no idea which team a project belongs to, and the RLS on `projects` is
 * evaluated for the *subcontractor*, who would then legitimately pass it.
 */
async function assertProjectsBelongToTeam(
  supabaseAdmin: SupabaseAdmin,
  teamId: string,
  projectIds: string[],
) {
  if (projectIds.length === 0) return;

  const { data: members } = await supabaseAdmin
    .from("team_members" as any)
    .select("user_id")
    .eq("team_id", teamId);
  const memberIds = (members ?? []).map((m: any) => m.user_id);

  const { data: rows, error } = await supabaseAdmin
    .from("projects" as any)
    .select("id")
    .in("id", projectIds)
    .in("created_by", memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"]);
  if (error) throw new Error(error.message);

  const found = new Set((rows ?? []).map((r: any) => r.id));
  const stranger = projectIds.find((id) => !found.has(id));
  if (stranger) throw forbidden("That project is not part of your team.");
}

async function replaceAssignments(
  supabaseAdmin: SupabaseAdmin,
  subcontractorId: string,
  projectIds: string[],
) {
  await supabaseAdmin
    .from("subcontractor_projects" as any)
    .delete()
    .eq("subcontractor_id", subcontractorId);
  if (!projectIds.length) return;
  const { error } = await supabaseAdmin
    .from("subcontractor_projects" as any)
    .insert(projectIds.map((project_id) => ({ subcontractor_id: subcontractorId, project_id })));
  if (error) throw new Error(error.message);
}

// ============================================================
// Invite
// ============================================================

export async function inviteSubcontractorService(ctx: AuthedContext, data: any) {
  const { supabaseAdmin, teamId } = await requireTeamAdmin(ctx);

  // Normalised once, here, for the same reason team invites are: the partial
  // unique index on (team_id, email) is a plain column index, so a mixed-case
  // address would slip past it and create a second live grant.
  const email = String(data.email ?? "")
    .trim()
    .toLowerCase();
  const projectIds: string[] = Array.from(new Set(data.projectIds ?? []));
  if (!projectIds.length) {
    // A subcontractor with no project is not a lesser grant, it is a login that
    // can see nothing - which reads to the recipient as a broken invite.
    throw new Error("Choose at least one project for this subcontractor.");
  }
  await assertProjectsBelongToTeam(supabaseAdmin, teamId, projectIds);

  // Someone already on the crew must not also be a subcontractor: they would
  // hold both a seat and a scoped grant, and the scoped one would be silently
  // redundant because the teammate policies are strictly wider.
  const { data: existingProfile } = await supabaseAdmin
    .from("profiles" as any)
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    const { data: alreadyStaff } = await supabaseAdmin
      .from("team_members" as any)
      .select("team_id")
      .eq("user_id", (existingProfile as any).id)
      .eq("team_id", teamId)
      .maybeSingle();
    if (alreadyStaff) {
      throw new Error("That person is already on your team as a member.");
    }
  }

  const { data: team } = await supabaseAdmin
    .from("teams" as any)
    .select("id, name")
    .eq("id", teamId)
    .single();

  // An existing live grant is re-scoped and re-sent rather than rejected. The
  // common case is "same firm, next job", and making that an error would push
  // admins to revoke and re-invite, which churns the token for no reason.
  const { data: live } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("*")
    .eq("team_id", teamId)
    .eq("email", email)
    .is("revoked_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let row = live as any;
  if (row) {
    await replaceAssignments(supabaseAdmin, row.id, projectIds);
    if (data.companyName !== undefined) {
      await supabaseAdmin
        .from("subcontractors" as any)
        .update({ company_name: data.companyName || null })
        .eq("id", row.id);
    }
  } else {
    const { data: inserted, error } = await supabaseAdmin
      .from("subcontractors" as any)
      .insert({
        team_id: teamId,
        email,
        company_name: data.companyName || null,
        invited_by: ctx.userId,
        token: generateToken(),
      })
      .select("*")
      .single();
    if (error || !inserted) throw new Error(error?.message ?? "Could not create the invite.");
    row = inserted;
    await replaceAssignments(supabaseAdmin, row.id, projectIds);
  }

  // Already accepted: the grant was re-scoped above and takes effect
  // immediately, so a second "you've been invited" mail would be wrong.
  if (row.accepted_at) {
    return { subcontractorId: row.id, emailSent: false, alreadyActive: true };
  }

  const origin = String(data.origin ?? "").replace(/\/+$/, "") || "https://everlumen.co";
  let emailSent = true;
  try {
    await sendTeamInviteEmail({
      to: email,
      acceptUrl: `${origin}/subcontractor-invite/${row.token}`,
      teamName: (team as any)?.name,
      expiresInDays: 14,
    });
  } catch (err) {
    // Reported rather than thrown: the grant is real and the admin can resend.
    // Claiming success on a failed send is the bug tests/invariants.test.ts
    // already guards against on the team invite path.
    console.error("[subcontractors] invite email failed", err);
    emailSent = false;
  }

  return { subcontractorId: row.id, emailSent, alreadyActive: false };
}

// ============================================================
// Read / manage
// ============================================================

export async function listSubcontractorsService(ctx: AuthedContext) {
  const { supabaseAdmin, teamId } = await requireTeamAdmin(ctx);

  const { data: subs } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("id, email, company_name, user_id, accepted_at, expires_at, created_at")
    .eq("team_id", teamId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  const ids = (subs ?? []).map((s: any) => s.id);
  const { data: links } = ids.length
    ? await supabaseAdmin
        .from("subcontractor_projects" as any)
        .select("subcontractor_id, project_id, projects(id, name)")
        .in("subcontractor_id", ids)
    : { data: [] as any[] };

  const byId = new Map<string, { id: string; name: string | null }[]>();
  for (const link of (links ?? []) as any[]) {
    const list = byId.get(link.subcontractor_id) ?? [];
    list.push({ id: link.project_id, name: link.projects?.name ?? null });
    byId.set(link.subcontractor_id, list);
  }

  return {
    subcontractors: (subs ?? []).map((s: any) => ({
      ...s,
      // `pending` is the state an admin actually asks about, and it is not a
      // column: it is "invited, not yet accepted, not yet expired".
      pending: !s.accepted_at,
      expired: !s.accepted_at && new Date(s.expires_at) < new Date(),
      projects: byId.get(s.id) ?? [],
    })),
  };
}

export async function setSubcontractorProjectsService(ctx: AuthedContext, data: any) {
  const { supabaseAdmin, teamId } = await requireTeamAdmin(ctx);
  const projectIds: string[] = Array.from(new Set(data.projectIds ?? []));

  const { data: sub } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("id, team_id, revoked_at")
    .eq("id", data.subcontractorId)
    .maybeSingle();
  if (!sub || (sub as any).team_id !== teamId) throw forbidden("Subcontractor not found.");
  if ((sub as any).revoked_at) throw new Error("That subcontractor's access was revoked.");

  await assertProjectsBelongToTeam(supabaseAdmin, teamId, projectIds);
  await replaceAssignments(supabaseAdmin, (sub as any).id, projectIds);
  return { ok: true, projectCount: projectIds.length };
}

/**
 * Revoke. A soft delete, and the assignments are left in place.
 *
 * `subcontractor_can_reach_project()` requires `revoked_at IS NULL`, so access
 * stops on the very next query with no cleanup pass. Keeping the assignment
 * rows means "which of our jobs could that firm see, and when" stays
 * answerable, which is the first question anyone asks after an incident.
 */
export async function revokeSubcontractorService(ctx: AuthedContext, data: any) {
  const { supabaseAdmin, teamId } = await requireTeamAdmin(ctx);

  const { data: sub } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("id, team_id")
    .eq("id", data.subcontractorId)
    .maybeSingle();
  if (!sub || (sub as any).team_id !== teamId) throw forbidden("Subcontractor not found.");

  /*
   * `.select()` so the revoke has to prove it landed.
   *
   * PostgREST does not treat "matched no rows" as an error on UPDATE, so
   * `const { error } = await ...update().eq()` cannot tell a write that worked
   * from one that touched nothing. On most paths that is a cosmetic risk. Not
   * here: this is what withdraws an outside firm's login to a customer's
   * jobsite photographs, and answering `{ ok: true }` when the row was not
   * stamped tells an admin the access is gone while the link still opens.
   *
   * Precautionary rather than a known failure - the row is read directly above,
   * so it should always match. `updateMemberRole` also read its row first and
   * still managed to return 200 having changed nothing, which is the reason
   * this path no longer takes that on trust.
   */
  const { data: revoked, error } = await supabaseAdmin
    .from("subcontractors" as any)
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", (sub as any).id)
    .select("id");
  if (error) throw new Error(error.message);
  if (!revoked || (revoked as unknown[]).length === 0) {
    throw Object.assign(
      new Error("That access was not withdrawn. Reload the list and try again."),
      { status: 409 },
    );
  }
  return { ok: true };
}

// ============================================================
// Accept
// ============================================================

/** PUBLIC. Shows who invited them before they hand over a password. */
export async function lookupSubcontractorInviteService(data: any) {
  limitByToken("lookup", data.token, LOOKUP_RATE);
  const supabaseAdmin = getSupabaseAdmin();

  const { data: sub } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("email, accepted_at, expires_at, team_id, teams(name)")
    .eq("token", data.token)
    .maybeSingle();
  if (!sub) return { valid: false as const, reason: "not_found" as const };

  const s = sub as any;
  if (s.accepted_at) return { valid: false as const, reason: "used" as const };
  if (new Date(s.expires_at) < new Date())
    return { valid: false as const, reason: "expired" as const };

  return {
    valid: true as const,
    email: s.email as string,
    teamName: (s.teams?.name ?? null) as string | null,
  };
}

/**
 * One winner per token.
 *
 * The `accepted_at` reads above are courtesies that produce a good error
 * message; this conditional update is the guard. Everything between a read and
 * a write here is an await, so two requests with the same token both pass the
 * read - `.is("accepted_at", null)` in the WHERE is what makes exactly one of
 * them come back with a row.
 */
async function claimSubcontractorInvite(
  supabaseAdmin: SupabaseAdmin,
  token: string,
  userId: string,
) {
  const { data } = await supabaseAdmin
    .from("subcontractors" as any)
    .update({ accepted_at: new Date().toISOString(), user_id: userId })
    .eq("token", token)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id, team_id")
    .maybeSingle();
  return (data as any) ?? null;
}

/** Signed in already - the address is proven by the login, not by the token. */
export async function acceptSubcontractorInviteService(ctx: AuthedContext, data: any) {
  const supabaseAdmin = getSupabaseAdmin();

  const { data: sub } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("id, email, accepted_at, expires_at, revoked_at, team_id")
    .eq("token", data.token)
    .maybeSingle();
  if (!sub) throw new Error("Invite not found or already used.");
  const s = sub as any;
  if (s.revoked_at) throw new Error("This invitation was withdrawn.");
  if (s.accepted_at) throw new Error("This invite has already been used.");
  if (new Date(s.expires_at) < new Date()) throw new Error("This invite has expired.");

  /*
   * The signed-in account must BE the invited address.
   *
   * Without this, anyone holding a token could bind it to their own account
   * and inherit the grant. The token proves someone was invited; the session
   * proves who is asking. Both, or neither.
   */
  const { data: profile } = await supabaseAdmin
    .from("profiles" as any)
    .select("email")
    .eq("id", ctx.userId)
    .maybeSingle();
  const signedInAs = String((profile as any)?.email ?? "").toLowerCase();
  if (!signedInAs || signedInAs !== String(s.email).toLowerCase()) {
    throw forbidden(
      `This invitation was sent to ${s.email}. Sign in as that address to accept it.`,
    );
  }

  const claimed = await claimSubcontractorInvite(supabaseAdmin, data.token, ctx.userId);
  if (!claimed) throw new Error("This invite has already been used.");
  return { ok: true, teamId: claimed.team_id };
}

/**
 * PUBLIC. Creates the lightweight account the spec asks for.
 *
 * Deliberately identical in its two security rules to `acceptInviteSignup`,
 * because it is the same shape of hole:
 *
 *  - It refuses an address that already has an account. This op has no
 *    Authorization header, so honouring a password here for an existing user
 *    would turn an invite link into an unauthenticated password reset.
 *  - It creates the user UNCONFIRMED. The caller has proven they hold a token,
 *    not that they can read the invited inbox. An unconfirmed account is inert
 *    until the real recipient clicks the confirmation mail, so a leaked token
 *    buys a squatted login rather than a live one - and the victim finds out,
 *    because the confirmation lands in their inbox.
 */
export async function acceptSubcontractorInviteSignupService(data: any) {
  limitByToken("signup", data.token, SIGNUP_RATE);
  const supabaseAdmin = getSupabaseAdmin();

  const { data: sub } = await supabaseAdmin
    .from("subcontractors" as any)
    .select("id, email, accepted_at, expires_at, revoked_at, team_id")
    .eq("token", data.token)
    .maybeSingle();
  if (!sub) throw new Error("Invite not found or already used.");
  const s = sub as any;
  if (s.revoked_at) throw new Error("This invitation was withdrawn.");
  if (s.accepted_at) throw new Error("This invite has already been used.");
  if (new Date(s.expires_at) < new Date()) throw new Error("This invite has expired.");

  const email = String(s.email).toLowerCase();

  const { data: existingProfile } = await supabaseAdmin
    .from("profiles" as any)
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    throw Object.assign(
      new Error(
        "An account already exists for this email. Sign in first, then open this invite link again. If you've never set a password, use “Forgot password” to set one.",
      ),
      { status: 409 },
    );
  }

  const { data: created, error: createErr } = await (supabaseAdmin as any).auth.admin.createUser({
    email,
    password: data.password,
    user_metadata: { full_name: data.fullName },
  });
  if (createErr || !created?.user) {
    throw new Error(createErr?.message ?? "Failed to create account");
  }
  const userId = created.user.id as string;

  await supabaseAdmin
    .from("profiles" as any)
    .upsert({ id: userId, email, full_name: data.fullName }, { onConflict: "id" });

  const claimed = await claimSubcontractorInvite(supabaseAdmin, data.token, userId);
  if (!claimed) {
    // The account survives, which is fine and recoverable: the 409 branch above
    // will tell them to sign in and reopen the link. Nothing else was written.
    throw new Error("This invite has already been used.");
  }

  /*
   * Ask for the confirmation mail. `createUser` sends nothing, and nothing
   * here used to ask - so a collaborator who accepted was told by the page to
   * "check your email to confirm your address" when no such email had been
   * sent, or ever would be. The account was inert and there was no way, from
   * anywhere in the product, to make one arrive.
   *
   * Best effort, after the claim: the account and the grant are real either
   * way, and `confirmationEmailSent` lets the page say which of "check your
   * inbox" and "we could not send it" is actually true.
   */
  const origin = String(data.origin ?? "").replace(/\/+$/, "") || "https://everlumen.co";
  const confirmRes = await sendSignupConfirmationEmail(email, origin, {
    password: data.password,
  });

  return {
    ok: true,
    teamId: claimed.team_id,
    email,
    emailConfirmationRequired: true,
    confirmationEmailSent: confirmRes.sent,
  };
}
