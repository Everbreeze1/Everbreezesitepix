import * as React from "react";
import { render } from "@react-email/render";
import { InviteEmail } from "@sitepix/email-templates";
import { sendEmail } from "../../lib/send-email";

const SITE_NAME = "Everbreeze SitePix";
const ROOT_DOMAIN = "everbreezesitepix.com";

/**
 * The team invite email we send ourselves.
 *
 * `teams/service.ts` used to delegate every invite email to
 * `auth.admin.inviteUserByEmail` and give up when GoTrue refused. GoTrue refuses
 * for an address that already has an account, for a rate-limited address, and
 * for any error from the Send Email hook — and in all three cases it sends
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
  inviterName?: string;
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
  // Naming the team in the subject is what makes this read as a real invitation
  // rather than a generic system mail in a crowded inbox.
  const subject = opts.teamName
    ? `You've been invited to join ${opts.teamName} on ${SITE_NAME}`
    : `You've been invited to ${SITE_NAME}`;
  await sendEmail({ to: opts.to, subject, html, text });
}
