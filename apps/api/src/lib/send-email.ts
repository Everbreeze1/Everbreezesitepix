export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  /**
   * Display name for this one message, overriding both `SENDER_NAME` and any
   * display name already baked into `EMAIL_FROM`. The address itself never
   * changes - only a verified domain can send, and this must not become a way
   * to forge one.
   *
   * Used for the "Someone (via Everlumen)" pattern on person-to-person
   * mail like team invites: a human name in the From line is what separates a
   * message from a broadcast, both to the reader and to Gmail's tab classifier.
   */
  fromName?: string;
  replyTo?: string;
};

/** The name recipients should see in their inbox, not the mailbox it came from. */
const SENDER_NAME = "Everlumen";

/**
 * Make a caller-supplied display name safe to put in a header.
 *
 * `fromName` comes from `profiles.full_name`, which any user can type. CR/LF
 * would let them append headers of their own; `"` `<` `>` would let them break
 * out of the quoted phrase; a bare `@` lets them write a name that renders as
 * somebody else's address ("security@paypal.com") in every inbox preview.
 */
function sanitizeDisplayName(name: string): string {
  return name
    .replace(/[\r\n]+/g, " ")
    .replace(/["<>@]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/** The bare `addr@host` out of either `addr@host` or `Name <addr@host>`. */
function addressOf(from: string): string {
  const angled = from.match(/^[^<>]*<([^<>]+)>$/);
  return (angled ? angled[1] : from).trim();
}

/**
 * Guarantee the From header carries a display name.
 *
 * `EMAIL_FROM` was a bare `info@everlumen.co`, and a bare address makes
 * every mail client fall back to the local part - so invites, password resets
 * and field reports all arrived from a sender called **"info"**. Wrapping it
 * once here fixes every email at the same time, and keeps working if the env is
 * ever set back to a bare address.
 *
 * An `EMAIL_FROM` that already has a display name (`Name <addr>`) is passed
 * through untouched, so the env stays authoritative when it says something -
 * unless this call asked for a specific `fromName`, which is more specific than
 * either default and wins over both.
 */
function withSenderName(from: string, fromName?: string): string {
  const trimmed = from.trim();
  const override = fromName ? sanitizeDisplayName(fromName) : "";
  // Per-message name. Rebuild around the env's address, never the caller's.
  if (override) return `"${override}" <${addressOf(trimmed)}>`;
  // Already `Something <addr@host>` - respect it.
  if (/^[^<>]*<[^<>]+>$/.test(trimmed)) return trimmed;
  // Bare address. Quote the name so punctuation can never break the header.
  return `"${SENDER_NAME.replace(/"/g, "")}" <${trimmed}>`;
}

/**
 * Reply-To is likewise user-adjacent (a teammate's own address on invites), so
 * it is reduced to a bare `addr@host` - `Name <addr@host>` is unwrapped rather
 * than rejected, since that is a perfectly ordinary `EMAIL_REPLY_TO` - and
 * anything that still does not look like one address is dropped rather than
 * forwarded to Resend. A malformed reply address is worth losing; a smuggled
 * header is not.
 */
function safeReplyTo(replyTo: string | undefined): string | undefined {
  if (!replyTo) return undefined;
  const address = addressOf(replyTo.replace(/[\r\n]+/g, " "));
  return /^[^\s<>",;@]+@[^\s<>",;@]+\.[^\s<>",;@]+$/.test(address) ? address : undefined;
}

export async function sendEmail(input: SendEmailInput): Promise<{ id: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured");
  }

  const configuredFrom = input.from ?? process.env.EMAIL_FROM;
  if (!configuredFrom) {
    throw new Error("EMAIL_FROM is not configured");
  }
  const from = withSenderName(configuredFrom, input.fromName);

  const replyTo = safeReplyTo(input.replyTo ?? process.env.EMAIL_REPLY_TO);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: input.subject,
      html: input.html,
      text: input.text,
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend error (${res.status}): ${body.slice(0, 300)}`);
  }

  const json = (await res.json()) as { id?: string };
  return { id: json.id ?? crypto.randomUUID() };
}
