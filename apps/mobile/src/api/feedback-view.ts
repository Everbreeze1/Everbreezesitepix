/**
 * Reporting a problem from the field, as rules.
 *
 * Import-free so it can be tested.
 *
 * The column names here are **not guessed**, and they could not be verified the
 * way the others were: `issue_reports` revokes `anon`, and PostgREST checks
 * permissions before columns, so probing it returns `42501` whatever you ask
 * for. The authority is `apps/web/src/lib/feedback.ts`, which writes this table
 * today and carries its own scar in a comment: the text column is
 * `description`, **not** `message`, whatever the generated types once claimed.
 */

/** Mirrors `FeedbackKind` on the web. */
export type FeedbackKind = "bug" | "idea" | "praise";

export const KINDS: { id: FeedbackKind; label: string; hint: string }[] = [
  { id: "bug", label: "Something is broken", hint: "It did the wrong thing, or nothing" },
  { id: "idea", label: "Something is missing", hint: "It works, but it should also do this" },
  { id: "praise", label: "Something is good", hint: "Worth knowing what to keep" },
];

/** The table's text column is capped; the web slices to the same length. */
export const MAX_DESCRIPTION = 4000;

export function messageError(message: string): string | null {
  const value = message.trim();
  if (!value) return "Say what happened.";
  /*
   * A floor, not just a cap. "broken" is a report nobody can act on, and the
   * person who sent it has spent their goodwill without getting a fix. Asking
   * for one more sentence at the point of writing costs less than a round trip
   * through support.
   */
  if (value.length < 10) return "A sentence or two, so somebody can act on it.";
  return null;
}

/** Trimmed and capped to what the column takes. */
export function cleanDescription(message: string): string {
  return message.trim().slice(0, MAX_DESCRIPTION);
}

/** The subject column's cap, from 20261008000000. The web slices to the same. */
export const MAX_SUBJECT = 160;

/**
 * Bugs carry a one-line subject so the queue can be scanned; ideas and praise
 * are filed without one, exactly as the web submits them.
 */
export function cleanSubject(kind: FeedbackKind, subject: string): string | null {
  if (kind !== "bug") return null;
  const trimmed = subject.trim();
  return trimmed ? trimmed.slice(0, MAX_SUBJECT) : null;
}

/** Why Send is held back, said before the tap rather than after a failure. */
export function subjectError(kind: FeedbackKind, subject: string): string | null {
  if (kind !== "bug") return null;
  if (!subject.trim()) return "Add a one-line subject, so the queue can be scanned.";
  return null;
}

// ---------------------------------------------------------------------------
// Attachments
//
// Mirrors apps/web/src/lib/feedback.ts and the 20260921000000 migration. The
// web page has attached screenshots since that migration; the phone could not,
// and it was the one surface where a bug - a camera, a screen, a capture flow -
// is most likely to need a picture. One `issue_reports.attachments` column and
// one storage bucket are shared by both clients, so the paths written here have
// to be the paths the admin console is already built to read: filenames are
// recovered by stripping `{epoch_ms}-{n}-` off paths of the shape below, and
// anything else either renders with a wrong caption or not at all.
// ---------------------------------------------------------------------------

/** Matches FEEDBACK_BUCKET in apps/web/src/lib/feedback.ts. */
export const FEEDBACK_BUCKET = "feedback-attachments";

/** As the web: enough for a report, not enough to bury the text. */
export const MAX_ATTACHMENTS = 3;

/** Matches MAX_ATTACHMENT_BYTES on the web and the bucket's file_size_limit. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/** The image types the bucket accepts, in its own words (20260921000000). */
const ATTACHMENT_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

/** Accepted as a fallback, because a picker can hand back a file with no MIME type. */
const ATTACHMENT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp"]);

/** One picked image, before it is uploaded. */
export type PickedAttachment = {
  /** Local URI, which is also what the thumbnail renders. */
  uri: string;
  name: string;
  sizeBytes: number;
  mimeType: string;
};

/** Why a picked image should not be listed as attached. */
export type AttachmentIssue =
  | { kind: "duplicate"; name: string }
  | { kind: "type"; name: string }
  | { kind: "size"; name: string; sizeBytes: number }
  | null;

/**
 * Whether a picked file passes the bucket's MIME allow-list, by MIME or by
 * extension. A declared MIME type is authoritative - the upload carries it, and
 * the bucket matches on it, so `image/heic` must be turned away even when the
 * filename happens to end in `.png`. The extension only fills in for the
 * pickers that leave the MIME type blank.
 */
export function acceptsAttachmentType(mimeType: string, name: string): boolean {
  if (mimeType) return ATTACHMENT_MIME_TYPES.has(mimeType);
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return ATTACHMENT_EXTENSIONS.has(ext);
}

/**
 * Why a picked image should not be attached, or null when it can be.
 *
 * The same three guards the web applies at pick time. All of them exist because
 * a file the bucket will reject must be turned away *here*, when it can still
 * be fixed or swapped, and not discovered at send time as a prop on a report
 * that has already gone out without it.
 */
export function attachmentIssue(candidate: PickedAttachment, existing: PickedAttachment[]): AttachmentIssue {
  if (existing.some((f) => f.name === candidate.name && f.sizeBytes === candidate.sizeBytes)) {
    return { kind: "duplicate", name: candidate.name };
  }
  if (!acceptsAttachmentType(candidate.mimeType, candidate.name)) {
    return { kind: "type", name: candidate.name };
  }
  if (candidate.sizeBytes > MAX_ATTACHMENT_BYTES) {
    return { kind: "size", name: candidate.name, sizeBytes: candidate.sizeBytes };
  }
  return null;
}

/**
 * The storage path, exactly as the web writes it: `{auth_uid}/{epoch_ms}-{n}-{safe-name}`.
 *
 * The API's `attachmentName` strips a `^\d{10,}-\d+-` prefix to recover the
 * reporter's filename, so the timestamp and the index are not decoration; they
 * are what triage's captions are computed from. Keeping the same digits means a
 * mobile report's screenshot renders on the admin console exactly where a web
 * report's does.
 */
export function attachmentPath(userId: string, stamp: number, index: number, fileName: string): string {
  const clean = fileName
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gi, "-")
    .replace(/^-+|-+$/g, "");
  const safe = (clean || "attachment").slice(-80);
  return `${userId}/${stamp}-${index}-${safe}`;
}

/** Human file size for the list. Mirrors the web's formatBytes. */
export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const v = bytes / Math.pow(1024, i);
  return `${v >= 10 || i === 0 ? v.toFixed(0) : v.toFixed(1)} ${units[i]}`;
}

/**
 * What the phone knows about itself, for the report.
 *
 * The web reads this from `navigator` and `window.location`. A phone has
 * neither, so the equivalents are the platform, the OS version, the model and
 * the screen the person was on. All of it is read rather than typed, because a
 * reporter should not have to know their own Android version to be helped.
 *
 * Nothing here identifies a person. The device model and OS version are the
 * two facts that actually decide whether a bug reproduces.
 */
export type DeviceContext = {
  platform: string;
  osVersion: string | null;
  model: string | null;
  appVersion: string | null;
  screen: string | null;
};

/**
 * The `user_agent` string, built to look like what the column already holds.
 *
 * The column is `text` and the web puts a browser UA in it. A phone has none,
 * so this composes an equivalent rather than leaving it null: an admin reading
 * the queue should not have to work out from an empty column that a report came
 * from the app.
 *
 * Capped at 500 to match the web's slice.
 */
export function deviceUserAgent(context: DeviceContext): string {
  const parts = [
    "EverlumenApp",
    context.appVersion ? `v${context.appVersion}` : null,
    `(${context.platform}${context.osVersion ? ` ${context.osVersion}` : ""})`,
    context.model,
  ].filter(Boolean);
  return parts.join(" ").slice(0, 500);
}

/**
 * Recent errors, folded into the report body.
 *
 * This is the reason `error-redaction.ts` exists. A crew member reporting "the
 * team screen did not work" cannot say what the error was, and until now
 * nothing on the phone could either. Attaching the last few redacted failures
 * turns an unactionable report into one with the actual message in it.
 *
 * **Every record is already redacted**, once, by `reportError` on the way in.
 * Nothing here re-redacts, and nothing here may accept an unredacted string:
 * this text is written to a table support reads.
 */
export function appendErrorLog(description: string, log: string, include: boolean): string {
  if (!include || !log.trim()) return description;
  return `${description}\n\n--- Recent errors on this phone ---\n${log}`.slice(0, MAX_DESCRIPTION);
}

/**
 * The row to insert.
 *
 * Deliberately mirrors `baseRow` in `apps/web/src/lib/feedback.ts` field for
 * field. Two clients writing one table with different column names is how the
 * `description` / `message` confusion happened in the first place.
 */
export function feedbackRow(input: {
  kind: FeedbackKind;
  description: string;
  userId: string | null;
  email: string | null;
  screen: string | null;
  context: DeviceContext;
}) {
  return {
    user_id: input.userId,
    email: input.email,
    // `description`, not `message`. See the note at the top of this file.
    description: input.description.slice(0, MAX_DESCRIPTION),
    kind: input.kind,
    // The surface the report is about, which is the axis the admin queue groups
    // by. On a phone that is the route rather than a URL.
    feature: input.screen,
    sentiment: input.kind === "praise" ? "good" : input.kind === "bug" ? "bad" : null,
    source: "page" as const,
    url: input.screen ? `app://${input.screen.replace(/^\//, "")}` : null,
    user_agent: deviceUserAgent(input.context),
  };
}

/** The optional columns, which a database mid-migration may not have yet. */
export function feedbackExtras(input: {
  projectId: string | null;
  context: DeviceContext;
  attachments: string[];
}) {
  return {
    project_id: input.projectId,
    client_info: input.context as unknown as Record<string, unknown>,
    // Null when nothing was attached, as the web inserts it - an empty array
    // and a missing one must not read differently.
    attachments: input.attachments.length ? input.attachments : null,
  };
}

/**
 * The context as text, for the retry.
 *
 * Migrations here are applied by hand, so there is a real window in which
 * `client_info` and `project_id` are not on the table yet. The web hit exactly
 * this and solved it the same way: retry with the long-standing columns only,
 * and fold the structured context into the body. Losing a bug report to a
 * missing column would be the worst possible failure for the one feature whose
 * entire job is receiving them.
 */
export function contextAsText(
  context: DeviceContext,
  projectId: string | null,
  attachments: string[] = [],
): string {
  const lines = [
    `Platform: ${context.platform}${context.osVersion ? ` ${context.osVersion}` : ""}`,
    context.model ? `Device: ${context.model}` : null,
    context.appVersion ? `App: ${context.appVersion}` : null,
    context.screen ? `Screen: ${context.screen}` : null,
    projectId ? `Project: ${projectId}` : null,
    attachments.length ? `Attachments: ${attachments.join(", ")}` : null,
  ].filter(Boolean);
  return `\n\n--- From the app ---\n${lines.join("\n")}`;
}
