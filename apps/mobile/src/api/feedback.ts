import { supabase } from "@/lib/supabase";
import {
  contextAsText,
  feedbackExtras,
  feedbackRow,
  type DeviceContext,
  type FeedbackKind,
} from "./feedback-view";

/**
 * Sending a problem report.
 *
 * A direct insert into `issue_reports`, matching the web. There is no submit op
 * on `/v1/rpc`: the admin side has `listFeedback`, `setFeedbackStatus` and
 * `replyToFeedback`, and submitting is a client insert guarded by RLS.
 *
 * The retry below is not defensive padding, it is the same fallback the web
 * carries and for the same reason: migrations in this repo are applied by hand,
 * so there is a real window in which `project_id`, `client_info` and
 * `attachments` are not on the table yet. Losing a bug report to a missing
 * column would be the worst possible failure for the one feature whose entire
 * job is receiving them.
 */

export async function submitIssueReport(input: {
  kind: FeedbackKind;
  /** Bugs carry a one-line subject; ideas and praise are filed without one. */
  subject: string | null;
  description: string;
  projectId: string | null;
  screen: string | null;
  context: DeviceContext;
}): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user ?? null;

  const base = feedbackRow({
    kind: input.kind,
    description: input.description,
    userId: user?.id ?? null,
    email: user?.email ?? null,
    screen: input.screen,
    context: input.context,
  });

  const { error } = await (supabase as any).from("issue_reports").insert({
    ...base,
    // Subject came with 20261008000000, so it rides the modern-columns insert
    // and stays out of the legacy retry below, which exists to drop exactly
    // these. `cleanSubject` has already trimmed and capped it.
    ...(input.subject ? { subject: input.subject } : {}),
    ...feedbackExtras({ projectId: input.projectId, context: input.context }),
  });
  if (!error) return;

  // Second attempt: long-standing columns only, context folded into the text.
  const { error: retryError } = await (supabase as any).from("issue_reports").insert({
    ...base,
    description: `${base.description}${contextAsText(input.context, input.projectId)}`.slice(
      0,
      4000,
    ),
  });
  if (retryError) throw new Error(retryError.message);
}
