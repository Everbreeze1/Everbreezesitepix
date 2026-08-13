import * as React from "react";
import { render } from "@react-email/render";
import {
  SignupEmail,
  InviteEmail,
  MagicLinkEmail,
  RecoveryEmail,
  EmailChangeEmail,
  ReauthenticationEmail,
} from "@sitepix/email-templates";
import { verifyBearerSecret } from "../../lib/cron-auth";
import { verifyStandardWebhook } from "../../lib/webhook-signature";
import { jsonError, jsonOk } from "../../lib/errors";
import { sendEmail } from "../../lib/send-email";

const EMAIL_SUBJECTS: Record<string, string> = {
  signup: "Confirm your email",
  invite: "You've been invited",
  magiclink: "Your login link",
  recovery: "Reset your password",
  email_change: "Confirm your new email",
  // Secure email change sends one to each address; they need different subjects
  // because they are asking different people for different things.
  email_change_current: "Approve the change of your email address",
  email_change_new: "Confirm your new email",
  reauthentication: "Your verification code",
};

/**
 * Every `email_action_type` GoTrue can send us.
 *
 * `email_change_current` / `email_change_new` were missing. With Supabase's
 * secure email change turned on, changing an address fires BOTH of those — one
 * asking the old address to approve, one asking the new address to confirm —
 * and an unmapped type returns 400 from this handler, so that mail is never
 * sent. The change then sits forever with `new_email` set and `email`
 * unchanged: the user is told to check their inbox, and nothing they can do
 * will ever complete it.
 *
 * Both reuse EmailChangeEmail; the subjects differ because the two messages ask
 * different people for different things.
 */
const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
  email_change_current: EmailChangeEmail,
  email_change_new: EmailChangeEmail,
  reauthentication: ReauthenticationEmail,
};

const SITE_NAME = "Everbreeze SitePix";
const ROOT_DOMAIN = "everbreezesitepix.com";

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

/**
 * Build the GoTrue verify link that the email's button points at.
 *
 * `email_data.site_url` arrives from Supabase ALREADY pointing at the GoTrue
 * base — i.e. `https://<ref>.supabase.co/auth/v1`. Appending `/auth/v1/verify`
 * to that produced
 *
 *     https://<ref>.supabase.co/auth/v1/auth/v1/verify?token=...
 *
 * which matches no route, so the request fell through to the API gateway and
 * came back as `{"message":"No API key found in request"}`. Every confirmation
 * link sent before this fix is dead in exactly that way — the misleading part
 * is that the error blames a missing apikey rather than the doubled path.
 *
 * The suffix is stripped rather than the base hard-coded, so this stays correct
 * whether Supabase sends the GoTrue base or a bare origin.
 */
export function buildConfirmationUrl(emailData: {
  site_url?: string;
  token_hash?: string;
  token_hash_new?: string;
  email_action_type?: string;
  redirect_to?: string;
}): string {
  const base = (emailData.site_url ?? `https://${ROOT_DOMAIN}`)
    .replace(/\/+$/, "")
    .replace(/\/auth\/v1$/, "");
  /*
   * `email_change_current` / `email_change_new` are hook action types, not
   * verify types — GoTrue's /verify only understands `email_change`. Passing
   * the hook type straight through produced a link the endpoint rejects.
   */
  const action = emailData.email_action_type ?? "signup";
  const verifyType = action.startsWith("email_change") ? "email_change" : action;
  /*
   * An email change has TWO tokens: `token_hash` proves the old address
   * approved, `token_hash_new` proves the new one did. Sending the old token to
   * the new address would confirm the wrong half, so the message aimed at the
   * new address must carry `token_hash_new`.
   */
  const wantsNewToken = action === "email_change" || action === "email_change_new";
  const token = (wantsNewToken ? emailData.token_hash_new : undefined) ?? emailData.token_hash ?? "";
  const params = new URLSearchParams({
    token,
    type: verifyType,
  });
  if (emailData.redirect_to) params.set("redirect_to", emailData.redirect_to);
  return `${base}/auth/v1/verify?${params.toString()}`;
}

/**
 * SitePix Auth "Send Email" hook handler.
 * Configure hook URL: https://<host>/v1/auth/send-email
 * Secret env: AUTH_EMAIL_HOOK_SECRET
 */
export async function handleAuthSendEmail(request: Request): Promise<Response> {
  /*
   * Two accepted auth schemes, because the caller differs by environment.
   *
   * Supabase Auth's HTTP hook signs the request per Standard Webhooks and
   * sends `webhook-signature` — it never sends a bearer token. The secret it
   * stores looks like `v1,whsec_<base64>`. Verifying only a bearer here meant
   * a correctly configured hook still 401'd, and Supabase surfaced that to the
   * user as a bare 500 on signup.
   *
   * The bearer path is kept for manual calls and smoke tests (documented in
   * docs/api.md), which is also how this handler is exercised without going
   * through Supabase.
   *
   * The raw text is read once and reused: the signature covers the exact bytes,
   * so re-serializing parsed JSON would change them and break verification.
   */
  const rawBody = await request.text();
  const signed = verifyStandardWebhook(request, rawBody, process.env.AUTH_EMAIL_HOOK_SECRET);
  if (!signed && !verifyBearerSecret(request, "AUTH_EMAIL_HOOK_SECRET")) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(400, "invalid_json", "Invalid JSON");
  }

  const email = body?.user?.email as string | undefined;
  const emailData = body?.email_data ?? {};
  const emailType = emailData.email_action_type as string | undefined;

  /*
   * WHO the message goes to is not always `user.email`.
   *
   * For an email change, `user.email` is still the OLD address — the change is
   * pending precisely because the new one is unverified. Sending the
   * "confirm your new email" link there means the new address is never asked to
   * confirm, so `new_email` stays set, `email` never moves, and the change can
   * never complete no matter what the user does. That is exactly what happened
   * in production: one message, delivered to the old address, change stuck.
   *
   *   email_change_current -> the OLD address approves the change
   *   email_change_new     -> the NEW address confirms it
   *   email_change         -> single-confirmation mode; it is the NEW address
   *                           that has to prove ownership
   *
   * `new_email` is carried on email_data; fall back to user.email so a missing
   * field degrades to today's behaviour rather than dropping the mail.
   */
  if (!email || !emailType) {
    return jsonError(400, "invalid_payload", "Invalid payload");
  }

  /*
   * The pending address lives on the USER record as `user.new_email`, not on
   * email_data. GoTrue's Send Email payload carries `token_hash_new` for the
   * new address but no `new_email` field, so reading `email_data.new_email`
   * found nothing — and falling back to `email_data.email` silently resolved
   * to the OLD address, which is how the confirmation kept going to the wrong
   * mailbox even after the routing fix.
   *
   * No fallback to email_data.email here, deliberately: it is the current
   * address, so using it would re-introduce exactly that bug. If we genuinely
   * cannot find the new address we send to `email` and log it, which is at
   * least visible.
   */
  const newEmail = (body?.user?.new_email ?? emailData.new_email) as string | undefined;
  const wantsNewAddress = emailType === "email_change" || emailType === "email_change_new";
  const recipient: string = wantsNewAddress ? (newEmail ?? email) : email;
  if (wantsNewAddress && !newEmail) {
    console.error("[auth-send] email change with no new address in the payload", {
      emailType,
      payloadKeys: Object.keys(emailData),
      userKeys: Object.keys(body?.user ?? {}),
    });
  }

  const EmailTemplate = EMAIL_TEMPLATES[emailType];
  if (!EmailTemplate) {
    return jsonError(400, "unknown_email_type", `Unknown email type: ${emailType}`);
  }

  console.log("Auth email hook", {
    emailType,
    email_redacted: redactEmail(email),
    recipient_redacted: redactEmail(recipient),
  });

  const confirmationUrl = buildConfirmationUrl(emailData);
  const element = React.createElement(EmailTemplate, {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient,
    confirmationUrl,
    token: emailData.token,
    email,
    oldEmail: emailData.old_email ?? email,
    newEmail: emailData.new_email ?? emailData.email,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });

  try {
    const { id } = await sendEmail({
      to: recipient,
      subject: EMAIL_SUBJECTS[emailType] || "Notification",
      html,
      text,
    });
    return jsonOk({ success: true, id });
  } catch (error) {
    console.error("Failed to send auth email", { emailType, error });
    return jsonError(500, "email_send_failed", "Failed to send email");
  }
}
