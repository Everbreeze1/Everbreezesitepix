-- Project Blueprints: attach any template kind (document / report / label set /
-- workflow / checklist) to a project template. Existing project_template_checklists
-- rows stay valid; new kinds go through this generic table.
-- Run against the Everlumen Supabase project.

CREATE TABLE IF NOT EXISTS public.project_template_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_template_id uuid NOT NULL REFERENCES public.project_templates(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('checklist','document','report','label_set','workflow')),
  ref_id              uuid NOT NULL,
  position            integer NOT NULL DEFAULT 0,
  config              jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_template_id, kind, ref_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_template_items TO authenticated;
GRANT ALL ON public.project_template_items TO service_role;

ALTER TABLE public.project_template_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read template items via parent" ON public.project_template_items;
CREATE POLICY "Read template items via parent"
  ON public.project_template_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_templates pt
    WHERE pt.id = project_template_items.project_template_id
      AND (
        pt.created_by = auth.uid()
        OR (pt.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
        ))
      )
  ));

DROP POLICY IF EXISTS "Write template items via parent" ON public.project_template_items;
CREATE POLICY "Write template items via parent"
  ON public.project_template_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.project_templates pt
    WHERE pt.id = project_template_items.project_template_id
      AND (
        pt.created_by = auth.uid()
        OR (pt.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
            AND tm.role IN ('owner','admin')
        ))
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.project_templates pt
    WHERE pt.id = project_template_items.project_template_id
      AND (
        pt.created_by = auth.uid()
        OR (pt.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = pt.team_id AND tm.user_id = auth.uid()
            AND tm.role IN ('owner','admin')
        ))
      )
  ));

CREATE INDEX IF NOT EXISTS project_template_items_parent_idx
  ON public.project_template_items(project_template_id, position);
CREATE INDEX IF NOT EXISTS project_template_items_kind_ref_idx
  ON public.project_template_items(kind, ref_id);
