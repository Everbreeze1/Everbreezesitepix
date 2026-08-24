import * as React from "react";
import { render } from "@react-email/render";
import { TaskNotificationEmail } from "@everlumen/email-templates";
import { sendEmail } from "../../lib/send-email";

const SITE_NAME = "Everlumen";
const ROOT_DOMAIN = "everlumen.co";

/**
 * Trim to `max` characters on a word boundary where there is one.
 *
 * Also flattens whitespace, which is what keeps a task title containing CR/LF
 * from reaching a Subject header - a title is free text a crew member typed,
 * and Subject has no equivalent of `sendEmail`'s From sanitising.
 *
 * Same helper as `email/team-invite.ts`. Copied rather than shared because the
 * two files are the only callers and a `lib/clip.ts` for eight lines would be
 * one more indirection between a subject line and the thing it says.
 */
function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd() + "…";
}

export interface TaskNotificationEmailInput {
  to: string;
  /** Deep link into the app, already pointing at the task. */
  taskUrl: string;
  /** "New task assigned to you", "Task completed", "Mark commented on a task". */
  headline: string;
  taskTitle: string;
  projectName?: string | null;
  /** Who caused it. Goes in the From display name as well as the body. */
  actorName?: string | null;
  actorEmail?: string | null;
  message?: string | null;
  dueLabel?: string | null;
  priorityLabel?: string | null;
  ctaLabel?: string;
}

/**
 * The email half of a task notification.
 *
 * The in-app bell has always been the whole of it, and the client's review is
 * what that costs: "crew members have no way to know new work landed on them
 * unless they're manually refreshing the app". A field tech does not sit on a
 * dashboard, so the notification has to travel to where they already are.
 *
 * The subject leads with the task, not with the product: "Fix gutter at SW
 * corner" is what a person recognises in a list of unread mail, and prefixing
 * every one of these with the app's name would make a crew's inbox a column of
 * identical prefixes. The headline follows it so the subject still says what
 * happened.
 */
export async function sendTaskNotificationEmail(opts: TaskNotificationEmailInput): Promise<void> {
  const element = React.createElement(TaskNotificationEmail, {
    siteName: SITE_NAME,
    siteUrl: `https://${ROOT_DOMAIN}`,
    taskUrl: opts.taskUrl,
    headline: opts.headline,
    taskTitle: opts.taskTitle,
    projectName: opts.projectName ?? null,
    actorName: opts.actorName ?? null,
    message: opts.message ?? null,
    dueLabel: opts.dueLabel ?? null,
    priorityLabel: opts.priorityLabel ?? null,
    ctaLabel: opts.ctaLabel,
  });
  const html = await render(element);
  const text = await render(element, { plainText: true });

  await sendEmail({
    to: opts.to,
    subject: `${clip(opts.taskTitle, 60)} - ${clip(opts.headline, 40)}`,
    html,
    text,
    /*
     * "Mark Lagura (via Everlumen)", the pattern team invites already
     * use. Person-to-person mail with a human in the From line is what keeps
     * this out of Promotions, and an assignment IS person to person: somebody
     * handed somebody else a job.
     *
     * Clipped before composing because `sendEmail` caps the finished display
     * name at 64 characters - composing first would let a long name eat the
     * "(via ...)" and leave the sender reading as a bare stranger on our
     * domain.
     */
    fromName: opts.actorName ? `${clip(opts.actorName, 24)} (via ${SITE_NAME})` : undefined,
    // A reply reaches the teammate who assigned or commented, rather than dying
    // in a shared inbox. "Can this wait until Thursday?" deserves an answer.
    replyTo: opts.actorEmail ?? undefined,
  });
}
