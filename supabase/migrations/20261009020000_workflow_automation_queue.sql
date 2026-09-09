-- REPORT AUTOMATION QUEUE (Workflow Automation Spec #5, #6, #8).
--
-- When a workflow completes, the app can already generate the whole-job report
-- (the Create menu's "Full Project Report"), but nothing calls it: the workflow
-- is marked complete and that is the end of it. Spec #5 makes the completion
-- itself the trigger - "a finished, client-ready report exists the moment the
-- job is done".
--
-- The write that completes a workflow happens straight from the browser, so the
-- only place to catch it is a database trigger. That trigger cannot call the
-- report engine (it needs the AI key and the API), so it enqueues a
-- `workflow_report` row here instead, and a scheduled job drains the queue by
-- calling the API's existing report service. Same queue also carries
-- `issue_scan` rows (spec #2) - added by a later migration.
--
-- Spec #4 also wants generated reports to carry an "Added automatically" tag so
-- it is always clear which reports a human wrote and which the system produced,
-- and spec #8 wants the finished report flagged "Ready to send" (never
-- auto-sent to the customer). Those two flags land on `project_pages`, where
-- every generated report already lives (`source_template = 'report'`).
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) or `supabase db push`.

SET lock_timeout = '5s';

-- =========================================================================
-- 1. REPORT PROVENANCE FLAGS
-- =========================================================================
ALTER TABLE public.project_pages
  ADD COLUMN IF NOT EXISTS added_automatically boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ready_to_send boolean NOT NULL DEFAULT false;

-- =========================================================================
-- 2. QUEUE
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.workflow_automation (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('phase_report', 'workflow_report', 'issue_scan')),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.project_workflows(id) ON DELETE CASCADE,
  phase_id uuid REFERENCES public.project_workflow_phases(id) ON DELETE CASCADE,
  photo_id uuid REFERENCES public.photos(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS workflow_automation_pending_idx
  ON public.workflow_automation(status, created_at) WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_automation TO authenticated;
GRANT ALL ON public.workflow_automation TO service_role;
ALTER TABLE public.workflow_automation ENABLE ROW LEVEL SECURITY;

-- Rows are only ever written by triggers and read/updated by the service-role
-- hook, never directly by a signed-in user.
REVOKE ALL ON public.workflow_automation FROM anon;
DROP POLICY IF EXISTS "Authenticated can view workflow automation" ON public.workflow_automation;

-- =========================================================================
-- 3. ENQUEUE ON WORKFLOW COMPLETION
-- =========================================================================
CREATE OR REPLACE FUNCTION public.enqueue_workflow_report() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    INSERT INTO public.workflow_automation (kind, project_id, workflow_id, payload)
    VALUES ('workflow_report', NEW.project_id, NEW.id,
            jsonb_build_object('workflow_name', NEW.name))
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflows_enqueue_report ON public.project_workflows;
CREATE TRIGGER workflows_enqueue_report
  AFTER UPDATE OF completed_at ON public.project_workflows
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_workflow_report();

-- =========================================================================
-- 3b. ENQUEUE A PHASE DRAFT ON PHASE COMPLETION (spec #4)
-- =========================================================================
-- Only actionable phases ever get a `completed_at` (markers stay NULL), so this
-- fires exactly once per phase that has a measurable completion.
CREATE OR REPLACE FUNCTION public.enqueue_phase_report() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN
    INSERT INTO public.workflow_automation (kind, project_id, workflow_id, phase_id, payload)
    SELECT 'phase_report', w.project_id, w.id, NEW.id,
           jsonb_build_object('phase_name', NEW.name, 'workflow_name', w.name)
      FROM public.project_workflows w
     WHERE w.id = NEW.workflow_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_phases_enqueue_report ON public.project_workflow_phases;
CREATE TRIGGER workflow_phases_enqueue_report
  AFTER UPDATE OF completed_at ON public.project_workflow_phases
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_phase_report();

-- =========================================================================
-- 4. SCHEDULE THE DRAIN
-- =========================================================================
-- Drains the queue by calling POST /v1/hooks/workflow-automation, which runs
-- the report (and, later, issue-scan) work with the service-role key.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'workflow-automation',
  '*/5 * * * *',
  $job$
  SELECT net.http_post(
    url     := 'https://api.everlumen.co/v1/hooks/workflow-automation',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'x-cron-secret', (SELECT decrypted_secret
                        FROM vault.decrypted_secrets
                        WHERE name = 'cron_shared_secret')
    ),
    body    := '{}'::jsonb
  );
  $job$
);

-- =========================================================================
-- VERIFY
-- =========================================================================
-- Columns - expect the two report flags on project_pages.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'project_pages'
  AND column_name IN ('added_automatically', 'ready_to_send')
ORDER BY column_name;

-- Trigger - expect the enqueue trigger on project_workflows.
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal
  AND t.tgname = 'workflows_enqueue_report';

-- Queue - expect the table with its pending index.
SELECT relname FROM pg_class
WHERE relname = 'workflow_automation' AND relkind = 'r';

