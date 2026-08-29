/**
 * Where a notification sends you, and how it reads.
 *
 * Import-free so the routing rules can be tested directly, because the failure
 * they guard against is silent: a notification whose tap does nothing looks
 * exactly like a notification that has not finished loading.
 *
 * The awkward part is that `link_path` is written for the **web** router. The
 * triggers in `supabase/migrations/*_notifications.sql` and the API services
 * build strings like `/projects/<id>?task=<id>`, which mean nothing to
 * expo-router: there is no `/projects` route on the phone, the segment is
 * `/project/[id]`, and a task opens its own screen rather than a query param on
 * the project. Handing those strings to `router.push` navigates to a route that
 * does not exist.
 *
 * So the mapping runs off the **structured columns first** (`entity_type`,
 * `entity_id`, `project_id`), which say what the notification is about without
 * any parsing, and falls back to reading `link_path` only when they are absent.
 * That ordering matters: the columns are written by the same trigger that wrote
 * the path, they cannot drift out of sync with the web routes, and every
 * notification raised since the table was created has them.
 */

/**
 * Every value the `type` column is allowed to hold.
 *
 * Kept in step with `apps/api/src/domains/notifications/service.ts`. Widened
 * with a string fallback at the use sites rather than here, because the column
 * is plain text upstream and a new type shipped by the server should render
 * vaguely rather than crash a list.
 */
export type NotificationType =
  | "task_assigned"
  | "checklist_assigned"
  | "workflow_assigned"
  | "task_completed"
  | "checklist_completed"
  | "workflow_completed"
  | "photo_comment_mention"
  | "team_invite_accepted"
  | "admin_announcement"
  | "task_comment"
  | "task_watching"
  | "task_updated"
  | "project_assigned";

/** The fields routing needs. Deliberately narrower than the full notification. */
export type NotificationTargetInput = {
  type: string;
  linkPath: string | null;
  projectId: string | null;
  entityType: string | null;
  entityId: string | null;
};

/**
 * An expo-router destination.
 *
 * `pathname` is a route that exists in `apps/mobile/app`, and params are passed
 * separately rather than interpolated, so a value containing a slash cannot
 * invent a route segment.
 */
export type NotificationTarget = {
  pathname: string;
  params: Record<string, string>;
};

/**
 * The query string off a web link path, as plain pairs.
 *
 * Hand-rolled rather than `URLSearchParams`, which React Native ships in an
 * abbreviated form and which this module cannot import anyway. Only ever fed
 * server-written paths, so it does not need to be a general parser: it needs to
 * find `?task=` and `?photo=` and not throw on anything else.
 */
function queryOf(linkPath: string): Record<string, string> {
  const cut = linkPath.indexOf("?");
  if (cut === -1) return {};
  const out: Record<string, string> = {};
  for (const pair of linkPath.slice(cut + 1).split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (value) out[key] = decodeURIComponent(value);
  }
  return out;
}

/** The path half, with any query stripped. */
function pathOf(linkPath: string): string {
  const cut = linkPath.indexOf("?");
  return cut === -1 ? linkPath : linkPath.slice(0, cut);
}

/**
 * Reject anything that is not a plain id.
 *
 * `entity_id` is a uuid column so this can only fail on a hand-written row, but
 * an id carrying a slash would push a route segment into `pathname` and land
 * somewhere unrelated. Cheap to check, and the alternative is a navigation bug
 * that only reproduces on one row.
 */
function isPlainId(value: string | null | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !/[/?#]/.test(value);
}

/**
 * Where tapping a notification should go, or null if nowhere yet.
 *
 * Null is a real answer, not a failure: `/teams`, `/settings` and
 * `/report-issue` notifications point at surfaces the phone does not have
 * native screens for. A row with no target still reads and still marks itself
 * read; it just does not navigate, which is better than pushing a route that
 * renders blank.
 */
export function notificationTarget(n: NotificationTargetInput): NotificationTarget | null {
  const query = n.linkPath ? queryOf(n.linkPath) : {};

  // 1. The structured columns. Written by the same trigger as the path, so they
  //    cannot drift out of sync with the web routes the way a string can.
  if (isPlainId(n.entityId)) {
    switch (n.entityType) {
      case "task":
        return {
          pathname: "/task/[id]",
          // The task screen takes `projectId` as an optional hint so it can
          // render its header before the row itself has loaded.
          params: isPlainId(n.projectId)
            ? { id: n.entityId, projectId: n.projectId }
            : { id: n.entityId },
        };
      case "checklist":
        return { pathname: "/checklist/[id]", params: { id: n.entityId } };
      case "workflow":
        return { pathname: "/workflow/[id]", params: { id: n.entityId } };
      default:
        break;
    }
  }

  /*
   * 2. A comment mention. The entity is the comment, which has no screen of its
   *    own: photos are viewed in the project's lightbox. So it opens the
   *    project with the photo id, which that screen reads to open the lightbox
   *    directly on the photo somebody wrote about.
   */
  if (isPlainId(n.projectId)) {
    const params: Record<string, string> = { id: n.projectId };
    if (isPlainId(query.photo)) params.photo = query.photo;
    return { pathname: "/project/[id]", params };
  }

  // 3. Nothing structured. Read the path, which is all a hand-written or
  //    server-sent notification may carry.
  if (!n.linkPath) return null;
  const path = pathOf(n.linkPath);

  const project = /^\/projects\/([^/?#]+)$/.exec(path);
  if (project) {
    const params: Record<string, string> = { id: project[1] };
    if (isPlainId(query.photo)) params.photo = query.photo;
    if (isPlainId(query.task)) {
      // A task query beats the project it hangs off: the notification is about
      // the task, and opening its project instead makes the reader hunt.
      return { pathname: "/task/[id]", params: { id: query.task, projectId: project[1] } };
    }
    return { pathname: "/project/[id]", params };
  }

  const checklist = /^\/projects\/[^/?#]+\/checklists\/([^/?#]+)$/.exec(path);
  if (checklist) return { pathname: "/checklist/[id]", params: { id: checklist[1] } };

  return null;
}

/**
 * A semantic glyph name, not an icon component.
 *
 * Returning a component would drag `lucide-react-native` into this module and
 * cost it its import-free property, which is the only reason the routing above
 * is testable. The screen maps these six names onto icons.
 */
export type NotificationGlyph =
  | "task"
  | "checklist"
  | "workflow"
  | "comment"
  | "team"
  | "project"
  | "announcement";

export function notificationGlyph(type: string): NotificationGlyph {
  if (type.startsWith("task_")) return type === "task_comment" ? "comment" : "task";
  if (type.startsWith("checklist_")) return "checklist";
  if (type.startsWith("workflow_")) return "workflow";
  if (type === "photo_comment_mention") return "comment";
  if (type === "team_invite_accepted") return "team";
  if (type === "project_assigned") return "project";
  // Includes `admin_announcement` and anything the server adds later. The
  // column is plain text upstream, so an unknown value is possible.
  return "announcement";
}

/**
 * The accent a row carries.
 *
 * Completions are the only green ones, because they are the only notifications
 * that report work finishing rather than work arriving. Everything else is
 * neutral: colouring nine of thirteen types makes the list a rainbow and stops
 * the colour meaning anything.
 */
export function notificationTone(type: string): "success" | "primary" | "muted" {
  if (type.endsWith("_completed")) return "success";
  if (type.endsWith("_assigned")) return "primary";
  return "muted";
}

/*
 * There is no `relativeTime` here on purpose. `@everlumen/shared` already
 * exports one, the gallery and trash screens use it, and a second formatter
 * that rounds differently would have the same notification read "6d ago" in the
 * inbox and "1w ago" in the activity feed.
 */

/** How many of a page are unread. */
export function unreadCount(items: { readAt: string | null }[]): number {
  return items.filter((item) => !item.readAt).length;
}

/**
 * The optimistic patch: these ids are read as of now.
 *
 * Pure so the screen never mutates its own list in place, and so "mark all
 * read" and "open one" share the same rule. Already-read rows keep their
 * original timestamp rather than being restamped, which would reorder any list
 * sorted by when something was read.
 */
export function markedRead<T extends { id: string; readAt: string | null }>(
  items: T[],
  ids: ReadonlySet<string>,
  at: string,
): T[] {
  if (ids.size === 0) return items;
  let changed = false;
  const next = items.map((item) => {
    if (!ids.has(item.id) || item.readAt) return item;
    changed = true;
    return { ...item, readAt: at };
  });
  // Returning the same array when nothing moved lets the caller skip a render.
  return changed ? next : items;
}

/** The subtitle under the screen title. */
export function inboxSummary(total: number, unread: number): string {
  if (total === 0) return "Nothing yet";
  if (unread === 0) return `${total} notification${total === 1 ? "" : "s"}, all read`;
  return `${unread} unread of ${total}`;
}
