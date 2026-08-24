import * as React from "react";
import { render } from "@react-email/render";
import {
  SignupEmail,
  InviteEmail,
  MagicLinkEmail,
  RecoveryEmail,
  EmailChangeEmail,
  ReauthenticationEmail,
} from "@everlumen/email-templates";
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
 * secure email change turned on, changing an address fires BOTH of those - one
 * asking the old address to approve, one asking the new address to confirm -
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

const SITE_NAME = "Everlumen";
const ROOT_DOMAIN = "everlumen.co";
/*
 * Canonical origin for links we build ourselves. The apex only ever 308s to
 * www, and a redirect hop on a one-shot verification link is one more thing
 * that can go wrong, so links are minted on www directly.
 */
const APP_ORIGIN = `https://www.${ROOT_DOMAIN}`;

function redactEmail(email: string | null | undefined): string {
  if (!email) return "***";
  const [localPart, domain] = email.split("@");
  if (!localPart || !domain) return "***";
  return `${localPart[0]}***@${domain}`;
}

/**
 * Which origin the confirmation link should be minted on.
 *
 * `redirect_to` is where the user asked to end up, and GoTrue has already
 * checked it against `additional_redirect_urls` before calling this hook.
 * Reusing its origin is what keeps a locally-run or preview signup landing back
 * on the machine that started it. Anything not recognisably ours falls back to
 * production rather than being trusted, so a `redirect_to` that somehow got
 * past the allow-list still cannot move the link onto another host.
 */
function resolveAppOrigin(redirectTo?: string): string {
  if (!redirectTo) return APP_ORIGIN;
  try {
    const { hostname, origin } = new URL(redirectTo);
    const ours =
      hostname === ROOT_DOMAIN ||
      hostname.endsWith(`.${ROOT_DOMAIN}`) ||
      hostname === "localhost" ||
      hostname === "127.0.0.1";
    return ours ? origin : APP_ORIGIN;
  } catch {
    return APP_ORIGIN;
  }
}

/**
 * The in-app path to land on once the token has been exchanged.
 *
 * Only ever a relative path. `/auth/confirm` navigates to whatever this says
 * after a successful verify, so accepting an absolute URL here would turn a
 * page that every new user is guaranteed to visit into an open redirect.
 */
function resolveNext(redirectTo?: string): string | undefined {
  const path = (() => {
    try {
      const url = new URL(redirectTo!);
      return `${url.pathname}${url.search}`;
    } catch {
      return redirectTo;
    }
  })();
  if (!path || !path.startsWith("/") || path.startsWith("//")) return undefined;
  return path;
}

/**
 * Build the link the email's button points at.
 *
 * This used to point straight at GoTrue:
 *
 *     https://<ref>.supabase.co/auth/v1/verify?token=...&redirect_to=...
 *
 * which works, but has two problems. The visible one is trust: a customer
 * clicks a button in mail branded Everlumen and their address bar
 * fills with a random alphanumeric supabase.co subdomain, which is exactly what
 * they have been trained to read as phishing. The one that actually breaks
 * signups is that /verify is a single-use GET, so any link prescanner - Outlook
 * Safe Links, corporate mail AV, a spam filter fetching URLs to grade them -
 * spends the token before the human ever clicks, and the human then gets
 * "Email link is invalid or has expired" on an email they only just received.
 *
 * So the link now points at our own `/auth/confirm`, which exchanges the token
 * from the browser via `verifyOtp`. A prescanner fetching it just loads a React
 * page and spends nothing, and the only host the user ever sees is ours.
 *
 * `email_data.site_url` is deliberately unused now - it arrives pointing at the
 * GoTrue base (`https://<ref>.supabase.co/auth/v1`), never at the site, so it
 * is the wrong input for a link meant to land on our domain. It stays in the
 * type as documentation of what the hook payload carries.
 *
 * Links minted the old way keep working: GoTrue's /verify endpoint is
 * untouched, so mail already sitting in an inbox is not invalidated by this.
 */
export function buildConfirmationUrl(emailData: {
  site_url?: string;
  token_hash?: string;
  token_hash_new?: string;
  email_action_type?: string;
  redirect_to?: string;
}): string {
  /*
   * `email_change_current` / `email_change_new` are hook action types, not
   * verify types - `verifyOtp` only understands `email_change`. Passing the
   * hook type straight through produced a link the exchange rejects.
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
  const token =
    (wantsNewToken ? emailData.token_hash_new : undefined) ?? emailData.token_hash ?? "";
  const params = new URLSearchParams({
    token_hash: token,
    type: verifyType,
  });
  const next = resolveNext(emailData.redirect_to);
  if (next) params.set("next", next);
  return `${resolveAppOrigin(emailData.redirect_to)}/auth/confirm?${params.toString()}`;
}

/**
 * Everlumen Auth "Send Email" hook handler.
 * Configure hook URL: https://<host>/v1/auth/send-email
 * Secret env: AUTH_EMAIL_HOOK_SECRET
 */
export async function handleAuthSendEmail(request: Request): Promise<Response> {
  /*
   * Two accepted auth schemes, because the caller differs by environment.
   *
   * Supabase Auth's HTTP hook signs the request per Standard Webhooks and
   * sends `webhook-signature` - it never sends a bearer token. The secret it
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
   * For an email change, `user.email` is still the OLD address - the change is
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
   * found nothing - and falling back to `email_data.email` silently resolved
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

  /*
   * An email change under Supabase's "secure email change" needs BOTH addresses
   * to confirm, but GoTrue calls this hook only ONCE. It hands over two tokens
   * - `token_hash` for the current address and `token_hash_new` for the new one
   * - precisely because the integrator is expected to send both messages. We
   * sent a single email, so exactly one half was ever confirmed: `new_email`
   * stayed set, `email` never moved, and the change could not complete no
   * matter what the user did.
   *
   * Producing the message list here rather than sending inline keeps the
   * "one hook call, N emails" case explicit, and keeps the ordinary flows as a
   * single-entry list.
   */
  const isChange = emailType.startsWith("email_change");
  const bothTokens = !!emailData.token_hash && !!emailData.token_hash_new;
  const messages: Array<{ to: string; subject: string; action: string }> = [];

  if (emailType === "email_change" && bothTokens && newEmail && newEmail !== email) {
    messages.push(
      { to: email, subject: EMAIL_SUBJECTS.email_change_current, action: "email_change_current" },
      { to: newEmail, subject: EMAIL_SUBJECTS.email_change_new, action: "email_change_new" },
    );
  } else {
    messages.push({
      to: recipient,
      subject: EMAIL_SUBJECTS[emailType] || "Notification",
      action: emailType,
    });
  }

  console.log("Auth email hook", {
    emailType,
    email_redacted: redactEmail(email),
    messages: messages.map((m) => ({ action: m.action, to: redactEmail(m.to) })),
  });

  const ids: string[] = [];
  try {
    for (const m of messages) {
      // Each message gets the confirmation URL for ITS half of the change, so
      // the link in the new address's email carries token_hash_new.
      const confirmationUrl = buildConfirmationUrl({
        ...emailData,
        email_action_type: isChange ? m.action : emailType,
      });
      const element = React.createElement(EmailTemplate, {
        siteName: SITE_NAME,
        siteUrl: `https://${ROOT_DOMAIN}`,
        recipient: m.to,
        confirmationUrl,
        token: emailData.token,
        email,
        oldEmail: emailData.old_email ?? email,
        newEmail: newEmail ?? emailData.email,
      });
      const html = await render(element);
      const text = await render(element, { plainText: true });
      const { id } = await sendEmail({ to: m.to, subject: m.subject, html, text });
      ids.push(id);
    }
    return jsonOk({ success: true, id: ids[0], ids });
  } catch (error) {
    console.error("Failed to send auth email", { emailType, sent: ids.length, error });
    return jsonError(500, "email_send_failed", "Failed to send email");
  }
}
