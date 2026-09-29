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
  /** What the reporter typed as the one-line summary; null on thumbs signals. */
  subject: string | null;
  description: string;
  url: string | null;
  user_agent: string | null;
  created_at: string;
  project_id: string | null;
  projectName: string | null;
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
  if (report.projectName) parts.push(`in ${report.projectName}`);
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
 * What the phone still leaves to the web console.
 *
 * Everything the web admin can do to one account, one team or one link is on
 * the phone now, each behind the same reason prompt and the same server
 * capability check. What is left is the work of a table: selecting many rows
 * at once, and reading a chart.
 */
export const WEB_ONLY_ADMIN = [
  "Bulk suspend, reinstate or resend across many selected accounts",
  "Sorting the user and team tables by column",
  "The signups chart on the overview",
];

/**
 * A feedback report in whichever shape it arrives.
 *
 * `listFeedback` sends camelCase with the reporter nested
 * (`createdAt`, `userAgent`, `reporter.id`). The phone was written against
 * snake_case columns, so every report read an empty date, "Unknown" origin and
 * "Nobody to reply to", because `user_id` was always undefined. Both shapes are
 * read here and the screen keeps its one type.
 */
export function normaliseFeedbackReport(raw: unknown): FeedbackReport {
  const r = (raw ?? {}) as Record<string, any>;
  const reporter = (r.reporter ?? {}) as Record<string, any>;
  return {
    id: String(r.id ?? ""),
    status: r.status ?? "new",
    kind: r.kind ?? "bug",
    sentiment: r.sentiment ?? null,
    source: r.source ?? null,
    feature: r.feature ?? null,
    subject: r.subject ?? null,
    description: r.description ?? "",
    url: r.url ?? null,
    user_agent: r.userAgent ?? r.user_agent ?? null,
    created_at: r.createdAt ?? r.created_at ?? "",
    project_id: r.projectId ?? r.project_id ?? null,
    projectName: r.projectName ?? null,
    user_id: reporter.id ?? r.user_id ?? null,
    email: reporter.email ?? r.email ?? null,
  };
}

/** `getFeedbackSummary` sends `byStatus`; older code read `status`. */
export function feedbackStatusCounts(raw: unknown): Partial<Record<FeedbackStatus, number>> {
  const r = (raw ?? {}) as { byStatus?: Record<string, number>; status?: Record<string, number> };
  return (r.byStatus ?? r.status ?? {}) as Partial<Record<FeedbackStatus, number>>;
}

/*
 * ---------------------------------------------------------------------------
 * The rest of the console. Mirrors the sections of the web's AdminLayout.
 * ---------------------------------------------------------------------------
 */

export type AdminSectionId =
  | "users"
  | "teams"
  | "feedback"
  | "notifications"
  | "health"
  | "usage"
  | "security"
  | "audit-log";

/** The web console's navigation, in its order, minus Overview (the hub itself). */
export const ADMIN_SECTIONS: { id: AdminSectionId; label: string; hint: string }[] = [
  { id: "users", label: "Users", hint: "Find an account, support actions, plan and access" },
  { id: "teams", label: "Teams", hint: "Plans, billing, members and projects" },
  { id: "feedback", label: "Feedback", hint: "Read, answer and move customer reports" },
  { id: "notifications", label: "Notifications", hint: "Send an in-app notice and see what went" },
  { id: "health", label: "Health", hint: "API errors, latency and scheduled jobs" },
  { id: "usage", label: "Usage and cost", hint: "AI calls, storage and estimated spend" },
  { id: "security", label: "Security", hint: "Every public share link, and revoking them" },
  { id: "audit-log", label: "Audit log", hint: "Every admin action, with its reason" },
];

/** What each admin role is for, as the web's platform access panel says it. */
export const ADMIN_ROLE_COPY: Record<"support" | "billing" | "superadmin", string> = {
  support: "Read accounts, resend email, suspend, triage feedback",
  billing: "Read accounts, change plans, comp teams, manage subscriptions",
  superadmin: "Everything, including granting admin and deleting accounts",
};

/** Mirrors the web's user status filters (`USER_STATUSES`). */
export const USER_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "unconfirmed", label: "Unconfirmed" },
  { id: "dormant", label: "Dormant" },
  { id: "no_team", label: "No team" },
  { id: "suspended", label: "Suspended" },
  { id: "admin", label: "Admins" },
] as const;

/** Mirrors the web's team status filters (`TEAM_STATUSES`). */
export const TEAM_FILTERS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "past_due", label: "Past due" },
  { id: "canceled", label: "Canceled" },
  { id: "unpaid_plan", label: "Unpaid plan" },
  { id: "internal", label: "Complimentary" },
  { id: "no_profile", label: "No profile" },
  { id: "dormant", label: "Dormant" },
] as const;

export const PLANS = ["starter", "pro", "team"] as const;
export type Plan = (typeof PLANS)[number];

/** The roles an admin may set inside a customer's team, as the web offers them. */
export const TEAM_ROLES = [
  "owner",
  "admin",
  "manager",
  "standard",
  "restricted",
  "member",
] as const;

/** The roles a new account can join a team with. Owner is transferred, never assigned. */
export const CREATABLE_TEAM_ROLES = ["admin", "manager", "standard", "restricted"] as const;

/**
 * The reason every write asks for.
 *
 * The server writes it to the audit log beside the action and the web refuses
 * anything under three characters, so the phone does the same before sending.
 */
export function reasonError(reason: string): string | null {
  return reason.trim().length < 3 ? "Give a reason of at least three characters." : null;
}

/** Bytes as a person reads them. */
export function formatBytes(bytes: number | null | undefined): string {
  const value = bytes ?? 0;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n >= 10 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** Dollars for the usage page, which estimates in USD. */
export function formatUsd(value: number | null | undefined): string {
  return `$${(value ?? 0).toFixed(2)}`;
}

/** A 0 to 1 rate as a percentage with one decimal. */
export function formatRate(rate: number | null | undefined): string {
  return `${((rate ?? 0) * 100).toFixed(1)}%`;
}

/** The web audit log's labels for each action, so the two read the same. */
const AUDIT_LABELS: Record<string, string> = {
  set_platform_admin: "Changed platform admin",
  set_admin_role: "Changed an admin role",
  send_admin_notification: "Sent a notification",
  sync_team_billing: "Synced a team's billing",
  override_team_plan: "Changed a team's plan",
  subscription_cancel_at_period_end: "Cancelled subscription at period end",
  subscription_resume: "Resumed subscription",
  subscription_cancel_now: "Cancelled subscription immediately",
  subscription_extend_trial: "Extended trial",
  revoke_share_links: "Revoked share links",
  set_user_team_role: "Changed a team role",
  export_users: "Exported the user list",
  create_user: "Created an account",
  delete_user: "Deleted an account",
  user_suspend: "Suspended an account",
  user_reinstate: "Reinstated an account",
  user_send_password_reset: "Sent a password reset",
  user_resend_confirmation: "Resent a confirmation email",
  bulk_user_suspend: "Bulk suspended accounts",
  bulk_user_reinstate: "Bulk reinstated accounts",
  bulk_user_resend_confirmation: "Bulk resent confirmations",
};

export function auditLabel(action: string): string {
  if (AUDIT_LABELS[action]) return AUDIT_LABELS[action];
  if (action.startsWith("view_")) return `Viewed a ${action.slice(5).replace(/_/g, " ")}`;
  return action.replace(/_/g, " ");
}

/** The web audit log's quick filters. */
export const AUDIT_FILTERS = [
  { id: "", label: "Everything" },
  { id: "admin", label: "Admin access" },
  { id: "plan", label: "Plans" },
  { id: "subscription", label: "Subscriptions" },
  { id: "delete", label: "Deletions" },
  { id: "revoke", label: "Revocations" },
] as const;

export const SHARE_KINDS = ["project", "showcase", "walkthrough", "walkthrough_summary"] as const;
export type AdminShareKind = (typeof SHARE_KINDS)[number];

/** A share kind in words. The `showcase` table is a portfolio page to everybody who reads this. */
export const SHARE_KIND_LABELS: Record<AdminShareKind, string> = {
  project: "Project pages",
  showcase: "Portfolio pages",
  walkthrough: "Walkthroughs",
  walkthrough_summary: "Walkthrough summaries",
};

/**
 * The notification audience, checked before the op is asked.
 *
 * "all" needs nothing else; a team or a person needs to have been picked.
 */
export function notificationError(input: {
  title: string;
  audience: "all" | "team" | "user";
  teamId: string | null;
  userId: string | null;
}): string | null {
  if (!input.title.trim()) return "Give the notification a title.";
  if (input.title.trim().length > 160) return "Keep the title under 160 characters.";
  if (input.audience === "team" && !input.teamId) return "Pick the team to send it to.";
  if (input.audience === "user" && !input.userId) return "Pick the person to send it to.";
  return null;
}

/** The typed-email check the server makes on delete, made first so a typo is caught here. */
export function deleteConfirmMatches(email: string | null, typed: string): boolean {
  return Boolean(email) && typed.trim().toLowerCase() === (email ?? "").trim().toLowerCase();
}
