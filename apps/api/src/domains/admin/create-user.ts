import { z } from "zod";
import {
  ROLE_LABEL,
  assignableRoles,
  roleAllowedOnTier,
  type AssignableRole,
} from "@everlumen/shared/team-permissions";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { PLAN_MEMBER_CAP, type BillingTier } from "../../lib/team-plan";
import { sendAccountCreatedEmail } from "../email/account-created";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * Create an account from the admin console.
 *
 * The gap this closes, in the customer's words: "in the admin page, I think
 * admin cant add user - it will be useful instead of creating a new
 * subscription." Every route into the product went through self-serve signup
 * or a team invite, so putting somebody on an existing paying team meant
 * asking them to sign up, wait for a confirmation mail, and then be invited:
 * three steps, two of which were failing (see ../email/signup-confirmation.ts),
 * and the workaround was selling them a subscription they did not need.
 *
 * WHY THE ADDRESS IS CONFIRMED ON CREATION.
 * A confirmation mail exists to prove that whoever typed an address can read
 * it. Nobody typed this one: an admin asserted it on the person's behalf, and
 * an unconfirmed admin-created account is inert in exactly the way the bug
 * report describes - the account exists, the person cannot sign in, and the
 * only thing that would unstick them is a mail they never asked for. So the
 * account is created confirmed and the proof of control moves to the way in:
 * in `set_password` mode the only route into the account is a one-shot link
 * delivered to that address, so an address the admin got wrong yields an
 * account nobody can enter. In `sign_in` mode the admin is handing over
 * credentials directly, which is the point of an admin creating an account for
 * somebody sitting next to them, and it is audit logged as that.
 */

/** Owner is transferred, never assigned - the rule the product already keeps. */
const ASSIGNABLE_TEAM_ROLES = ["admin", "manager", "standard", "restricted"] as const;

export const createPlatformUserInputSchema = z
  .object({
    email: z.string().trim().email().max(254),
    fullName: z.string().trim().max(120).optional(),
    company: z.string().trim().max(160).optional(),
    /**
     * Optional membership in an EXISTING team. This is the half the customer
     * actually asked for: an account with no team is a person who still has to
     * buy something before the product does anything for them.
     */
    team: z
      .object({
        teamId: z.string().uuid(),
        role: z.enum(ASSIGNABLE_TEAM_ROLES),
        /**
         * Add them past the plan's seat ceiling.
         *
         * Off by default, because seats are what a team pays for and quietly
         * handing out a free one is giving the product away. On, it is a
         * deliberate act by a superadmin and the audit row says so - which is
         * the honest shape for "comp this one crew member", rather than either
         * refusing outright or never counting at all.
         */
        overSeatLimit: z.boolean().default(false),
      })
      .optional(),
    /**
     * A password the admin sets now. Omitted - the normal case - means we
     * generate a throwaway and mail them a link to choose their own.
     */
    password: z.string().min(8).max(72).optional(),
    note: z.string().trim().max(500).optional(),
    /** Where the emailed link should land. Defaults to the production site. */
    origin: z.string().url().optional(),
  })
  .superRefine((value, ctx) => {
    /*
     * A note is required only when a team is attached, and that boundary is
     * the point rather than an inconsistency.
     *
     * Creating a bare account reaches into nobody's data; the worst case is a
     * stray row. Attaching it to a team hands a stranger the run of a paying
     * customer's projects, photos and reports, which is the class of action
     * every other control in this console makes you write a reason for.
     */
    if (value.team && (value.note ?? "").trim().length < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "Adding someone to an existing team needs a reason for the audit log.",
      });
    }
  });

export interface CreatePlatformUserResult {
  userId: string;
  email: string;
  /** Did the "here is your account" mail actually go out. */
  emailSent: boolean;
  /** Why it did not, when it did not. */
  emailReason: string | null;
  /**
   * The one-shot set-password link, when there is one.
   *
   * Handed back so an operator whose mail bounced can pass it on themselves.
   * This repo has been burned once already by a mail transport failing
   * silently, and an admin-created account whose link was never delivered is
   * an account nobody can ever enter.
   */
  setupLink: string | null;
  team: { id: string; name: string; role: AssignableRole; overSeatLimit: boolean } | null;
}

/** A throwaway the account is created with and nobody is ever told. */
function generateThrowawayPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // Hex plus a fixed punctuation tail, so it clears whatever complexity rule
  // GoTrue is configured with without this function having to know it.
  return `${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}aA1!`;
}

function tierOf(team: { plan?: string | null; is_internal?: boolean | null }): BillingTier {
  if (team.is_internal) return "team";
  const plan = team.plan;
  return plan === "pro" || plan === "team" ? plan : "starter";
}

export async function createPlatformUserService(
  ctx: AuthedContext,
  data: z.infer<typeof createPlatformUserInputSchema>,
): Promise<CreatePlatformUserResult> {
  /*
   * Superadmin only, and a step above the rest of the users screen on purpose.
   *
   * `support` already covers suspend, reinstate and password resets, and none
   * of those can hand the operator access to anything: a reset mail goes to
   * the customer's inbox, not theirs. This one can. An account created with a
   * password the operator chose, attached to a customer's team, is a working
   * login into that customer's workspace - the same escalation `owner` exists
   * to fence off for granting platform admin.
   */
  await requirePlatformAdmin(ctx.userId, "owner");
  const admin = getSupabaseAdmin();

  const email = data.email.toLowerCase();
  const origin = (data.origin ?? "https://everlumen.co").replace(/\/+$/, "");
  const fullName = data.fullName?.length ? data.fullName : null;
  const company = data.company?.length ? data.company : null;

  /*
   * Refuse an address that already has an account, before anything is written.
   *
   * `createUser` would refuse too, with "A user with this email address has
   * already been registered" - true, and useless, because the operator's next
   * question is "then what do I do". The console can answer that one: the
   * account is already in the list they are looking at.
   */
  const { data: existingProfile } = await (admin as any)
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existingProfile) {
    throw Object.assign(
      new Error(
        `${email} already has an account. Open it from the users list to change their team, or send them a password reset.`,
      ),
      { status: 409 },
    );
  }

  /*
   * Everything that can refuse this request is checked BEFORE the auth user
   * exists. A team that is full, or a role its plan cannot hold, must not
   * leave a stranded account behind; not creating one is strictly better than
   * unwinding one.
   */
  let team: { id: string; name: string; tier: BillingTier; cap: number } | null = null;
  if (data.team) {
    const { data: row, error } = await (admin as any)
      .from("teams")
      .select("id, name, plan, member_limit, is_internal")
      .eq("id", data.team.teamId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw Object.assign(new Error("That team no longer exists."), { status: 404 });

    const tier = tierOf(row);
    const requested = data.team.role;
    if (!roleAllowedOnTier(requested, tier)) {
      throw Object.assign(
        new Error(`The ${ROLE_LABEL[requested]} role is not available on a ${tier} plan.`),
        { status: 400 },
      );
    }
    // The gate the product already applies: `restricted` is only offerable now
    // that project_assignments and its RLS exist to actually scope it.
    if (!assignableRoles(tier, { assignmentsEnforced: true }).includes(requested)) {
      throw Object.assign(new Error("That role cannot be assigned."), { status: 400 });
    }

    const cap = (row as any).member_limit ?? PLAN_MEMBER_CAP[tier];
    const [{ count: memberCount }, { count: inviteCount }] = await Promise.all([
      (admin as any)
        .from("team_members")
        .select("id", { count: "exact", head: true })
        .eq("team_id", (row as any).id),
      (admin as any)
        .from("team_invites")
        .select("id", { count: "exact", head: true })
        .eq("team_id", (row as any).id)
        .is("accepted_at", null),
    ]);
    // Open invites count, exactly as they do in `inviteMember`: a seat someone
    // is already on their way into is not a free seat.
    const used = (memberCount ?? 0) + (inviteCount ?? 0);
    if (used >= cap && !data.team.overSeatLimit) {
      throw Object.assign(
        new Error(
          `${(row as any).name} is using all ${cap} of its seats. Tick "Add past the seat limit" to place them anyway, or free a seat first.`,
        ),
        { status: 409 },
      );
    }

    team = { id: (row as any).id, name: (row as any).name, tier, cap };
  }

  const password = data.password ?? generateThrowawayPassword();
  const mode: "set_password" | "sign_in" = data.password ? "sign_in" : "set_password";

  const { data: created, error: createErr } = await (admin as any).auth.admin.createUser({
    email,
    password,
    // See the header note. The admin is vouching for the address; the way into
    // the account is what proves the recipient controls it.
    email_confirm: true,
    user_metadata: { full_name: fullName, company },
  });
  if (createErr || !created?.user?.id) {
    /*
     * GoTrue is the backstop for the duplicate check above, and it catches the
     * cases that check cannot: an auth user with no `profiles` row, or one
     * stored under different casing. Its own wording ("A user with this email
     * address has already been registered") is true and unhelpful, and as an
     * unclassified error it would reach the console as a 500 - so a routine
     * "this person already exists" would read as the server falling over.
     */
    const message = createErr?.message ?? "";
    if (/already (been )?registered|already exists/i.test(message)) {
      throw Object.assign(
        new Error(
          `${email} already has an account. Find it in the users list to change their team, or send them a password reset.`,
        ),
        { status: 409 },
      );
    }
    throw new Error(message || "Could not create that account.");
  }
  const userId = created.user.id as string;

  try {
    const { error: profileErr } = await (admin as any)
      .from("profiles")
      .upsert({ id: userId, email, full_name: fullName, company }, { onConflict: "id" });
    if (profileErr) throw new Error(profileErr.message);

    if (team && data.team) {
      const { data: inserted, error: memberErr } = await (admin as any)
        .from("team_members")
        .insert({ team_id: team.id, user_id: userId, role: data.team.role })
        .select("id")
        .single();
      if (memberErr || !inserted) throw new Error(memberErr?.message ?? "Could not join the team.");

      /*
       * Confirm the seat after taking it. The count above and this insert are
       * separated by awaits, so two concurrent adds can both clear a check
       * that had one seat left. Same check-then-act guard, and the same
       * compensating delete, as `acceptInviteSignup`.
       */
      if (!data.team.overSeatLimit) {
        const { count: finalCount } = await (admin as any)
          .from("team_members")
          .select("id", { count: "exact", head: true })
          .eq("team_id", team.id);
        if ((finalCount ?? 0) > team.cap) {
          await (admin as any)
            .from("team_members")
            .delete()
            .eq("id", (inserted as any).id);
          // 409, not an unclassified throw: losing a race for the last seat is
          // a routine conflict, and an unstatused error is recorded as a 5xx
          // server failure (see the audit note in lib/errors.ts).
          throw Object.assign(
            new Error(`${team.name} filled its last seat while this was being created.`),
            { status: 409 },
          );
        }
      }
    }
  } catch (err) {
    /*
     * Unwind the auth user rather than leaving a half-made account.
     *
     * The alternative is a confirmed login belonging to no team that the
     * operator does not know exists - which is exactly the orphan the 409
     * above then has to apologise for on the next attempt. The profile row
     * goes with it: `profiles.id` references `auth.users` ON DELETE CASCADE.
     */
    await (admin as any).auth.admin.deleteUser(userId).catch(() => {});
    throw err;
  }

  const mail = await sendAccountCreatedEmail(email, origin, {
    mode,
    teamName: team?.name ?? null,
    recipientName: fullName,
  });

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "create_user",
    targetType: "user",
    targetId: userId,
    metadata: {
      email,
      fullName,
      company,
      // Which of the two shapes this was, so the trail distinguishes "mailed
      // them a link" from "handed somebody a working password".
      accessMode: mode,
      teamId: team?.id ?? null,
      teamRole: data.team?.role ?? null,
      overSeatLimit: data.team?.overSeatLimit ?? false,
      emailSent: mail.sent,
      note: data.note ?? null,
    },
  });

  return {
    userId,
    email,
    emailSent: mail.sent,
    emailReason: mail.reason,
    setupLink: mode === "set_password" ? mail.actionUrl : null,
    team:
      team && data.team
        ? {
            id: team.id,
            name: team.name,
            role: data.team.role,
            overSeatLimit: data.team.overSeatLimit,
          }
        : null,
  };
}
