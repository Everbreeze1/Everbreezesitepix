/**
 * Turning notification rows into Expo push messages.
 *
 * Import-free so every rule here is tested directly, which matters because none
 * of it can be exercised without real phones registered against real tokens.
 *
 * **Why a sweep and not a hook on insert.** Most notifications are raised by
 * database triggers, not by `insertNotification`: `task_assigned`,
 * `checklist_assigned`, every `*_completed`, `task_comment` and
 * `project_assigned` are all written in SQL by
 * `supabase/migrations/*_notifications.sql` and its successors. Server code
 * never sees them, so hooking the send into `insertNotification` would deliver
 * push for the four service-layer types and silently skip the nine that matter
 * most. Sweeping `notifications` for rows with no `push_sent_at` catches every
 * source, at the cost of the delay between runs.
 */

/** A notification row, as much of it as a push needs. */
export type PushableNotification = {
  id: string;
  recipient_id: string;
  type: string;
  title: string;
  body: string | null;
  link_path: string | null;
  project_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
};

export type RegisteredDevice = {
  token: string;
  user_id: string;
};

/**
 * One message in Expo's push format.
 *
 * @see https://docs.expo.dev/push-notifications/sending-notifications/
 */
export type ExpoMessage = {
  to: string;
  title: string;
  body?: string;
  data: Record<string, string>;
  channelId: string;
  sound: null;
  priority: "default" | "high";
};

/**
 * Expo's own cap. Sending more in one request is rejected outright rather than
 * truncated, so this is a hard limit and not a tuning knob.
 */
export const EXPO_BATCH_SIZE = 100;

/**
 * How far back a sweep will look.
 *
 * A notification nobody delivered within a day is not worth waking a phone for:
 * the person has almost certainly seen it in the inbox, and a burst of
 * yesterday's assignments arriving at once after an outage is worse than
 * silence. Old rows are still marked as handled so the sweep does not carry
 * them forever.
 */
export const PUSH_MAX_AGE_HOURS = 24;

/**
 * Which types are worth interrupting somebody for.
 *
 * Not all of them, deliberately. `task_watching` says somebody copied you in,
 * and `admin_announcement` is a broadcast: both belong in the inbox and neither
 * is worth a phone buzzing on a roof. Push is the most expensive channel the
 * product has in terms of goodwill, and the fastest way to have it turned off
 * is to spend it on things that could have waited.
 */
const PUSHABLE_TYPES = new Set([
  "task_assigned",
  "checklist_assigned",
  "workflow_assigned",
  "project_assigned",
  "photo_comment_mention",
  "task_comment",
  // The report-back on work you handed out. Worth interrupting for, because it
  // is usually the thing that unblocks whatever you do next.
  "task_completed",
  "checklist_completed",
  "workflow_completed",
]);

export function isPushable(type: string): boolean {
  return PUSHABLE_TYPES.has(type);
}

/**
 * Assignments go out at high priority; everything else waits for the next
 * window the OS offers.
 *
 * On Android, `high` wakes a dozing device and `default` may be held until the
 * next maintenance window. Somebody being given work needs to know now; being
 * told a task closed does not.
 */
function priorityOf(type: string): "default" | "high" {
  return type.endsWith("_assigned") ? "high" : "default";
}

/**
 * The routing payload.
 *
 * Exactly the notification's own columns, and that is the point: the app reads
 * them with `readPushData` and routes them through `notificationTarget`, which
 * is the same function the inbox uses. Anything invented here would be a second
 * routing scheme that could disagree with the first.
 *
 * Every value is a string because the transport flattens the payload, and empty
 * fields are dropped rather than sent as "null", which is what a naive
 * `String(value)` produces and what the app would then try to route to.
 */
function dataFor(row: PushableNotification): Record<string, string> {
  const data: Record<string, string> = { type: row.type };
  if (row.link_path) data.linkPath = row.link_path;
  if (row.project_id) data.projectId = row.project_id;
  if (row.entity_type) data.entityType = row.entity_type;
  if (row.entity_id) data.entityId = row.entity_id;
  return data;
}

/**
 * Every message to send: one per (notification, device) pair.
 *
 * A person with a phone and a tablet gets both, which is correct. A person with
 * no registered device produces nothing at all, which is why the caller must
 * still mark the row handled: otherwise every sweep reconsiders every
 * notification belonging to somebody who has never opened the app.
 */
export function expoMessagesFor(
  rows: PushableNotification[],
  devicesByUser: Map<string, RegisteredDevice[]>,
): ExpoMessage[] {
  const messages: ExpoMessage[] = [];
  for (const row of rows) {
    if (!isPushable(row.type)) continue;
    for (const device of devicesByUser.get(row.recipient_id) ?? []) {
      messages.push({
        to: device.token,
        title: row.title,
        // Omitted rather than sent empty: an empty body renders as a blank
        // second line on Android and pushes the title up awkwardly.
        ...(row.body?.trim() ? { body: row.body.trim() } : {}),
        data: dataFor(row),
        channelId: "default",
        sound: null,
        priority: priorityOf(row.type),
      });
    }
  }
  return messages;
}

/** Split into requests Expo will accept. */
export function batches<T>(items: T[], size = EXPO_BATCH_SIZE): T[][] {
  if (size < 1) return items.length ? [items] : [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** One entry in Expo's response, which is positional against the request. */
export type ExpoTicket = {
  status?: string;
  message?: string;
  details?: { error?: string };
};

/**
 * Tokens Expo says are dead, so the sweep can delete them.
 *
 * `DeviceNotRegistered` means the app was uninstalled or the token was
 * reissued, and Expo will keep rejecting it forever. Left in the table it costs
 * a slot in every future batch, which is how a push path gets slower the longer
 * it runs.
 *
 * The response is **positional**: ticket `n` belongs to message `n`. A
 * mismatched length means Expo returned something unexpected, and pairing the
 * two anyway would delete a working token because a different one failed, so
 * this returns nothing rather than guessing.
 */
export function tokensToDrop(messages: ExpoMessage[], tickets: ExpoTicket[]): string[] {
  if (tickets.length !== messages.length) return [];
  const dead: string[] = [];
  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    if (ticket?.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
      dead.push(messages[i].to);
    }
  }
  // Deduplicated: one dead token can appear in several messages in the same
  // batch when a person has several notifications waiting.
  return Array.from(new Set(dead));
}

/**
 * An Expo push token, sanity checked.
 *
 * The column is plain text and the value comes from a client, so a row can hold
 * anything. Expo rejects the whole batch on one malformed token rather than the
 * single message, so one bad row would stop every other notification in the
 * same sweep from being delivered.
 */
export function isExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token) || /^[a-zA-Z0-9_-]{20,}$/.test(token);
}

/** Group devices by who owns them, dropping anything malformed. */
export function devicesByUser(devices: RegisteredDevice[]): Map<string, RegisteredDevice[]> {
  const map = new Map<string, RegisteredDevice[]>();
  for (const device of devices) {
    if (!device.token || !isExpoToken(device.token)) continue;
    const list = map.get(device.user_id);
    if (list) list.push(device);
    else map.set(device.user_id, [device]);
  }
  return map;
}
