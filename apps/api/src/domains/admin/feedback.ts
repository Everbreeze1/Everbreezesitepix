import { z } from "zod";
import { getSupabaseAdmin } from "../../lib/supabase";
import { requirePlatformAdmin } from "../../lib/admin-context";
import { escapeLikeValue } from "../../lib/postgrest";
import { insertNotification } from "../notifications/service";
import { logAdminAction } from "./audit";
import type { AuthedContext } from "../../lib/user-context";

/*
 * The triage side of in-product feedback.
 *
 * `issue_reports` has been collecting bug reports, feature ideas and thumbs
 * signals from the Feedback page and the in-app prompts since 20260803020000.
 * That migration's own comment says "triage happens with the service role" -
 * and then nothing was ever built to do it. Every report a customer has sent
 * has gone into a table with a `status` column that no code has ever written,
 * readable only by opening the SQL editor.
 *
 * So this is not a new data model, it is the missing reader. The statuses below
 * are the vocabulary that column was always defaulting into ('new') and never
 * leaving.
 */

export const FEEDBACK_STATUSES = ["new", "triaged", "resolved", "dismissed"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];

export interface FeedbackReport {
  id: string;
  status: string;
  kind: string;
  sentiment: string | null;
  source: string;
  feature: string | null;
  description: string | null;
  url: string | null;
  userAgent: string | null;
  attachments: string[];
  createdAt: string;
  projectId: string | null;
  /** Whoever filed it. Null for a signal from a session we could not resolve. */
  reporter: { id: string | null; name: string | null; email: string | null };
}

export const listFeedbackInputSchema = z.object({
  status: z.enum(FEEDBACK_STATUSES).optional(),
  kind: z.enum(["bug", "idea", "praise"]).optional(),
  source: z.enum(["page", "prompt"]).optional(),
  feature: z.string().trim().max(120).optional(),
  search: z.string().trim().max(200).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export async function listFeedbackService(
  ctx: AuthedContext,
  data: z.infer<typeof listFeedbackInputSchema>,
): Promise<{ reports: FeedbackReport[]; nextCursor: string | null }> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  let query = (admin as any)
    .from("issue_reports")
    .select(
      "id, status, kind, sentiment, source, feature, description, url, user_agent, " +
        "attachments, created_at, project_id, user_id, email",
    )
    .order("created_at", { ascending: false })
    .limit(data.limit + 1);

  if (data.cursor) query = query.lt("created_at", data.cursor);
  if (data.status) query = query.eq("status", data.status);
  if (data.kind) query = query.eq("kind", data.kind);
  if (data.source) query = query.eq("source", data.source);
  if (data.feature) query = query.eq("feature", data.feature);
  // Quoted: `.or()` is a parsed expression, so an unescaped comma in a search
  // for "crashes, then reloads" would split the filter. See escapeLikeValue.
  if (data.search) {
    const like = escapeLikeValue(data.search);
    query = query.or(`description.ilike.${like},url.ilike.${like}`);
  }

  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const list = (rows as any[]) ?? [];
  const hasMore = list.length > data.limit;
  const page = hasMore ? list.slice(0, data.limit) : list;

  const userIds = Array.from(new Set(page.map((r) => r.user_id).filter(Boolean)));
  const { data: profileRows } = userIds.length
    ? await (admin as any).from("profiles").select("id, full_name, email").in("id", userIds)
    : { data: [] };
  const profileById = new Map(((profileRows as any[]) ?? []).map((p) => [p.id, p]));

  return {
    reports: page.map((r) => ({
      id: r.id,
      status: r.status,
      kind: r.kind,
      sentiment: r.sentiment,
      source: r.source,
      feature: r.feature,
      description: r.description,
      url: r.url,
      userAgent: r.user_agent,
      attachments: Array.isArray(r.attachments) ? r.attachments : [],
      createdAt: r.created_at,
      projectId: r.project_id,
      reporter: {
        id: r.user_id ?? null,
        name: profileById.get(r.user_id)?.full_name ?? null,
        // The row's own `email` is what an unauthenticated reporter typed, so
        // it is the fallback rather than the profile's - and often the only
        // way to answer someone who filed while signed out.
        email: profileById.get(r.user_id)?.email ?? r.email ?? null,
      },
    })),
    nextCursor: hasMore ? page[page.length - 1].created_at : null,
  };
}

export interface FeedbackSummary {
  byStatus: Record<string, number>;
  byKind: Record<string, number>;
  /** Features with the most reports, so the queue points somewhere. */
  topFeatures: Array<{ feature: string; count: number }>;
}

/**
 * Counts for the queue's filter tabs.
 *
 * A separate op rather than a field on the list response: the list is
 * cursor-paginated, so any total computed from it would silently mean "of the
 * fifty rows currently loaded" - the exact trap the teams page had to caption
 * its way out of. These are head counts against the whole table.
 */
export async function getFeedbackSummaryService(ctx: AuthedContext): Promise<FeedbackSummary> {
  await requirePlatformAdmin(ctx.userId);
  const admin = getSupabaseAdmin();

  const count = async (column: string, value: string): Promise<number> => {
    const { count: n } = await (admin as any)
      .from("issue_reports")
      .select("id", { count: "exact", head: true })
      .eq(column, value);
    return n ?? 0;
  };

  const [statusCounts, kindCounts, featureRows] = await Promise.all([
    Promise.all(FEEDBACK_STATUSES.map(async (s) => [s, await count("status", s)] as const)),
    Promise.all(
      (["bug", "idea", "praise"] as const).map(async (k) => [k, await count("kind", k)] as const),
    ),
    // Bounded: the newest 1000 reports are what a "what is being complained
    // about lately" list should reflect anyway, and it keeps this off a full
    // table scan as the table grows.
    (admin as any)
      .from("issue_reports")
      .select("feature")
      .not("feature", "is", null)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const featureTally = new Map<string, number>();
  for (const row of ((featureRows.data as any[]) ?? []) as Array<{ feature: string }>) {
    featureTally.set(row.feature, (featureTally.get(row.feature) ?? 0) + 1);
  }

  return {
    byStatus: Object.fromEntries(statusCounts),
    byKind: Object.fromEntries(kindCounts),
    topFeatures: [...featureTally.entries()]
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count || a.feature.localeCompare(b.feature))
      .slice(0, 12),
  };
}

export const setFeedbackStatusInputSchema = z.object({
  reportIds: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(FEEDBACK_STATUSES),
});

/**
 * What the reporter is told when their report moves.
 *
 * Only the three that are news to them. Moving something back to 'new' is the
 * queue correcting itself, and telling someone their fixed bug is unfixed
 * again on the strength of a misclick is worse than saying nothing.
 */
const STATUS_NOTICE: Partial<Record<FeedbackStatus, { title: string; lead: string }>> = {
  triaged: {
    title: "We're looking into your report",
    lead: "We've confirmed this one and it's being worked on.",
  },
  resolved: {
    title: "Your report was resolved",
    lead: "This has been fixed or answered.",
  },
  dismissed: {
    title: "Your report was closed",
    lead: "We've closed this without a change. Send it again if it's still happening.",
  },
};

/**
 * Enough of the report for the reporter to know which one this is about.
 *
 * Short, and on one line, because of where it lands. Both notification
 * surfaces render the body into a `line-clamp-2` paragraph with no
 * `whitespace-pre-wrap` (AppHeader.tsx, NotificationsPage.tsx), so a newline
 * here would collapse to a space and a long quote would be clipped by the
 * clamp - taking with it the only part that says which report this is. 80
 * characters keeps the lead and the quote inside two lines of the 360px bell.
 */
function quoteReport(description: string | null): string {
  const text = (description ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return ` "${text.length > 80 ? `${text.slice(0, 79)}…` : text}"`;
}

export async function setFeedbackStatusService(
  ctx: AuthedContext,
  data: z.infer<typeof setFeedbackStatusInputSchema>,
): Promise<{ updated: number }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();

  /*
   * Read before the write, so the notifications below go only to reports that
   * actually moved. A bulk update over a selection can easily include rows
   * already sitting in the target status, and "Your report was resolved"
   * arriving twice for one bug is the kind of thing that gets notifications
   * muted.
   */
  const { data: beforeRows } = await (admin as any)
    .from("issue_reports")
    .select("id, user_id, status, description")
    .in("id", data.reportIds);

  const { error } = await (admin as any)
    .from("issue_reports")
    .update({ status: data.status })
    .in("id", data.reportIds);
  if (error) throw new Error(error.message);

  /*
   * Tell the people who filed them.
   *
   * The list on the Feedback page shows the move, but only to someone who
   * thinks to go and look. Without this, nothing ever told them to: replying
   * (below) was the only thing that reached anyone, and it needs an admin to
   * type a message, so a report closed with no reply reached nobody at all.
   *
   * `admin_announcement` rather than a new notification type: it is already in
   * the table's CHECK constraint, and a new value would need a migration
   * applied by hand before this could ship. `entity_type` is left unset for the
   * same reason - its constraint (last widened in 20260919000000) has no
   * 'issue_report', and insertNotification only logs a failed insert, so
   * setting it would drop every one of these on the floor exactly as silently
   * as the missing notification this replaces. `link_path` carries the
   * destination, which is all anything reads.
   */
  const notice = STATUS_NOTICE[data.status];
  if (notice) {
    const moved = (
      ((beforeRows as any[]) ?? []) as Array<{
        id: string;
        user_id: string | null;
        status: string;
        description: string | null;
      }>
    ).filter((row) => row.user_id && row.status !== data.status);

    await Promise.all(
      moved.map((row) =>
        insertNotification(admin, {
          recipientId: row.user_id as string,
          actorId: null,
          type: "admin_announcement",
          title: notice.title,
          body: `${notice.lead}${quoteReport(row.description)}`,
          // Lands on the Feedback page, where the reporter's own list of
          // reports and their statuses lives.
          linkPath: "/report-issue",
        }),
      ),
    );
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "set_feedback_status",
    targetType: "issue_report",
    targetId: data.reportIds.length === 1 ? data.reportIds[0] : null,
    metadata: { status: data.status, count: data.reportIds.length },
  });

  return { updated: data.reportIds.length };
}

export const replyToFeedbackInputSchema = z.object({
  reportId: z.string().uuid(),
  message: z.string().trim().min(1).max(1000),
  /** Move the report on at the same time. Defaults to leaving it alone. */
  status: z.enum(FEEDBACK_STATUSES).optional(),
});

/**
 * Answer a report in the product, as a notification to the person who filed it.
 *
 * Deliberately not email: the reply has to reach someone who may have typed no
 * address at all, and the notification bell is where they already are. A report
 * from a signed-out session has no recipient, and that is reported as an error
 * rather than silently doing nothing - "I replied and heard nothing back" is
 * the failure mode worth spending an error message on.
 */
export async function replyToFeedbackService(
  ctx: AuthedContext,
  data: z.infer<typeof replyToFeedbackInputSchema>,
): Promise<{ ok: true }> {
  await requirePlatformAdmin(ctx.userId, "support");
  const admin = getSupabaseAdmin();

  const { data: report, error } = await (admin as any)
    .from("issue_reports")
    .select("id, user_id, kind")
    .eq("id", data.reportId)
    .single();
  if (error || !report) throw new Error("Feedback report not found");
  if (!report.user_id) {
    throw new Error(
      "This report was filed without a signed-in account, so there is nobody to notify in the app. Use the email on the report instead.",
    );
  }

  await insertNotification(admin, {
    recipientId: report.user_id,
    actorId: null,
    type: "admin_announcement",
    title: "Re: your feedback",
    body: data.message,
    // The Feedback page, where the reporter can see the report this answers
    // and what it was moved to.
    linkPath: "/report-issue",
  });

  if (data.status) {
    const { error: statusError } = await (admin as any)
      .from("issue_reports")
      .update({ status: data.status })
      .eq("id", data.reportId);
    if (statusError) throw new Error(statusError.message);
  }

  await logAdminAction(admin, {
    actorId: ctx.userId,
    action: "reply_to_feedback",
    targetType: "issue_report",
    targetId: data.reportId,
    metadata: { status: data.status ?? null },
  });

  return { ok: true };
}
