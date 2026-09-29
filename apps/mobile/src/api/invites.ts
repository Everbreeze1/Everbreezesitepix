import { api, webAppUrl } from "@/lib/api";
import type { BillingTier } from "@everlumen/shared/team-permissions";

/**
 * Joining a workspace from an invitation, and starting one.
 *
 * The same `/v1/rpc` ops the web's `/invite/<token>` and
 * `/subcontractor-invite/<token>` pages call, in the same order. The lookups and
 * the two signup ops are public on the server (the invitee has no session yet);
 * the plain accepts need one, and the server checks the signed-in address is the
 * invited one.
 *
 * `origin` is where the server mints the confirmation link in the email it
 * sends. The web passes its own origin; the phone passes the web app's, because
 * that link is opened in a mail app and has to land on a page that exists.
 */

const origin = webAppUrl || undefined;

export type TeamInviteLookup = {
  invite: {
    id: string;
    team_id: string;
    email: string;
    role: string;
    expires_at: string;
    accepted_at: string | null;
  } | null;
  team: { id: string; name: string | null } | null;
  tier: BillingTier;
};

export async function lookupInvite(token: string): Promise<TeamInviteLookup> {
  const res = await api.rpc<Partial<TeamInviteLookup>>("lookupInvite", { token });
  return {
    invite: res?.invite ?? null,
    team: res?.team ?? null,
    tier: (res?.tier as BillingTier) ?? "starter",
  };
}

/** Signed in as the invited address: one call, and they are on the team. */
export async function acceptInvite(token: string): Promise<void> {
  await api.rpc("acceptInvite", { token });
}

export type InviteSignupResult = {
  email?: string;
  /** False when the server could not send the confirmation email. */
  confirmationEmailSent?: boolean;
};

/**
 * No account yet: create one against the invited address and take the seat.
 * The account is created unconfirmed on purpose, so the sign-in that follows
 * may legitimately fail until the email is confirmed.
 */
export async function acceptInviteSignup(args: {
  token: string;
  fullName: string;
  password: string;
}): Promise<InviteSignupResult> {
  const res = await api.rpc<InviteSignupResult>("acceptInviteSignup", {
    token: args.token,
    fullName: args.fullName,
    password: args.password,
    origin,
  });
  return res ?? {};
}

export type ResendConfirmationResult = {
  alreadyConfirmed?: boolean;
  emailSent?: boolean;
};

export async function resendInviteConfirmation(token: string): Promise<ResendConfirmationResult> {
  const res = await api.rpc<ResendConfirmationResult>("resendInviteConfirmation", {
    token,
    origin,
  });
  return res ?? {};
}

export type SubcontractorInviteLookup = {
  valid: boolean;
  reason?: string;
  email?: string;
  teamName?: string | null;
};

export async function lookupSubcontractorInvite(token: string): Promise<SubcontractorInviteLookup> {
  const res = await api.rpc<Partial<SubcontractorInviteLookup>>("lookupSubcontractorInvite", {
    token,
  });
  return {
    valid: Boolean(res?.valid),
    reason: res?.reason,
    email: res?.email,
    teamName: res?.teamName ?? null,
  };
}

export async function acceptSubcontractorInvite(token: string): Promise<void> {
  await api.rpc("acceptSubcontractorInvite", { token });
}

export async function acceptSubcontractorInviteSignup(args: {
  token: string;
  fullName: string;
  password: string;
}): Promise<InviteSignupResult> {
  const res = await api.rpc<InviteSignupResult>("acceptSubcontractorInviteSignup", {
    token: args.token,
    fullName: args.fullName,
    password: args.password,
    origin,
  });
  return res ?? {};
}

/** Start a workspace. The caller becomes its owner; the server refuses a second team. */
export async function createTeam(name: string): Promise<void> {
  await api.rpc("createTeam", { name });
}
