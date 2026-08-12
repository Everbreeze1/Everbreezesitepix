/**
 * Turn a Supabase auth error into something a customer can act on.
 *
 * Signup and login used to render `error.message` straight into a toast. That
 * message is written for developers, and on a bad day it is not a sentence at
 * all — a real signup failure in production showed the user a toast reading
 * literally `{}`, because supabase-js could not parse the error body and passed
 * the raw payload through. Others that reached users unedited:
 *
 *   "Hook requires authorization token"   (our webhook was misconfigured)
 *   "email rate limit exceeded"           (a Supabase quota, not their fault)
 *   "Database error saving new user"
 *
 * None of those tell someone what to do next, and two of them read as though
 * the customer did something wrong when the fault was entirely ours.
 *
 * Rules:
 *  - never return an empty string, `{}`, or raw JSON;
 *  - say what to do next whenever we know;
 *  - for our own infrastructure failures, apologise plainly and say "try again"
 *    rather than leaking the internal reason.
 */

const GENERIC = "Something went wrong. Please try again.";

/** Errors we recognise, matched case-insensitively against the message. */
const RULES: Array<{ match: RegExp; copy: string }> = [
  {
    match: /already registered|already been registered|user already exists/,
    copy: "That email already has an account. Try logging in instead.",
  },
  {
    match: /invalid login credentials|invalid credentials/,
    copy: "Incorrect email or password. If you signed up with Google or Apple, use that button instead — no password was set.",
  },
  {
    match: /email not confirmed|not confirmed/,
    copy: "Please confirm your email first. Check your inbox for the confirmation link.",
  },
  {
    match: /rate limit|too many requests|over_email_send/,
    copy: "Too many attempts just now. Please wait a few minutes and try again.",
  },
  {
    match: /password should be at least|password is too short|weak.?password/,
    copy: "Password must be at least 8 characters.",
  },
  {
    match: /unable to validate email|invalid email|email address.*invalid/,
    copy: "That email address doesn't look right. Please check it and try again.",
  },
  {
    match: /signups? not allowed|signup is disabled/,
    copy: "New sign-ups are currently disabled. Please contact support.",
  },
  {
    match: /same.?password|new password should be different/,
    copy: "Your new password must be different from your current one.",
  },
  {
    match: /expired|invalid.*token|token.*invalid/,
    copy: "That link has expired. Please request a new one.",
  },
  {
    /*
     * Our own infrastructure failing: the auth email hook, the database
     * trigger, or an unhandled 500. The customer cannot act on the detail and
     * naming it only alarms them, so it is logged instead of shown.
     */
    match: /hook|unexpected_failure|internal|database error|failed to send|email_send_failed/,
    copy: "We couldn't complete that just now — this one is on us. Please try again in a moment.",
  },
];

/** Extract a usable string from whatever supabase-js handed back. */
function rawMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const e = error as { message?: unknown; error_description?: unknown; msg?: unknown };
    for (const v of [e.message, e.error_description, e.msg]) {
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  return "";
}

/**
 * Human-facing copy for an auth error. `fallback` covers the case where the
 * error carries no usable message at all — which is exactly how `{}` reached a
 * user's screen.
 */
export function authErrorMessage(error: unknown, fallback: string = GENERIC): string {
  const raw = rawMessage(error).trim();

  // No message, or a message that is really a serialized object: never show it.
  if (!raw || raw === "{}" || raw === "[object Object]" || /^[[{]/.test(raw)) {
    return fallback;
  }

  const lower = raw.toLowerCase();
  for (const rule of RULES) {
    if (rule.match.test(lower)) return rule.copy;
  }

  /*
   * Unrecognised but human-looking. Show it — an unknown-but-real message beats
   * a generic one — unless it reads like a stack trace or internal identifier.
   */
  if (raw.length > 160 || /\n/.test(raw) || /^[a-z_]+$/.test(raw)) return fallback;
  return raw;
}

/** True when the error means "this account exists but isn't confirmed yet". */
export function isUnconfirmedEmail(error: unknown): boolean {
  return /not confirmed|confirm/i.test(rawMessage(error));
}
