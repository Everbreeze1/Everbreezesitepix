import { randomUUID } from "expo-crypto";
import { api } from "@/lib/api";
import type { FeedbackReport, FeedbackStatus } from "./admin-view";

/**
 * Platform admin: the triage half.
 *
 * Every op here runs `requirePlatformAdmin` server-side and then works with the
 * service role. Membership of `platform_admins` has **no client access at all**
 * by design, so the phone cannot read it directly and does not try: it asks
 * `checkIsPlatformAdmin` and believes the answer.
 *
 * That is also why the gate below is a real question and not a convenience. A
 * customer must never see the console row on Account, and the only thing that
 * can tell the app whether to draw it is the server.
 */

/**
 * Whether this person is staff.
 *
 * Defaults to **false** on any unexpected shape or failure. Getting this wrong
 * in the permissive direction shows a customer a support queue full of other
 * customers' reports; getting it wrong the other way hides a menu row from a
 * staff member, who can open the web console. The asymmetry decides the default.
 */
export async function checkIsPlatformAdmin(): Promise<boolean> {
  try {
    const result = await api.rpc<{ isPlatformAdmin?: boolean; isAdmin?: boolean }>(
      "checkIsPlatformAdmin",
    );
    return result?.isPlatformAdmin === true || result?.isAdmin === true;
  } catch {
    return false;
  }
}

export type FeedbackPage = {
  reports: FeedbackReport[];
  nextCursor: string | null;
};

export async function listFeedback(args: {
  status?: FeedbackStatus;
  cursor?: string;
}): Promise<FeedbackPage> {
  const result = await api.rpc<Partial<FeedbackPage>>("listFeedback", {
    ...(args.status ? { status: args.status } : {}),
    ...(args.cursor ? { cursor: args.cursor } : {}),
    limit: 30,
  });
  return { reports: result?.reports ?? [], nextCursor: result?.nextCursor ?? null };
}

/** Counts per status, per kind, and the busiest features. */
export async function getFeedbackSummary(): Promise<{
  status?: Record<string, number>;
  kind?: Record<string, number>;
}> {
  const result = await api.rpc<{ status?: Record<string, number>; kind?: Record<string, number> }>(
    "getFeedbackSummary",
  );
  return result ?? {};
}

/**
 * Move one or more reports.
 *
 * The op takes an array because the web queue does bulk moves. The phone sends
 * one at a time: bulk selection on a touch list is a interaction cost that buys
 * nothing for somebody triaging three reports on a train.
 */
export async function setFeedbackStatus(
  reportIds: string[],
  status: FeedbackStatus,
): Promise<void> {
  await api.rpc("setFeedbackStatus", { reportIds, status });
}

/**
 * Answer a report, optionally moving it at the same time.
 *
 * Delivered as a notification rather than an email, because the reporter may
 * have typed no address. It lands in the same inbox the app already has.
 */
export async function replyToFeedback(args: {
  reportId: string;
  message: string;
  status?: FeedbackStatus;
}): Promise<void> {
  await api.rpc(
    "replyToFeedback",
    {
      reportId: args.reportId,
      message: args.message,
      ...(args.status ? { status: args.status } : {}),
    },
    // Reaches the person who reported the problem. Twice is worse than once.
    { idempotencyKey: randomUUID() },
  );
}
