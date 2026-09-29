import { can, roleLabelForTier, type BillingTier } from "@everlumen/shared/team-permissions";

/**
 * The invitation rules, free of React and the network so they can be tested.
 *
 * The web sends two kinds of invitation link, and the phone answers both:
 *
 *   https://everlumen.co/invite/<token>               joining a team
 *   https://everlumen.co/subcontractor-invite/<token> an outside firm, one job
 *
 * They reach the app three ways: as an Android App Link (the intent filters in
 * app.json), as the app's own scheme (`everlumen://invite/<token>`), or pasted
 * into the Team screen by somebody whose phone opened the email in a browser.
 * All three end up at the same route, so the rules for reading a link live
 * here once.
 */

export type InviteKind = "team" | "subcontractor";

export type ParsedInvite = { kind: InviteKind; token: string };

/** The server's token bounds (`z.string().min(10).max(200)`), in URL-safe characters. */
const TOKEN = /^[A-Za-z0-9_-]{10,200}$/;

/** Supabase's per-address resend window is about 60s; the web waits the same. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Reads an invitation out of whatever was pasted or opened: a full https link,
 * an `everlumen://` link, or a bare path. Null for anything else, including a
 * link to some other page of the web app.
 */
export function parseInviteLink(input: string | null | undefined): ParsedInvite | null {
  const text = (input ?? "").trim();
  if (!text) return null;
  const match = /(?:^|\/)(subcontractor-invite|invite)\/([^/?#\s]+)/.exec(text);
  if (!match) return null;
  const token = decodeSafely(match[2]);
  if (!token || !TOKEN.test(token)) return null;
  return { kind: match[1] === "invite" ? "team" : "subcontractor", token };
}

function decodeSafely(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The app route for a parsed invitation. */
export function inviteRoute(invite: ParsedInvite): string {
  const base = invite.kind === "team" ? "/invite" : "/subcontractor-invite";
  return `${base}/${encodeURIComponent(invite.token)}`;
}

/** Whether a pathname is one of the invitation screens (reachable signed out). */
export function isInvitePath(pathname: string | null | undefined): boolean {
  return (
    parseInviteLink(pathname ?? "") !== null && /^\/(subcontractor-)?invite\//.test(pathname ?? "")
  );
}

/**
 * Where sign-in goes next when it was opened from an invitation.
 *
 * Only an invitation path is honoured. Anything else in the parameter is
 * ignored, so a crafted link cannot send somebody who just signed in to an
 * arbitrary screen.
 */
export function safeAfterLogin(redirect: unknown): string | null {
  const value = Array.isArray(redirect) ? redirect[0] : redirect;
  return typeof value === "string" && isInvitePath(value) ? value : null;
}

/**
 * The link somebody can be sent to join, built exactly as the web's Copy link
 * builds it: the web app's origin, then `/invite/<token>`. Null when the build
 * has no web origin configured, so nothing shares a relative path.
 */
export function teamInviteLink(token: string, webOrigin: string): string | null {
  const origin = webOrigin.replace(/\/$/, "");
  if (!origin || !token) return null;
  return `${origin}/invite/${token}`;
}

/** Why a team invitation cannot be used, in the web's words, or null when it can. */
export function teamInviteProblem(
  invite: { accepted_at: string | null; expires_at: string } | null,
  now: Date = new Date(),
): string | null {
  if (!invite) return "This invite link is invalid.";
  if (invite.accepted_at) return "This invite has already been used.";
  if (new Date(invite.expires_at) < now) return "This invite has expired.";
  return null;
}

/** Why a subcontractor invitation cannot be used, in the web's words. */
export function subcontractorInviteProblem(reason: string | undefined): string {
  if (reason === "used") return "This invitation has already been used.";
  if (reason === "expired")
    return "This invitation has expired. Ask the contractor to send a new one.";
  return "This invitation link is not valid.";
}

/** The signup form's checks, in the order the web runs them. */
export function inviteSignupProblem(fields: {
  fullName: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (fields.fullName.trim().length < 1) return "Please enter your full name.";
  if (fields.password.length < 8) return "Password must be at least 8 characters.";
  if (fields.password !== fields.confirmPassword) return "Passwords do not match.";
  return null;
}

/** Case-insensitive, because an address typed with a capital is the same inbox. */
export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

/**
 * What the invitee is accepting, addressed to them.
 *
 * The role is named the way this team names it, from the shared matrix. It
 * says nothing about the plan: somebody who has not joined yet is told what
 * they will be able to do, never what the workspace pays for.
 */
export function teamInviteSummary(
  role: string,
  tier: BillingTier,
  teamName: string,
): { roleLabel: string; access: string; manage: string } {
  return {
    roleLabel: roleLabelForTier(role, tier),
    access: can(role, "view_all_projects")
      ? `You'll get access to all of ${teamName}'s projects, photos, and reports.`
      : `You'll get access to the jobs ${teamName} puts you on, and nothing else in the workspace.`,
    manage: can(role, "manage_users")
      ? "You'll be able to manage the team and every project."
      : "You won't be able to manage the team.",
  };
}
