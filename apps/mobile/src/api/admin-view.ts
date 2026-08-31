/**
 * The platform admin console, as rules.
 *
 * Import-free so it can be tested.
 *
 * **What this is on a phone, and what it is not.** The web console is twelve
 * routes: users, teams, usage, audit log, security, health, notifications,
 * feedback, and detail pages under several of them. Most of that is
 * administration done deliberately at a desk, and putting it on a phone would
 * be building a way to delete a customer's account with a thumb on a train.
 *
 * So the phone gets **triage, not administration**: read the feedback queue,
 * move a report on, answer it, and check the system is up. Every one of those
 * is a thing a staff member wants away from a desk. Everything irreversible
 * (deleting a user, granting platform admin, overriding a plan) stays on the
 * web on purpose, and the screen says so rather than leaving somebody hunting
 * for it.
 */

/** Mirrors `FEEDBACK_STATUSES` in `apps/api/src/domains/admin/feedback.ts`. */
export type FeedbackStatus = "new" | "triaged" | "resolved" | "dismissed";
export const FEEDBACK_STATUSES: FeedbackStatus[] = ["new", "triaged", "resolved", "dismissed"];

export type FeedbackKind = "bug" | "idea" | "praise";

/** A report as `listFeedback` returns it. Field names are the service's. */
export type FeedbackReport = {
  id: string;
  status: FeedbackStatus | string;
  kind: FeedbackKind | string;
  sentiment: string | null;
  source: string | null;
  feature: string | null;
  description: string;
  url: string | null;
  user_agent: string | null;
  created_at: string;
  project_id: string | null;
  user_id: string | null;
  email: string | null;
};

/**
 * What each status means to the person who filed the report.
 *
 * Named from the reporter's side, not the queue's. "Triaged" is internal
 * vocabulary; "we have read it" is what the label is actually telling somebody.
 */
export const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: "Not looked at",
  triaged: "Read, not fixed",
  resolved: "Fixed or answered",
  dismissed: "Closed without a change",
};

export function normaliseStatus(value: string | null | undefined): FeedbackStatus {
  return FEEDBACK_STATUSES.includes(value as FeedbackStatus) ? (value as FeedbackStatus) : "new";
}

/**
 * The statuses worth moving a report to from here.
 *
 * All four, including back to `new`. The service deliberately does **not**
 * notify the reporter when something moves back to `new` (see `STATUS_NOTICE`),
 * because that is the queue correcting itself and telling somebody their fixed
 * bug is unfixed on the strength of a misclick is worse than saying nothing.
 * That asymmetry belongs to the server; the phone just offers the move.
 */
export function nextStatuses(current: FeedbackStatus): FeedbackStatus[] {
  return FEEDBACK_STATUSES.filter((status) => status !== current);
}

/**
 * Whether a reply can reach anybody.
 *
 * `replyToFeedback` delivers as a notification, not email, because the reporter
 * may have typed no address at all. A report filed from a signed-out session
 * has no `user_id`, so there is nobody to notify and the service treats that as
 * an error. Saying so before the tap is better than a failure afterwards.
 */
export function canReply(report: Pick<FeedbackReport, "user_id">): boolean {
  return Boolean(report.user_id);
}

export function replyError(message: string): string | null {
  const value = message.trim();
  if (!value) return "Write something to send back.";
  // The op caps at 1000.
  if (value.length > 1000) return "Keep the reply under 1000 characters.";
  return null;
}

/**
 * Where a report came from, in one line.
 *
 * The `user_agent` a mobile report carries is composed by the app itself
 * (`EverlumenApp v0.1.0 (android 14) Pixel 7`), so this reads it back rather
 * than parsing a browser string: knowing a bug is phone-only is usually the
 * first useful fact about it.
 */
export function reportOrigin(report: Pick<FeedbackReport, "user_agent" | "url">): string {
  const ua = report.user_agent ?? "";
  if (ua.startsWith("EverlumenApp")) {
    // Everything after the app name and version is the device.
    return ua.replace(/^EverlumenApp\s*(v\S+)?\s*/, "").trim() || "The app";
  }
  if (report.url?.startsWith("app://")) return "The app";
  return ua ? "A browser" : "Unknown";
}

/** The line under a report in the queue. */
export function reportSummary(report: FeedbackReport): string {
  const parts = [STATUS_LABELS[normaliseStatus(report.status)], reportOrigin(report)];
  if (report.feature) parts.push(report.feature);
  return parts.join(" · ");
}

/**
 * The queue's own headline.
 *
 * Counts what is waiting rather than the total, because a staff member opening
 * this wants to know whether anything needs them, not how many reports have
 * ever existed.
 */
export function queueHeadline(counts: Partial<Record<FeedbackStatus, number>>): string {
  const waiting = counts.new ?? 0;
  if (waiting === 0) return "Nothing waiting";
  return `${waiting} not looked at`;
}

/**
 * What a phone deliberately will not do.
 *
 * Listed so the screen can say it, rather than a staff member concluding the
 * console is half-built. Every one of these is irreversible or a configuration
 * change, and a phone is the wrong place for both.
 */
export const WEB_ONLY_ADMIN = [
  "Deleting a user or a workspace",
  "Granting or removing platform admin",
  "Overriding a workspace's plan",
  "The audit log and security pages",
];
