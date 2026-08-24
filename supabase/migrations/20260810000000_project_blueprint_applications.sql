-- Blueprint application ledger.
--
-- Applying a project blueprint fans out into five different tables
-- (project_checklists, project_workflows, project_reports, project_site_logs,
-- projects.labels) and, once written, the rows look exactly like rows a user
-- created by hand. Nothing recorded that a blueprint was the cause, so the
-- Templates screen could not answer the two questions the client actually
-- asked: "when I select a template, what happens to it?" and "how do we apply
-- them to projects?" - a blueprint you author had no visible trace anywhere.
--
-- One row per apply. `counts` mirrors the shape applyProjectBlueprintService
-- returns ({checklists, documents, reports, label_sets, workflows}) so the
-- history reads back exactly what a given apply produced, without re-deriving
-- it from rows that may since have been edited or deleted.
--
-- Idempotent: safe to re-run.
-- Run against the Everlumen Supabase project.

CREATE TABLE IF NOT EXISTS public.project_blueprint_applications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blueprint_id uuid NOT NULL REFERENCES public.project_templates(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- History outlives the person who made it: SET NULL rather than CASCADE so
  -- removing a member does not silently rewrite what a blueprint has done.
  applied_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counts       jsonb NOT NULL DEFAULT '{}'::jsonb,
  failed_count integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.project_blueprint_applications TO authenticated;
GRANT ALL ON public.project_blueprint_applications TO service_role;

ALTER TABLE public.project_blueprint_applications ENABLE ROW LEVEL SECURITY;

-- Visibility follows the blueprint, matching project_template_items: if you can
-- see the blueprint you can see what it has done. Rows are written by the API
-- with the service role, so there is deliberately no INSERT policy - a client
-- must not be able to fabricate history.
DROP POLICY IF EXISTS "Read blueprint applications via parent"
  ON public.project_blueprint_applications;
CREATE POLICY "Read blueprint applications via parent"
  ON public.project_blueprint_applications FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_templates pt
    WHERE pt.id = project_blueprint_applications.blueprint_id
      AND (
        pt.created_by = auth.uid()
        OR (pt.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
        ))
      )
  ));

-- "Where has this blueprint been used?" (blueprint detail) and "what was this
-- project set up from?" (project header) are the only two read patterns.
CREATE INDEX IF NOT EXISTS project_blueprint_applications_blueprint_idx
  ON public.project_blueprint_applications(blueprint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_blueprint_applications_project_idx
  ON public.project_blueprint_applications(project_id, created_at DESC);
