/**
 * Scrubbing an error before anybody sees it.
 *
 * Import-free so it can be tested, and it has to be, because the whole point of
 * this module is that it must not leak. An error message is assembled from
 * whatever failed, and the things that fail here carry credentials: a Supabase
 * URL with an `access_token` in the fragment, an `Authorization: Bearer` header
 * echoed back in a fetch error, an invite token, a share token, the email of
 * whoever was signed in.
 *
 * The moment an error is shown to support, written to a log or sent to a crash
 * service, every one of those is disclosed. So they are removed here, once,
 * before the error reaches any of those paths.
 *
 * **Redaction is destructive and deliberately over-eager.** A message stripped
 * of one useful detail is an inconvenience; a bearer token in a support ticket
 * is an incident.
 */

/**
 * The patterns, in the order they are applied.
 *
 * Order matters: the JWT rule has to run before the generic long-token rule, or
 * the latter mangles a JWT into something the former no longer recognises and
 * the label is wrong. Nothing leaks either way, but a useless label makes the
 * redaction look like corruption.
 */
const RULES: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    // A JSON Web Token: three base64url segments. Supabase access and refresh
    // tokens are these, and they appear in URLs and in error bodies.
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: "[jwt removed]",
  },
  {
    // `access_token=...`, `refresh_token=...`, `apikey=...`, `token=...` in a
    // query string or a fragment.
    name: "token param",
    pattern: /\b(access_token|refresh_token|apikey|api_key|token|secret|password)=[^&\s"']+/gi,
    replacement: "$1=[removed]",
  },
  {
    name: "bearer header",
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
    replacement: "Bearer [removed]",
  },
  {
    // Supabase publishable and secret keys.
    name: "supabase key",
    pattern: /\bsb_(publishable|secret)_[A-Za-z0-9_-]+/g,
    replacement: "sb_$1_[removed]",
  },
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    replacement: "[email removed]",
  },
  {
    /*
     * Anything else long enough to be a credential.
     *
     * Last, and deliberately blunt. A 32-character run of token characters in
     * an error message is far more likely to be a secret than a word. Uuids are
     * exempt below, because they are identifiers rather than credentials and
     * they are what makes an error traceable to a row.
     */
    name: "long opaque string",
    pattern: /\b[A-Za-z0-9_-]{40,}\b/g,
    replacement: "[removed]",
  },
];

/**
 * Rules that must run BEFORE uuids are lifted out.
 *
 * A share token **is** a uuid, so preserving uuids as traceable identifiers
 * made the share-link rule unfireable: by the time it ran, the token had
 * already been replaced by a placeholder and the pattern no longer matched. A
 * test caught it. Context decides whether a uuid is an identifier or a
 * credential, so the rule that reads the context has to go first.
 *
 * A share link in a support ticket is a working public link to a customer's
 * job, which is precisely what the revoke switch exists to control.
 */
const CONTEXTUAL_RULES: { name: string; pattern: RegExp; replacement: string }[] = [
  {
    name: "share link",
    pattern: /\/(share|p)\/[A-Za-z0-9_-]+\/[A-Za-z0-9-]{8,}/g,
    replacement: "/$1/[removed]",
  },
];

/** A uuid: an identifier, not a credential, and the thing that makes an error traceable. */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/**
 * The sentinel that fences a stashed uuid while the other rules run.
 *
 * U+E000, the first Private Use Area codepoint, and not NUL. NUL works exactly
 * as well as a delimiter and cannot appear in an error message, but a literal
 * control character inside a regex trips `no-control-regex` and reads as a
 * mistake to anyone who meets it. A private-use codepoint carries the same
 * guarantee - nothing legitimate emits one - without either problem.
 */
const PLACEHOLDER = "";
const PLACEHOLDER_PATTERN = /(\d+)/g;

/**
 * Remove anything that could be a credential.
 *
 * Uuids are preserved by lifting them out first and putting them back after, so
 * the blunt final rule cannot eat them. Without that, every error loses the one
 * piece of information that would let somebody find the row it happened on.
 */
export function redact(input: string): string {
  if (!input) return "";

  // Context-sensitive rules first: they read the text around a uuid, which the
  // lifting below destroys.
  let out = input;
  for (const rule of CONTEXTUAL_RULES) out = out.replace(rule.pattern, rule.replacement);

  const uuids: string[] = [];
  out = out.replace(UUID, (match) => {
    uuids.push(match);
    return `${PLACEHOLDER}${uuids.length - 1}${PLACEHOLDER}`;
  });

  for (const rule of RULES) out = out.replace(rule.pattern, rule.replacement);

  return out.replace(PLACEHOLDER_PATTERN, (_, index) => uuids[Number(index)] ?? "");
}

/** How long a stored message may be. A stack trace is not a message. */
export const MAX_MESSAGE = 500;

/**
 * An error reduced to one redacted line.
 *
 * Accepts `unknown` because that is what a `catch` gives, and every shape it
 * can be has to produce something rather than throwing inside the error
 * handler, which is the worst place for a second failure.
 */
export function describeError(error: unknown): string {
  let raw: string;
  if (error instanceof Error) {
    raw = error.message || error.name || "Error";
  } else if (typeof error === "string") {
    raw = error;
  } else if (error && typeof error === "object") {
    // API client errors carry `code` and `message`.
    const object = error as { message?: unknown; code?: unknown };
    raw =
      typeof object.message === "string"
        ? object.message
        : typeof object.code === "string"
          ? object.code
          : safeStringify(error);
  } else {
    raw = String(error);
  }

  return redact(raw).slice(0, MAX_MESSAGE);
}

/** `JSON.stringify` that survives a circular object, which a fetch error often is. */
function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(value, (_key, item) => {
      if (item && typeof item === "object") {
        if (seen.has(item as object)) return "[circular]";
        seen.add(item as object);
      }
      return item;
    });
  } catch {
    return "Unserialisable error";
  }
}

/** One recorded failure. */
export type ErrorRecord = {
  at: string;
  /** Where it happened: a screen name, an op name, "render". */
  context: string;
  message: string;
};

/**
 * How many to keep.
 *
 * Enough to show a pattern, few enough that the buffer cannot grow without
 * bound on a phone left running for a week on a bad connection.
 */
export const MAX_RECORDS = 25;

/** Add a record, dropping the oldest. Pure, so the ring behaviour is testable. */
export function pushRecord(records: ErrorRecord[], record: ErrorRecord): ErrorRecord[] {
  const next = [record, ...records];
  return next.length > MAX_RECORDS ? next.slice(0, MAX_RECORDS) : next;
}

/**
 * The text somebody reads out to support, or pastes into a ticket.
 *
 * Newest first, because the last thing that happened is the thing being asked
 * about.
 */
export function formatForSupport(records: ErrorRecord[]): string {
  if (records.length === 0) return "No errors recorded on this phone.";
  return records
    .map((record) => `${record.at}  ${record.context}\n  ${record.message}`)
    .join("\n\n");
}
