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
  reauthentication: "Your verification code",
};

const EMAIL_TEMPLATES: Record<string, React.ComponentType<any>> = {
  signup: SignupEmail,
  invite: InviteEmail,
  magiclink: MagicLinkEmail,
  recovery: RecoveryEmail,
  email_change: EmailChangeEmail,
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

function buildConfirmationUrl(emailData: {
  site_url?: string;
  token_hash?: string;
  email_action_type?: string;
  redirect_to?: string;
}): string {
  const siteUrl = (emailData.site_url ?? `https://${ROOT_DOMAIN}`).replace(
    /\/$/,
    "",
  );
  const params = new URLSearchParams({
    token: emailData.token_hash ?? "",
    type: emailData.email_action_type ?? "signup",
  });
  if (emailData.redirect_to) params.set("redirect_to", emailData.redirect_to);
  return `${siteUrl}/auth/v1/verify?${params.toString()}`;
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

  if (!email || !emailType) {
    return jsonError(400, "invalid_payload", "Invalid payload");
  }

  const EmailTemplate = EMAIL_TEMPLATES[emailType];
  if (!EmailTemplate) {
    return jsonError(400, "unknown_email_type", `Unknown email type: ${emailType}`);
  }

  console.log("Auth email hook", {
    emailType,
    email_redacted: redactEmail(email),
  });

  const confirmationUrl = buildConfirmationUrl(emailData);
  const element = React.createElement(EmailTemplate, {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    recipient: email,
    confirmationUrl,
    token: emailData.token,
    email,
    oldEmail: emailData.old_email ?? emailData.email,
    newEmail: emailData.new_email ?? emailData.email,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });

  try {
    const { id } = await sendEmail({
      to: email,
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
