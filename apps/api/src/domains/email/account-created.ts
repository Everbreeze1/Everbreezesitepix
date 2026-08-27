import * as React from "react";
import { render } from "@react-email/render";
import { AccountCreatedEmail } from "@everlumen/email-templates";
import { getSupabaseAdmin } from "../../lib/supabase";
import { sendEmail } from "../../lib/send-email";
import { buildConfirmationUrl } from "./auth-send";

const SITE_NAME = "Everlumen";
const ROOT_DOMAIN = "everlumen.co";

export type AccountCreatedSendResult = {
  sent: boolean;
  /**
   * The link the message carried, so the console can offer it as a copyable
   * fallback. Null in `sign_in` mode (the sign-in page is not a secret worth a
   * button) and null when the token could not be minted at all.
   */
  actionUrl: string | null;
  reason: string | null;
};

/**
 * Tell somebody an admin just made them an account, and give them the way in.
 *
 * Two shapes, because there are two ways the console creates an account:
 *
 *   `set_password` - the admin supplied no password, so one was generated and
 *   thrown away. Nobody on earth knows it, which means this link is the only
 *   route into the account. It is a `recovery` token: verifying it signs them
 *   in and drops them on /reset-password to choose a password of their own.
 *
 *   `sign_in` - the admin typed a password and will pass it on out of band.
 *   The mail is then a courtesy note pointing at /login; it deliberately does
 *   NOT carry the password, because mail is not a channel to put one in.
 *
 * Minted with `admin.generateLink` and delivered over Resend, for the reason
 * spelled out at length in ./signup-confirmation.ts: GoTrue's own mailer
 * delegates to the project's Send Email hook, and a hook that does not answer
 * drops the message silently. That is what stranded the invited teammates in
 * the first place, and an admin-created account has even less recourse - the
 * person did not ask for it, so they will not go looking for a mail that never
 * came.
 *
 * Best effort by contract: the account already exists by the time this runs
 * and a mail failure must not undo it. The result says what happened, and the
 * caller surfaces `actionUrl` so an operator whose mail bounced still has
 * something to paste into a text message.
 */
export async function sendAccountCreatedEmail(
  email: string,
  origin: string,
  opts: {
    mode: "set_password" | "sign_in";
    teamName?: string | null;
    recipientName?: string | null;
  },
): Promise<AccountCreatedSendResult> {
  const site = origin.replace(/\/+$/, "");
  let actionUrl: string | null = null;

  try {
    if (opts.mode === "set_password") {
      const redirectTo = `${site}/reset-password`;
      const admin = getSupabaseAdmin();
      const { data, error } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
        options: { redirectTo },
      });
      const tokenHash = data?.properties?.hashed_token;
      if (error || !tokenHash) {
        throw new Error(error?.message ?? "generateLink returned no token");
      }
      actionUrl = buildConfirmationUrl({
        token_hash: tokenHash,
        email_action_type: "recovery",
        redirect_to: redirectTo,
      });
    }

    const element = React.createElement(AccountCreatedEmail, {
      siteName: SITE_NAME,
      siteUrl: `https://${ROOT_DOMAIN}`,
      actionUrl: actionUrl ?? `${site}/login`,
      mode: opts.mode,
      teamName: opts.teamName ?? null,
      recipientName: opts.recipientName ?? null,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });

    await sendEmail({
      to: email,
      subject:
        opts.mode === "set_password"
          ? `Choose a password for your ${SITE_NAME} account`
          : `Your ${SITE_NAME} account is ready`,
      html,
      text,
    });

    return { sent: true, actionUrl, reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "account_created_send_failed";
    console.error("[email] account-created send failed", { reason });
    // `actionUrl` is returned even on a send failure: if the token was minted
    // and only Resend fell over, the operator can still hand the link across
    // themselves rather than starting again.
    return { sent: false, actionUrl, reason };
  }
}
