import { File } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import {
  attachmentPath,
  contextAsText,
  feedbackExtras,
  feedbackRow,
  FEEDBACK_BUCKET,
  type DeviceContext,
  type FeedbackKind,
  type PickedAttachment,
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

/**
 * Uploads the picked screenshots at send time, exactly as the web does.
 *
 * Picking a file is not a commitment to send, and a bucket full of screenshots
 * from reports nobody finished would be nobody's job to clean up.
 *
 * Never throws. A failed upload must not swallow the report that came with it,
 * so the caller sends the text regardless and tells the user which files did
 * not make it.
 */
export async function uploadFeedbackAttachments(
  userId: string,
  picked: PickedAttachment[],
): Promise<{ paths: string[]; failed: string[] }> {
  const paths: string[] = [];
  const failed: string[] = [];
  const stamp = Date.now();

  for (const [i, item] of picked.entries()) {
    const path = attachmentPath(userId, stamp, i, item.name);
    try {
      const bytes = await new File(item.uri).arrayBuffer();
      const { error } = await supabase.storage
        .from(FEEDBACK_BUCKET)
        .upload(path, bytes, { contentType: item.mimeType || "application/octet-stream" });
      if (error) throw new Error(error.message);
      paths.push(path);
    } catch (e) {
      // Logged as well as reported. The error text has to stay short and
      // blameless, so without this the actual cause - a bucket that was never
      // created, a MIME type the bucket rejects, a policy - left no trace
      // anywhere.
      console.error("[feedback] attachment upload failed", {
        path,
        error: e instanceof Error ? e.message : String(e),
      });
      failed.push(item.name);
    }
  }
  return { paths, failed };
}

export async function submitIssueReport(input: {
  kind: FeedbackKind;
  /** Bugs carry a one-line subject; ideas and praise are filed without one. */
  subject: string | null;
  description: string;
  projectId: string | null;
  screen: string | null;
  context: DeviceContext;
  /** Storage paths in the `feedback-attachments` bucket, uploaded before this call. */
  attachments: string[];
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
    ...feedbackExtras({
      projectId: input.projectId,
      context: input.context,
      attachments: input.attachments,
    }),
  });
  if (!error) return;

  // Second attempt: long-standing columns only, context folded into the text.
  const { error: retryError } = await (supabase as any).from("issue_reports").insert({
    ...base,
    description: `${base.description}${contextAsText(
      input.context,
      input.projectId,
      input.attachments,
    )}`.slice(0, 4000),
  });
  if (retryError) throw new Error(retryError.message);
}
