-- Project Templates MVP — run against the SitePix Supabase project.
-- A "project template" is a reusable project blueprint owned by a team.
-- For the MVP it can attach checklist templates; reports/documents come later.

-- ---------------------------------------------------------------------------
-- 1. project_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_templates TO authenticated;
GRANT ALL ON public.project_templates TO service_role;

ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;

-- Any team member can read templates that belong to their team (or that they own solo).
DROP POLICY IF EXISTS "Team members can read project templates" ON public.project_templates;
CREATE POLICY "Team members can read project templates"
  ON public.project_templates
  FOR SELECT
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = project_templates.team_id
          AND tm.user_id = auth.uid()
      )
    )
  );

-- Only owners/admins of the team (or the creator) can write.
DROP POLICY IF EXISTS "Owners and admins can manage project templates" ON public.project_templates;
CREATE POLICY "Owners and admins can manage project templates"
  ON public.project_templates
  FOR ALL
  TO authenticated
  USING (
    created_by = auth.uid()
    OR (
      team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = project_templates.team_id
          AND tm.user_id = auth.uid()
          AND tm.role IN ('owner','admin')
      )
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    OR (
      team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.team_members tm
        WHERE tm.team_id = project_templates.team_id
          AND tm.user_id = auth.uid()
          AND tm.role IN ('owner','admin')
      )
    )
  );

CREATE INDEX IF NOT EXISTS project_templates_team_idx ON public.project_templates(team_id);
CREATE INDEX IF NOT EXISTS project_templates_created_by_idx ON public.project_templates(created_by);

-- ---------------------------------------------------------------------------
-- 2. project_template_checklists — attach checklist templates to a project template
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_template_checklists (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_template_id   uuid NOT NULL REFERENCES public.project_templates(id) ON DELETE CASCADE,
  checklist_template_id uuid NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  position              integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_template_id, checklist_template_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_template_checklists TO authenticated;
GRANT ALL ON public.project_template_checklists TO service_role;

ALTER TABLE public.project_template_checklists ENABLE ROW LEVEL SECURITY;

-- Read if you can read the parent project template.
DROP POLICY IF EXISTS "Read template checklists via parent" ON public.project_template_checklists;
CREATE POLICY "Read template checklists via parent"
  ON public.project_template_checklists
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_templates pt
      WHERE pt.id = project_template_checklists.project_template_id
        AND (
          pt.created_by = auth.uid()
          OR (
            pt.team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    )
  );

-- Write if you can manage the parent project template.
DROP POLICY IF EXISTS "Write template checklists via parent" ON public.project_template_checklists;
CREATE POLICY "Write template checklists via parent"
  ON public.project_template_checklists
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_templates pt
      WHERE pt.id = project_template_checklists.project_template_id
        AND (
          pt.created_by = auth.uid()
          OR (
            pt.team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
                AND tm.role IN ('owner','admin')
            )
          )
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_templates pt
      WHERE pt.id = project_template_checklists.project_template_id
        AND (
          pt.created_by = auth.uid()
          OR (
            pt.team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
                AND tm.role IN ('owner','admin')
            )
          )
        )
    )
  );

CREATE INDEX IF NOT EXISTS project_template_checklists_parent_idx
  ON public.project_template_checklists(project_template_id, position);

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger for project_templates
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_project_template_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_project_templates_updated_at ON public.project_templates;
CREATE TRIGGER trg_project_templates_updated_at
  BEFORE UPDATE ON public.project_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_project_template_updated_at();
