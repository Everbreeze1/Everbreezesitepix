import { z } from "zod";
import {
  emailAllowed,
  formatCalendarDate,
  parseNotificationPrefs,
  type NotificationPrefs,
} from "@everlumen/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ServiceContext } from "../../lib/user-context";
import { getSupabaseAdmin } from "../../lib/supabase";
import { sendTaskNotificationEmail } from "../email/task-notification";

/**
 * The collaboration layer on a task: who is copied in, what has been said, and
 * getting either of those out of the app and into somebody's inbox.
 *
 * The task record itself is still written straight from the browser through the
 * Supabase client, as it always has been - this domain does not take that over.
 * What it owns is the three things a browser cannot do:
 *
 *   1. send email (no outbound HTTP from Postgres, no API key in a browser)
 *   2. read a teammate's email address (`profiles` RLS is own-row only, which
 *      is the whole reason `use-team-members` exists)
 *   3. stamp `notifications.emailed_at`, which the client has no grant on
 *
 * Everything else - who is owed a notification, and what it says - is decided by
 * the triggers in 20260915000000_task_collaboration.sql. This file delivers what
 * they wrote down; it does not second-guess it. That split is what stops the
 * bell and the inbox from disagreeing about who was told.
 */

const DEFAULT_ORIGIN = "https://everlumen.co";

/**
 * How far back the sender will look for undelivered notifications.
 *
 * The dispatch call is made by the browser right after a write, so anything it
 * is responsible for is seconds old. The window exists so a page left open, a
 * retried request or a slow round trip still catches its own notification -
 * and so a notification from last Tuesday that never got mailed does not
 * suddenly arrive because somebody reopened the task.
 */
const DELIVERY_WINDOW_MS = 10 * 60 * 1000;

/** Per call. A task with more watchers than this is not a thing that exists. */
const MAX_EMAILS_PER_DISPATCH = 25;

type ProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  due_date: string | null;
  assignee_user_id: string | null;
  assigned_by: string | null;
  created_by: string;
};

const TASK_COLUMNS =
  "id, project_id, title, description, status, priority, due_date, assignee_user_id, assigned_by, created_by";

export interface TaskComment {
  id: string;
  taskId: string;
  projectId: string;
  authorId: string;
  authorName: string | null;
  authorEmail: string | null;
  authorAvatarUrl: string | null;
  body: string;
  mentions: string[];
  createdAt: string;
}

export interface TaskWatcher {
  userId: string;
  addedBy: string | null;
  createdAt: string;
  fullName: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Names and avatars for a set of user ids.
 *
 * Through the admin client, exactly as `photos/comments.ts` does it and for the
 * same reason: `profiles` has one SELECT policy, own-row, so a caller-scoped
 * read would return the caller and nobody else. Only the four columns the Teams
 * page already shows every member are selected - `profiles` also carries the
 * owner's company address and phone, and widening this to `*` would leak them
 * into a comment thread.
 */
async function profilesById(
  ids: Array<string | null | undefined>,
): Promise<Map<string, ProfileRow>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)));
  const map = new Map<string, ProfileRow>();
  if (unique.length === 0) return map;
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("profiles" as never)
    .select("id, full_name, email, avatar_url")
    .in("id", unique);
  for (const row of (data ?? []) as ProfileRow[]) map.set(row.id, row);
  return map;
}

/**
 * The recipients' own notification switches.
 *
 * A separate read rather than another column on `profilesById`, for two
 * reasons. It is only ever wanted on the email path - the comment thread and
 * the watcher chips have no business carrying somebody's preferences - and it
 * has to survive a database where 20260916000000 has not been applied yet.
 * Migrations here are pasted into the SQL editor by hand, so code lands before
 * the column does, and a `select` naming a missing column fails the whole
 * statement.
 *
 * On any failure this returns nothing, and `emailAllowed` then reads every
 * recipient as "no preference expressed", which is the default: on. Failing
 * open is the correct direction for a transactional message about work
 * somebody was handed - the alternative is a missing column silently
 * unsubscribing the whole workspace.
 */
async function notificationPrefsById(
  admin: SupabaseClient,
  ids: string[],
): Promise<Map<string, NotificationPrefs>> {
  const map = new Map<string, NotificationPrefs>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return map;
  const { data, error } = await admin
    .from("profiles" as never)
    .select("id, notification_prefs")
    .in("id", unique);
  if (error) {
    if (!/notification_prefs/.test(error.message)) {
      console.error("[tasks] could not read notification preferences", error.message);
    }
    return map;
  }
  for (const row of (data ?? []) as Array<{ id: string; notification_prefs: unknown }>) {
    map.set(row.id, parseNotificationPrefs(row.notification_prefs));
  }
  return map;
}

function displayName(profile: ProfileRow | undefined | null): string | null {
  const name = profile?.full_name?.trim();
  return name || profile?.email || null;
}

/**
 * The task, read through the CALLER's client so RLS answers "may you see this".
 *
 * Every entry point below starts here. A uuid in a request body is not proof of
 * anything, and the admin client used further down would happily read any task
 * in the database.
 */
async function requireVisibleTask(ctx: ServiceContext, taskId: string): Promise<TaskRow> {
  const { data, error } = await ctx.supabase
    .from("tasks" as never)
    .select(TASK_COLUMNS)
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Task not found");
  return data as unknown as TaskRow;
}

/* ------------------------------------------------------------------ email */

const PRIORITY_LABEL: Record<string, string | null> = {
  low: null,
  normal: null,
  high: "High",
  urgent: "Urgent",
};

/**
 * Deliver, by email, whatever the triggers decided was owed.
 *
 * Driven off the `notifications` rows rather than off the event, which is what
 * makes it idempotent and what keeps the two channels honest with each other:
 *
 *   - a row already stamped `emailed_at` is skipped, so calling this twice for
 *     one assignment sends one email
 *   - a recipient the triggers excluded (you assigned it to yourself; you are
 *     the watcher who closed it) has no row, so no mail is invented for them
 *   - a notification type added later is delivered without touching this file
 *
 * Failures are swallowed per recipient. A mail provider being down must not
 * roll back an assignment that has already happened, and the in-app
 * notification is still sitting in the bell either way.
 */
async function deliverPendingEmails(
  admin: SupabaseClient,
  task: TaskRow,
  entityIds: string[],
  opts: { origin: string },
): Promise<{ sent: number; suppressed: number }> {
  if (entityIds.length === 0) return { sent: 0, suppressed: 0 };

  const since = new Date(Date.now() - DELIVERY_WINDOW_MS).toISOString();
  const { data: rows, error } = await admin
    .from("notifications" as never)
    .select("id, recipient_id, actor_id, type, title, body, link_path")
    .in("entity_id", entityIds)
    .is("emailed_at", null)
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(MAX_EMAILS_PER_DISPATCH);
  if (error) throw new Error(error.message);

  const pending = (rows ?? []) as Array<{
    id: string;
    recipient_id: string;
    actor_id: string | null;
    type: string;
    title: string;
    body: string | null;
    link_path: string | null;
  }>;
  if (pending.length === 0) return { sent: 0, suppressed: 0 };

  const [people, prefs] = await Promise.all([
    profilesById([...pending.map((n) => n.recipient_id), ...pending.map((n) => n.actor_id)]),
    notificationPrefsById(
      admin,
      pending.map((n) => n.recipient_id),
    ),
  ]);

  // The project's name, so the email can say which job. One lookup for the
  // whole batch - every notification here is about the same task.
  const { data: project } = await admin
    .from("projects" as never)
    .select("name")
    .eq("id", task.project_id)
    .maybeSingle();
  const projectName = ((project ?? null) as { name?: string | null } | null)?.name ?? null;

  /*
   * The date the value says, not a relative word.
   *
   * "Tomorrow" would be computed against the SERVER's clock and read by
   * somebody in another timezone, which is the same class of mistake as the
   * due-date bug this release fixes. "Aug 20" means the twentieth to every
   * reader.
   */
  const due = formatCalendarDate(task.due_date);
  const origin = opts.origin.replace(/\/+$/, "");

  const delivered: string[] = [];
  /*
   * Notifications this recipient has asked not to receive by mail.
   *
   * Stamped as delivered along with the ones that were actually sent, so the
   * next dispatch does not reconsider them. `emailed_at` means "this
   * notification has been through the sender", not "an email left the
   * building" - and a suppressed message that stayed pending would be
   * re-evaluated on every subsequent write to the task until it aged out of
   * the window.
   *
   * The in-app row is untouched either way. Turning email off is a statement
   * about your inbox, not about the bell.
   */
  const suppressed: string[] = [];
  for (const n of pending) {
    const recipient = people.get(n.recipient_id);
    const to = recipient?.email;
    if (!to) continue;
    if (!emailAllowed(prefs.get(n.recipient_id), n.type)) {
      suppressed.push(n.id);
      continue;
    }
    const actor = n.actor_id ? people.get(n.actor_id) : undefined;

    /*
     * The stored `body` for a comment is "<task title> - <message>", because a
     * bell that reads only "waiting on part" does not say which job. The email
     * already prints the task title on its own line, so the prefix is peeled
     * off here rather than repeated.
     */
    const message =
      n.type === "task_comment" && n.body?.startsWith(`${task.title} - `)
        ? n.body.slice(task.title.length + 3)
        : n.type === "task_comment"
          ? n.body
          : (task.description ?? null);

    try {
      await sendTaskNotificationEmail({
        to,
        taskUrl: `${origin}${n.link_path ?? `/projects/${task.project_id}?task=${task.id}`}`,
        headline: n.title,
        taskTitle: task.title,
        projectName,
        actorName: displayName(actor),
        actorEmail: actor?.email ?? null,
        message,
        dueLabel: due || null,
        priorityLabel: PRIORITY_LABEL[task.priority] ?? null,
        ctaLabel: n.type === "task_comment" ? "Open the thread" : "Open task",
      });
      delivered.push(n.id);
    } catch (e) {
      // Logged, not thrown: the assignment is already saved and the bell
      // already rang. An unstamped row simply stays unstamped.
      console.error("[tasks] notification email failed", (e as Error)?.message);
    }
  }

  const settled = [...delivered, ...suppressed];
  if (settled.length > 0) {
    await admin
      .from("notifications" as never)
      .update({ emailed_at: new Date().toISOString() } as never)
      .in("id", settled);
  }

  return { sent: delivered.length, suppressed: suppressed.length };
}

/** Comment notifications hang off the comment, so their ids have to be gathered. */
async function recentCommentIds(admin: SupabaseClient, taskId: string): Promise<string[]> {
  const since = new Date(Date.now() - DELIVERY_WINDOW_MS).toISOString();
  const { data } = await admin
    .from("task_comments" as never)
    .select("id")
    .eq("task_id", taskId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(MAX_EMAILS_PER_DISPATCH);
  return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
}

export const dispatchTaskNotificationsInputSchema = z.object({
  taskId: z.string().uuid(),
  /** The app's own origin, so a preview deployment links back to itself. */
  origin: z.string().url().optional(),
});

/**
 * "I just wrote to this task - send whatever that owes."
 *
 * Called by the browser after an assignment, a reassignment or a completion.
 * The client does not say who to mail or what to say; it says which task moved.
 * Everything else is read back out of the notifications the triggers wrote,
 * which is why an unauthorised caller cannot use this to send mail: they cannot
 * see the task, and even if they could, they can only cause delivery of
 * messages the database had already decided to send.
 */
export async function dispatchTaskNotificationsService(
  ctx: ServiceContext,
  data: z.infer<typeof dispatchTaskNotificationsInputSchema>,
) {
  const task = await requireVisibleTask(ctx, data.taskId);
  const admin = getSupabaseAdmin();
  const entityIds = [task.id, ...(await recentCommentIds(admin, task.id))];
  return deliverPendingEmails(admin, task, entityIds, {
    origin: data.origin ?? DEFAULT_ORIGIN,
  });
}

/* --------------------------------------------------------------- watchers */

export const listTaskCollaborationInputSchema = z.object({ taskId: z.string().uuid() });

/**
 * The thread and the CC line in one round trip.
 *
 * They are opened together and always shown together, and two RPCs for one
 * panel is two spinners.
 */
export async function listTaskCollaborationService(
  ctx: ServiceContext,
  data: z.infer<typeof listTaskCollaborationInputSchema>,
) {
  const [commentsRes, watchersRes] = await Promise.all([
    ctx.supabase
      .from("task_comments" as never)
      .select("id, task_id, project_id, author_id, body, mentions, created_at")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true }),
    ctx.supabase
      .from("task_watchers" as never)
      .select("user_id, added_by, created_at")
      .eq("task_id", data.taskId)
      .order("created_at", { ascending: true }),
  ]);
  if (commentsRes.error) throw new Error(commentsRes.error.message);
  if (watchersRes.error) throw new Error(watchersRes.error.message);

  const comments = (commentsRes.data ?? []) as Array<{
    id: string;
    task_id: string;
    project_id: string;
    author_id: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
  }>;
  const watchers = (watchersRes.data ?? []) as Array<{
    user_id: string;
    added_by: string | null;
    created_at: string;
  }>;

  const people = await profilesById([
    ...comments.map((c) => c.author_id),
    ...watchers.map((w) => w.user_id),
  ]);

  return {
    comments: comments.map((c): TaskComment => {
      const p = people.get(c.author_id);
      return {
        id: c.id,
        taskId: c.task_id,
        projectId: c.project_id,
        authorId: c.author_id,
        authorName: p?.full_name ?? null,
        authorEmail: p?.email ?? null,
        authorAvatarUrl: p?.avatar_url ?? null,
        body: c.body,
        mentions: (c.mentions ?? []) as string[],
        createdAt: c.created_at,
      };
    }),
    watchers: watchers.map((w): TaskWatcher => {
      const p = people.get(w.user_id);
      return {
        userId: w.user_id,
        addedBy: w.added_by,
        createdAt: w.created_at,
        fullName: p?.full_name ?? null,
        email: p?.email ?? null,
        avatarUrl: p?.avatar_url ?? null,
      };
    }),
  };
}

export const addTaskWatchersInputSchema = z.object({
  taskId: z.string().uuid(),
  userIds: z.array(z.string().uuid()).min(1).max(50),
  origin: z.string().url().optional(),
});

/**
 * Loop people in.
 *
 * Takes a list rather than one id because the surface that needs it most is
 * "everyone with the Manager role", and adding a crew one request at a time
 * would fire one round trip and one email per person with no way to tell a
 * batch from a series of accidents.
 *
 * `ignoreDuplicates` on the upsert: adding somebody already on the thread is a
 * no-op, not an error. It also means the "add the whole role" button is safe to
 * press twice - the second press notifies nobody, because no row is inserted
 * and the trigger never fires.
 */
export async function addTaskWatchersService(
  ctx: ServiceContext,
  data: z.infer<typeof addTaskWatchersInputSchema>,
) {
  const task = await requireVisibleTask(ctx, data.taskId);
  const rows = data.userIds.map((userId) => ({
    task_id: data.taskId,
    user_id: userId,
    added_by: ctx.userId,
  }));
  const { error } = await ctx.supabase
    .from("task_watchers" as never)
    .upsert(rows as never, { onConflict: "task_id,user_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);

  const admin = getSupabaseAdmin();
  await deliverPendingEmails(admin, task, [task.id], {
    origin: data.origin ?? DEFAULT_ORIGIN,
  });
  return { ok: true as const };
}

export const removeTaskWatcherInputSchema = z.object({
  taskId: z.string().uuid(),
  userId: z.string().uuid(),
});

export async function removeTaskWatcherService(
  ctx: ServiceContext,
  data: z.infer<typeof removeTaskWatcherInputSchema>,
) {
  const { error } = await ctx.supabase
    .from("task_watchers" as never)
    .delete()
    .eq("task_id", data.taskId)
    .eq("user_id", data.userId);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}

/* --------------------------------------------------------------- comments */

export const createTaskCommentInputSchema = z.object({
  taskId: z.string().uuid(),
  body: z.string().trim().min(1).max(4000),
  mentions: z.array(z.string().uuid()).max(50).default([]),
  origin: z.string().url().optional(),
});

/**
 * Say something about a task without overwriting what it says.
 *
 * The client's report: "There's nowhere to leave a note like 'waiting on part'
 * or ask a question without editing the description field, which overwrites
 * rather than logs."
 *
 * `project_id` is taken off the task rather than from the request. It is a
 * denormalised copy of a value the database already holds, and letting a
 * caller supply it would let them file a comment against a project the task is
 * not on - which is the project id the notification would then carry.
 */
export async function createTaskCommentService(
  ctx: ServiceContext,
  data: z.infer<typeof createTaskCommentInputSchema>,
) {
  const task = await requireVisibleTask(ctx, data.taskId);

  const { data: row, error } = await ctx.supabase
    .from("task_comments" as never)
    .insert({
      task_id: task.id,
      project_id: task.project_id,
      author_id: ctx.userId,
      body: data.body,
      mentions: data.mentions,
    } as never)
    .select("id, task_id, project_id, author_id, body, mentions, created_at")
    .single();
  if (error) throw new Error(error.message);

  const typed = row as unknown as {
    id: string;
    task_id: string;
    project_id: string;
    author_id: string;
    body: string;
    mentions: string[] | null;
    created_at: string;
  };
  const people = await profilesById([typed.author_id]);
  const author = people.get(typed.author_id);

  // The trigger has already written a notification for everyone on the task.
  // Deliver those, plus anything still pending on the task itself.
  const admin = getSupabaseAdmin();
  await deliverPendingEmails(admin, task, [typed.id, task.id], {
    origin: data.origin ?? DEFAULT_ORIGIN,
  });

  const comment: TaskComment = {
    id: typed.id,
    taskId: typed.task_id,
    projectId: typed.project_id,
    authorId: typed.author_id,
    authorName: author?.full_name ?? null,
    authorEmail: author?.email ?? null,
    authorAvatarUrl: author?.avatar_url ?? null,
    body: typed.body,
    mentions: (typed.mentions ?? []) as string[],
    createdAt: typed.created_at,
  };
  return { comment };
}

export const deleteTaskCommentInputSchema = z.object({ commentId: z.string().uuid() });

export async function deleteTaskCommentService(
  ctx: ServiceContext,
  data: z.infer<typeof deleteTaskCommentInputSchema>,
) {
  // Author-only, enforced by the RLS policy in
  // 20260915000000_task_collaboration.sql. A delete that matches no row is a
  // no-op rather than an error, which is the correct answer to "remove a
  // comment that is not yours or no longer exists".
  const { error } = await ctx.supabase
    .from("task_comments" as never)
    .delete()
    .eq("id", data.commentId);
  if (error) throw new Error(error.message);
  return { ok: true as const };
}
