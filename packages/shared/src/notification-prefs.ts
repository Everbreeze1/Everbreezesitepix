/**
 * What a person has said they want in their inbox.
 *
 * There has been a Notifications screen in Settings since the first build, with
 * an "Email notifications" master switch and four topic rows. Every one of them
 * was written to `localStorage`, which the server cannot read - so the switches
 * described a preference nothing consulted. That was harmless while nothing was
 * sent. Task assignment email makes it a real problem: a crew member who turns
 * email off keeps getting it, and the only remaining option is the spam button,
 * which costs the sending domain far more than the message was worth.
 *
 * So the preference moves to `profiles.notification_prefs`, and this module is
 * the single description of it. The Settings screen and the email sender both
 * import from here, because a preference the UI and the sender describe
 * differently is the same bug in a new place.
 *
 * === THE DEFAULT IS ON, AND ABSENCE MEANS DEFAULT =========================
 * Stored as a sparse object: a key is written only when somebody changes it.
 * An empty `{}` therefore means "never touched anything", which every existing
 * account is, and reads as every default. That is what keeps a migration from
 * silently unsubscribing the whole customer base, and it is why `emailAllowed`
 * asks `=== false` rather than trusting the value to be there.
 *
 * These are transactional messages about work somebody was handed, so on is the
 * right default. The switch exists because it has to, not because most people
 * should need it.
 */

/** Every preference the product actually acts on. */
export interface NotificationPrefs {
  /** Master switch. Off means no email of any kind. */
  emailEnabled?: boolean;
  /** A task was assigned to you. */
  taskAssigned?: boolean;
  /** Somebody wrote on, or mentioned you in, a task you are on. */
  taskComments?: boolean;
  /** A task you are copied in on was reassigned or closed. */
  taskUpdates?: boolean;
  /** Work you handed to somebody else was completed. */
  taskCompleted?: boolean;
}

export const NOTIFICATION_PREF_DEFAULTS: Required<NotificationPrefs> = {
  emailEnabled: true,
  taskAssigned: true,
  taskComments: true,
  taskUpdates: true,
  taskCompleted: true,
};

export type NotificationPrefKey = keyof NotificationPrefs;

/**
 * Which switch governs which notification type.
 *
 * A type that is not in this map is governed by the master switch alone. That
 * is deliberate rather than an oversight: a new notification type should reach
 * people by default and get its own row here when somebody decides it deserves
 * one, not be silently ungovernable OR silently suppressed.
 */
export const NOTIFICATION_TYPE_PREF: Record<string, NotificationPrefKey> = {
  task_assigned: "taskAssigned",
  task_comment: "taskComments",
  task_updated: "taskUpdates",
  task_watching: "taskUpdates",
  task_completed: "taskCompleted",
};

/** Read one switch, with absence meaning the default rather than off. */
export function prefEnabled(
  prefs: NotificationPrefs | null | undefined,
  key: NotificationPrefKey,
): boolean {
  const value = prefs?.[key];
  return value === undefined ? NOTIFICATION_PREF_DEFAULTS[key] : value !== false;
}

/**
 * May this notification type be emailed to this person?
 *
 * The master switch first, then the topic. Both have to allow it, which is what
 * makes "turn email off" mean what it says regardless of what the topic rows
 * happen to be set to.
 */
export function emailAllowed(
  prefs: NotificationPrefs | null | undefined,
  notificationType: string,
): boolean {
  if (!prefEnabled(prefs, "emailEnabled")) return false;
  const key = NOTIFICATION_TYPE_PREF[notificationType];
  return key ? prefEnabled(prefs, key) : true;
}

/**
 * Whatever came out of the database, narrowed to something safe to read.
 *
 * `jsonb` can hold anything, including a value written by an older build of the
 * app or by somebody poking at their own row. Unknown keys are dropped and
 * non-boolean values are ignored, so a malformed column reads as "no
 * preferences expressed" rather than as an accidental unsubscribe.
 */
export function parseNotificationPrefs(raw: unknown): NotificationPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const out: NotificationPrefs = {};
  for (const key of Object.keys(NOTIFICATION_PREF_DEFAULTS) as NotificationPrefKey[]) {
    if (typeof source[key] === "boolean") out[key] = source[key] as boolean;
  }
  return out;
}
