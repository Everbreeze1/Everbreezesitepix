import { jsonError, jsonOk } from "../../lib/errors";
import { verifyCronSecret } from "../../lib/cron-auth";
import { getSupabaseAdmin } from "../../lib/supabase";
import { recordJobRun } from "../../lib/job-run";
import { generateComprehensiveReportService } from "../projects/comprehensive-report";
import { generateProjectPageService } from "../projects/page-generate";
import { analyzePhotoService } from "../ai/service";

/** How many times an item may fail before it is left alone. */
const MAX_ATTEMPTS = 5;
/** How many queue rows one drain invocation takes. */
const BATCH = 20;

type QueueItem = {
  id: string;
  kind: "phase_report" | "workflow_report" | "issue_scan";
  project_id: string;
  workflow_id: string | null;
  phase_id: string | null;
  photo_id: string | null;
  payload: Record<string, unknown> | null;
  attempts: number;
};

/**
 * Drain the workflow automation queue (spec #5/#8 reports and #2 issue scans).
 *
 * The enqueue happens in database triggers (`workflows_enqueue_report`,
 * `photos_enqueue_issue_scan`), because the writes that complete a workflow or
 * add a photo come straight from the browser. Those triggers cannot call the AI
 * report engine, so they drop a row here and this scheduled job - authenticated
 * with the same cron secret every other hook uses - does the work with the
 * service-role key.
 */
export async function handleWorkflowAutomation(request: Request): Promise<Response> {
  if (!(await verifyCronSecret(request))) {
    return jsonError(401, "unauthorized", "Unauthorized");
  }

  try {
    const outcome = await recordJobRun("workflow-automation", async () => {
      const admin = getSupabaseAdmin();

      const { data: pending, error } = await (admin as any)
        .from("workflow_automation")
        .select("id, kind, project_id, workflow_id, phase_id, photo_id, payload, attempts")
        .eq("status", "pending")
        .lt("attempts", MAX_ATTEMPTS)
        .order("created_at", { ascending: true })
        .limit(BATCH);
      if (error) throw new Error(error.message);

      const items = (pending ?? []) as QueueItem[];
      let done = 0;
      let failed = 0;

      for (const item of items) {
        await (admin as any)
          .from("workflow_automation")
          .update({ status: "processing" } as never)
          .eq("id", item.id);
        try {
          if (item.kind === "workflow_report") await runWorkflowReport(admin as any, item);
          else if (item.kind === "phase_report") await runPhaseReport(admin as any, item);
          else if (item.kind === "issue_scan") await runIssueScan(admin as any, item);
          await (admin as any)
            .from("workflow_automation")
            .update({ status: "done", processed_at: new Date().toISOString() } as never)
            .eq("id", item.id);
          done++;
        } catch (e) {
          await (admin as any)
            .from("workflow_automation")
            .update({
              status: "failed",
              attempts: item.attempts + 1,
              last_error: String((e as { message?: unknown })?.message ?? e).slice(0, 500),
            } as never)
            .eq("id", item.id);
          failed++;
        }
      }

      return { result: { done, failed, considered: items.length } };
    });

    return jsonOk(outcome);
  } catch (e: unknown) {
    return jsonError(500, "workflow_automation_failed", e instanceof Error ? e.message : "Automation failed");
  }
}

/**
 * Spec #5/#8: on workflow completion, generate the whole-job report with the
 * existing engine and flag it "Added automatically" and "Ready to send". The
 * report is never sent to the customer here - that stays a manual step.
 */
async function runWorkflowReport(admin: any, item: QueueItem): Promise<void> {
  const { data: project } = await admin
    .from("projects")
    .select("created_by")
    .eq("id", item.project_id)
    .maybeSingle();
  if (!project?.created_by) return;

  const res = await generateComprehensiveReportService(
    { supabase: admin, userId: project.created_by } as never,
    { projectId: item.project_id } as never,
  );

  const pageId = (res as { page?: { id: string } })?.page?.id;
  if (pageId) {
    await admin
      .from("project_pages")
      .update({ added_automatically: true, ready_to_send: true } as never)
      .eq("id", pageId);
  }
}

/**
 * Spec #4: on phase completion, draft a report from that phase's photos only,
 * reusing the existing "Report from selected photos" engine. Saved under
 * Documents with the "Added automatically" flag, not "Ready to send" - it is a
 * draft, not the finished job report.
 */
async function runPhaseReport(admin: any, item: QueueItem): Promise<void> {
  const phaseId = item.phase_id ?? (item.payload as { phase_id?: string } | null)?.phase_id;
  if (!phaseId) return;

  const { data: project } = await admin
    .from("projects")
    .select("created_by")
    .eq("id", item.project_id)
    .maybeSingle();
  if (!project?.created_by) return;

  // Phase-scoped photos come straight off the Phase 2 provenance column.
  const { data: photos } = await admin
    .from("photos")
    .select("id")
    .eq("workflow_phase_id", phaseId)
    .is("deleted_at", null)
    .limit(50);
  const photoIds = ((photos ?? []) as Array<{ id: string }>).map((p) => p.id);
  if (photoIds.length === 0) return;

  const res = await generateProjectPageService(
    { supabase: admin, userId: project.created_by } as never,
    {
      projectId: item.project_id,
      template: "report",
      photoIds,
      title: (item.payload as { phase_name?: string } | null)?.phase_name,
    } as never,
  );

  const pageId = (res as { page?: { id: string } })?.page?.id;
  if (pageId) {
    await admin.from("project_pages").update({ added_automatically: true } as never).eq("id", pageId);
  }
}

/**
 * Spec #2: run the existing AI vision pass on a newly uploaded photo, and turn
 * any defects it reports into `issues` rows flagged "Needs review". The enqueue
 * is gated to Team plan, so a model call is never made for a Starter/Pro job.
 */
async function runIssueScan(admin: any, item: QueueItem): Promise<void> {
  const photoId = item.photo_id ?? (item.payload as { photo_id?: string } | null)?.photo_id;
  if (!photoId) return;

  const { data: photo } = await admin
    .from("photos")
    .select("id, project_id, uploaded_by, tags")
    .eq("id", photoId)
    .maybeSingle();
  if (!photo) return;

  await analyzePhotoService({ supabase: admin, userId: photo.uploaded_by } as never, {
    photoId,
  } as never);

  const { data: analysis } = await admin
    .from("ai_analyses")
    .select("defects")
    .eq("photo_id", photoId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const defects = (Array.isArray(analysis?.defects) ? analysis.defects : []) as Array<{
    description?: string;
    type?: string;
    category?: string;
    severity?: string;
  }>;
  if (defects.length === 0) return;

  // Configurable taxonomy (spec §4): the project's own list, or the global one.
  // An empty taxonomy means "flag everything the model reports".
  const { data: taxonomy } = await admin
    .from("defect_taxonomies")
    .select("terms")
    .or(`project_id.eq.${item.project_id},project_id.is.null`);
  const terms = ((taxonomy ?? []) as Array<{ terms: string[] | null }>).flatMap((t) =>
    Array.isArray(t.terms) ? t.terms : [],
  );
  const flagged =
    terms.length === 0
      ? defects
      : defects.filter((d) => {
          const hay = [d.type, d.category, d.description].filter(Boolean).join(" ").toLowerCase();
          return terms.some((t) => hay.includes(String(t).toLowerCase()));
        });
  if (flagged.length === 0) return;

  await admin.from("issues").insert(
    flagged.map((d) => ({
      project_id: photo.project_id,
      photo_id: photoId,
      title: String(d.description ?? d.type ?? d.category ?? "Flagged issue"),
      category: d.category ?? d.type ?? null,
      severity: d.severity ?? null,
      status: "open",
    })),
  );

  const tags = Array.isArray(photo.tags) ? photo.tags : [];
  const next = Array.from(new Set([...tags, "Needs review"]));
  await admin.from("photos").update({ tags: next }).eq("id", photoId);
}
