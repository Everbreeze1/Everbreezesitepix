import * as React from "react";
import { render } from "@react-email/render";
import { InviteEmail } from "@sitepix/email-templates";
import { sendEmail } from "../../lib/send-email";

const SITE_NAME = "Everbreeze SitePix";
const ROOT_DOMAIN = "everbreezesitepix.com";

/**
 * Trim to `max` characters on a word boundary where there is one.
 *
 * Also flattens whitespace, which is what keeps a `full_name` containing CR/LF
 * from reaching a header - Subject has no equivalent of `sendEmail`'s From
 * sanitising, so this is the only guard on that path.
 */
function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

/**
 * The team invite email we send ourselves.
 *
 * `teams/service.ts` used to delegate every invite email to
 * `auth.admin.inviteUserByEmail` and give up when GoTrue refused. GoTrue refuses
 * for an address that already has an account, for a rate-limited address, and
 * for any error from the Send Email hook - and in all three cases it sends
 * NOTHING. Each one returned `{ sent: false }`, the dialog fell back to showing
 * a raw token for the owner to copy by hand, and the invitee received nothing at
 * all. That is the "Invite link (email not sent)" box in the bug report.
 *
 * `acceptUrl` is the app's own `/invite/<token>` route, which serves both cases
 * without any GoTrue token: an existing user accepts via `acceptInvite`, a new
 * one signs up in place via `acceptInviteSignup`
 * (apps/web/src/routes/invite.$token.tsx). So this mail is a complete path on
 * its own, not a degraded one.
 */
export async function sendTeamInviteEmail(opts: {
  to: string;
  acceptUrl: string;
  teamName?: string;
  /** Display label for the body copy - a name if we have one, else their email. */
  inviterName?: string;
  /**
   * The inviter's real name and address, when the profile carries them. Kept
   * apart from `inviterName` because these two go into headers rather than
   * body copy, and only a genuine name belongs in a From line: falling back to
   * an email address there would read as a spoof.
   */
  inviterFullName?: string | null;
  inviterEmail?: string | null;
  expiresInDays?: number;
}): Promise<void> {
  const element = React.createElement(InviteEmail, {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    confirmationUrl: opts.acceptUrl,
    teamName: opts.teamName,
    inviterName: opts.inviterName,
    expiresInDays: opts.expiresInDays,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });
  // Lead with the person, not the product. Naming the team is what makes this
  // read as a real invitation rather than generic system mail; naming the
  // *inviter* first is what makes it read as mail from a human - the same cue
  // Gmail weighs when it decides between Primary and Promotions. The site name
  // is left out on purpose: it is already the From display name, and repeating
  // it only lengthens the subject with branding.
  const subject = opts.inviterFullName
    ? `${clip(opts.inviterFullName, 40)} invited you to join ${opts.teamName ?? SITE_NAME}`
    : opts.teamName
      ? `You've been invited to join ${opts.teamName}`
      : `You've been invited to ${SITE_NAME}`;
  await sendEmail({
    to: opts.to,
    subject,
    html,
    text,
    // "Mark Lagura (via Everbreeze SitePix)" - the pattern shared-document mail
    // has used for years. The address stays our verified sender, so DKIM/DMARC
    // are untouched; only the name a human reads changes.
    //
    // The name is clipped first because `sendEmail` caps the finished display
    // name at 64 characters: composing before clipping would let a long
    // `full_name` eat the "(via ...)" and leave the sender reading as a bare
    // stranger's name on our domain.
    fromName: opts.inviterFullName
      ? `${clip(opts.inviterFullName, 24)} (via ${SITE_NAME})`
      : undefined,
    // A reply reaches the teammate who actually invited them instead of dying
    // in a shared inbox. Two-way mail is the strongest not-a-broadcast signal
    // there is, and "who are you and why am I getting this" deserves an answer.
    replyTo: opts.inviterEmail ?? undefined,
  });
}
