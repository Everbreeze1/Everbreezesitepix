-- ISSUES & ESCALATION (Workflow Automation Spec #2, #9).
--
-- #2 - AI issue flagging: a newly uploaded photo is run through the existing
-- AI vision pass (apps/api/src/domains/ai/service.ts, `analyzePhotoService`)
-- against a configurable defect taxonomy. A match above the confidence
-- threshold creates an `issues` row and applies the "Needs review" label. The
-- vision run is enqueued here (kind `issue_scan`) and drained by the same
-- `workflow-automation` hook, gated to Team plan - the spec calls this the most
-- net-new work and it is the costliest automation to run.
--
-- #9 - escalation: a workflow that has shown no progress for a configurable
-- window notifies the project's manager. The window is per-template
-- (`stall_window_hours`), and a scheduled hook sweeps for stalled jobs.
--
-- Idempotent, safe to re-run. Apply via the Everlumen Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) or `supabase db push`.

SET lock_timeout = '5s';

-- =========================================================================
-- 1. ISSUES
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.issues (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  workflow_id uuid REFERENCES public.project_workflows(id) ON DELETE SET NULL,
  phase_id uuid REFERENCES public.project_workflow_phases(id) ON DELETE SET NULL,
  photo_id uuid REFERENCES public.photos(id) ON DELETE SET NULL,
  title text NOT NULL,
  category text,
  severity text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'confirmed', 'dismissed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS issues_project_id_idx ON public.issues(project_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.issues TO authenticated;
GRANT ALL ON public.issues TO service_role;
REVOKE ALL ON public.issues FROM anon;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teammates view team issues" ON public.issues;
CREATE POLICY "Teammates view team issues" ON public.issues
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

DROP POLICY IF EXISTS "Teammates resolve team issues" ON public.issues;
CREATE POLICY "Teammates resolve team issues" ON public.issues
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  ) WITH CHECK (
    -- Confirm/dismiss is the only user edit; everything else is AI- or
    -- service-written.
    status IN ('open', 'confirmed', 'dismissed')
  );

-- =========================================================================
-- 2. DEFECT TAXONOMY
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.defect_taxonomies (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  trade text,
  terms text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS defect_taxonomies_scope_idx
  ON public.defect_taxonomies (COALESCE(project_id::text, ''), COALESCE(trade, ''));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_taxonomies TO authenticated;
GRANT ALL ON public.defect_taxonomies TO service_role;
REVOKE ALL ON public.defect_taxonomies FROM anon;
ALTER TABLE public.defect_taxonomies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teammates view defect taxonomy" ON public.defect_taxonomies;
CREATE POLICY "Teammates view defect taxonomy" ON public.defect_taxonomies
  FOR SELECT TO authenticated USING (
    project_id IS NULL OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- =========================================================================
-- 3. ESCALATION WINDOW, PER TEMPLATE
-- =========================================================================
ALTER TABLE public.workflow_templates
  ADD COLUMN IF NOT EXISTS stall_window_hours integer NOT NULL DEFAULT 48;

-- =========================================================================
-- 4. ENQUEUE ISSUE SCAN ON PHOTO UPLOAD
-- =========================================================================
-- Gated to Team plan: vision on every photo is the costliest automation here,
-- and the flag list for a Pro/Starter job is not worth a model call per shot.
CREATE OR REPLACE FUNCTION public.enqueue_issue_scan() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _owner uuid;
BEGIN
  SELECT p.created_by INTO _owner FROM public.projects p WHERE p.id = NEW.project_id;
  IF _owner IS NULL OR NOT public.is_team_plan(_owner) THEN RETURN NEW; END IF;

  INSERT INTO public.workflow_automation (kind, project_id, photo_id, payload)
  VALUES ('issue_scan', NEW.project_id, NEW.id, jsonb_build_object('photo_id', NEW.id));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS photos_enqueue_issue_scan ON public.photos;
CREATE TRIGGER photos_enqueue_issue_scan
  AFTER INSERT ON public.photos
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_issue_scan();

-- =========================================================================
-- 5. SCHEDULE THE ESCALATION SWEEP
-- =========================================================================
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
  'workflow-escalation',
  '*/15 * * * *',
  $job$
  SELECT net.http_post(
    url     := 'https://api.everlumen.co/v1/hooks/workflow-escalation',
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
-- 6. WIDEN THE NOTIFICATION TYPE CHECK
-- =========================================================================
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted',
  'admin_announcement',
  'workflow_assigned',
  'task_completed', 'checklist_completed', 'workflow_completed',
  'task_comment', 'task_watching', 'task_updated',
  'project_assigned',
  'workflow_phase_advanced',
  -- new: a workflow stalled past its escalation window
  'workflow_stalled'
));

-- =========================================================================
-- VERIFY
-- =========================================================================
-- Tables - expect issues and defect_taxonomies.
SELECT relname FROM pg_class WHERE relname IN ('issues', 'defect_taxonomies') AND relkind = 'r'
ORDER BY relname;

-- Column - expect the stall window on templates.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'workflow_templates' AND column_name = 'stall_window_hours';

-- Trigger - expect the issue-scan enqueue on photos.
SELECT c.relname AS table_name, t.tgname AS trigger_name
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
WHERE NOT t.tgisinternal AND t.tgname = 'photos_enqueue_issue_scan';

