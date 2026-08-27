import * as React from "react";
import { render } from "@react-email/render";
import { SignupEmail } from "@everlumen/email-templates";
import { getSupabaseAdmin } from "../../lib/supabase";
import { sendEmail } from "../../lib/send-email";
import { buildConfirmationUrl } from "./auth-send";

const SITE_NAME = "Everlumen";
const ROOT_DOMAIN = "everlumen.co";

export type ConfirmationSendResult = {
  sent: boolean;
  /** Which transport actually delivered it, for logs and for the API response. */
  via: "resend" | "gotrue" | null;
  reason: string | null;
};

/**
 * Mail the "confirm your email" link for an account we created ourselves.
 *
 * `auth.admin.createUser` never sends anything, so every invite-signup path
 * has to ask for this mail explicitly. It used to ask by calling
 * `auth.resend({ type: "signup" })`, which hands the job to GoTrue's mailer,
 * and that is where the invited teammates were being lost:
 *
 *   GoTrue's mailer does not send anything itself here. It calls the project's
 *   Send Email hook, and that call is a plain outbound HTTPS request to
 *   whatever URL the Supabase dashboard has on file. When that URL does not
 *   answer, GoTrue gives up and the message is never composed, let alone
 *   delivered. Asked against production while diagnosing this, `auth.resend`
 *   came back 422 `hook_timeout_after_retry`, "Failed to reach hook after
 *   maximum retries" - so every confirmation, password reset and email change
 *   was being dropped at that hop.
 *
 *   Team invite mail was unaffected, because we compose and send that
 *   ourselves through Resend without involving GoTrue at all. That asymmetry
 *   is the whole shape of the bug report: an owner adding a crew watched every
 *   invitation arrive and every confirmation vanish, leaving teammates on the
 *   roster unconfirmed and unable to sign in.
 *
 * So the token is minted with `admin.generateLink`. That is an admin call: it
 * composes nothing, sends nothing, and never touches the mailer or the hook -
 * it just hands back the token. We render and deliver the message over the
 * same Resend transport that carried the invite, which is the transport we
 * already know reaches these people, since they had to receive the invite to
 * be here at all. A misconfigured hook can no longer strand an invitee.
 *
 * It does NOT make the hook redundant. `/signup`, `/login` and the password
 * reset all call GoTrue straight from the browser, so those still depend on
 * the hook URL being correct. See docs/auth.md.
 *
 * `auth.resend` is kept as a fallback so a project where generateLink is
 * refused still behaves exactly as it did before rather than worse.
 *
 * Best effort by contract: the caller has already created the account, and a
 * mail failure must not roll that back. The result says what happened so the
 * UI can offer a resend instead of leaving somebody waiting for a message that
 * was never sent.
 */
export async function sendSignupConfirmationEmail(
  email: string,
  origin: string,
  opts: { password?: string } = {},
): Promise<ConfirmationSendResult> {
  const redirectTo = `${origin.replace(/\/+$/, "")}/dashboard`;

  try {
    const admin = getSupabaseAdmin();
    /*
     * `signup` when we hold the password the account was just created with:
     * that is literally what this link confirms, and GoTrue regenerates the
     * confirmation token for an existing UNCONFIRMED user rather than
     * refusing (it refuses only once the address is confirmed, which is the
     * one case that must not get another link).
     *
     * `magiclink` when we do not - the owner pressing "Resend confirmation"
     * on the roster has no business supplying a password, and generateLink
     * would take one. Verifying a magic link confirms an unconfirmed address
     * just as a signup token does, and signs them in on the way through.
     */
    const type = opts.password ? "signup" : "magiclink";
    // Both calls written out rather than built as one object, so the SDK's
    // discriminated union actually type-checks the arguments. It is the only
    // thing standing between a typo here and a permanent silent fallback.
    const { data, error } = opts.password
      ? await admin.auth.admin.generateLink({
          type: "signup",
          email,
          password: opts.password,
          options: { redirectTo },
        })
      : await admin.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo },
        });
    const tokenHash = data?.properties?.hashed_token;
    if (error || !tokenHash) {
      throw new Error(error?.message ?? "generateLink returned no token");
    }

    const confirmationUrl = buildConfirmationUrl({
      token_hash: tokenHash,
      email_action_type: type,
      redirect_to: redirectTo,
    });
    const element = React.createElement(SignupEmail, {
      siteName: SITE_NAME,
      siteUrl: `https://${ROOT_DOMAIN}`,
      recipient: email,
      confirmationUrl,
    });
    const html = await render(element);
    const text = await render(element, { plainText: true });
    // Same subject the Send Email hook uses for `signup`, so a resend and a
    // first send do not look like two different messages in one thread.
    await sendEmail({ to: email, subject: "Confirm your email", html, text });
    return { sent: true, via: "resend", reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : "generate_link_failed";
    console.error("[email] direct confirmation send failed, falling back to GoTrue", { reason });

    try {
      const admin = getSupabaseAdmin();
      const { error } = await admin.auth.resend({
        type: "signup",
        email,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        console.error("[email] signup confirmation email error", error);
        return { sent: false, via: null, reason: error.message };
      }
      return { sent: true, via: "gotrue", reason: null };
    } catch (fallbackErr) {
      const fallbackReason =
        fallbackErr instanceof Error ? fallbackErr.message : "confirmation_send_failed";
      console.error("[email] signup confirmation email error", fallbackErr);
      return { sent: false, via: null, reason: fallbackReason };
    }
  }
}
