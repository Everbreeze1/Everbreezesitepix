export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

/** The name recipients should see in their inbox, not the mailbox it came from. */
const SENDER_NAME = "Everbreeze SitePix";

/**
 * Guarantee the From header carries a display name.
 *
 * `EMAIL_FROM` was a bare `info@everbreezesitepix.com`, and a bare address makes
 * every mail client fall back to the local part — so invites, password resets
 * and field reports all arrived from a sender called **"info"**. Wrapping it
 * once here fixes every email at the same time, and keeps working if the env is
 * ever set back to a bare address.
 *
 * An `EMAIL_FROM` that already has a display name (`Name <addr>`) is passed
 * through untouched, so the env stays authoritative when it says something.
 */
function withSenderName(from: string): string {
  const trimmed = from.trim();
  // Already `Something <addr@host>` — respect it.
  if (/^[^<>]*<[^<>]+>$/.test(trimmed)) return trimmed;
  // Bare address. Quote the name so punctuation can never break the header.
  return `"${SENDER_NAME.replace(/"/g, "")}" <${trimmed}>`;
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
  const from = withSenderName(configuredFrom);

  const replyTo = input.replyTo ?? process.env.EMAIL_REPLY_TO;

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
