-- Templates redesign - new template kinds.
-- Run against the Everlumen Supabase project.
--
-- Adds three new template kinds so users can build reusable blueprints beyond
-- checklists/workflows:
--   1. label_sets       - named bundles of labels (name + color) applied to projects
--   2. report_templates - reusable report structure (title, subtitle, sections)
--   3. document_templates - Word-style rich documents with placeholder fields
--
-- All three follow the same team-scoped RLS pattern as project_templates.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. label_sets + label_set_items
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.label_sets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_sets TO authenticated;
GRANT ALL ON public.label_sets TO service_role;
ALTER TABLE public.label_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can read label sets" ON public.label_sets;
CREATE POLICY "Team members can read label sets"
  ON public.label_sets FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = label_sets.team_id AND tm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "Owners and admins manage label sets" ON public.label_sets;
CREATE POLICY "Owners and admins manage label sets"
  ON public.label_sets FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = label_sets.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    ))
  )
  WITH CHECK (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = label_sets.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    ))
  );

CREATE INDEX IF NOT EXISTS label_sets_team_idx ON public.label_sets(team_id);
CREATE INDEX IF NOT EXISTS label_sets_created_by_idx ON public.label_sets(created_by);

CREATE TABLE IF NOT EXISTS public.label_set_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label_set_id uuid NOT NULL REFERENCES public.label_sets(id) ON DELETE CASCADE,
  name         text NOT NULL,
  color        text NOT NULL DEFAULT '#2563eb',
  position     integer NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_set_items TO authenticated;
GRANT ALL ON public.label_set_items TO service_role;
ALTER TABLE public.label_set_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read label set items via parent" ON public.label_set_items;
CREATE POLICY "Read label set items via parent"
  ON public.label_set_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.label_sets ls
    WHERE ls.id = label_set_items.label_set_id
      AND (
        ls.created_by = auth.uid()
        OR (ls.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = ls.team_id AND tm.user_id = auth.uid()
        ))
      )
  ));

DROP POLICY IF EXISTS "Write label set items via parent" ON public.label_set_items;
CREATE POLICY "Write label set items via parent"
  ON public.label_set_items FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.label_sets ls
    WHERE ls.id = label_set_items.label_set_id
      AND (
        ls.created_by = auth.uid()
        OR (ls.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = ls.team_id AND tm.user_id = auth.uid()
            AND tm.role IN ('owner','admin')
        ))
      )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.label_sets ls
    WHERE ls.id = label_set_items.label_set_id
      AND (
        ls.created_by = auth.uid()
        OR (ls.team_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.team_members tm
          WHERE tm.team_id = ls.team_id AND tm.user_id = auth.uid()
            AND tm.role IN ('owner','admin')
        ))
      )
  ));

CREATE INDEX IF NOT EXISTS label_set_items_parent_idx
  ON public.label_set_items(label_set_id, position);

-- ---------------------------------------------------------------------------
-- 2. report_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.report_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  subtitle    text,
  sections    jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ heading, body }]
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.report_templates TO authenticated;
GRANT ALL ON public.report_templates TO service_role;
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can read report templates" ON public.report_templates;
CREATE POLICY "Team members can read report templates"
  ON public.report_templates FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = report_templates.team_id AND tm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "Owners and admins manage report templates" ON public.report_templates;
CREATE POLICY "Owners and admins manage report templates"
  ON public.report_templates FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = report_templates.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    ))
  )
  WITH CHECK (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = report_templates.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    ))
  );

CREATE INDEX IF NOT EXISTS report_templates_team_idx ON public.report_templates(team_id);
CREATE INDEX IF NOT EXISTS report_templates_created_by_idx ON public.report_templates(created_by);

-- ---------------------------------------------------------------------------
-- 3. document_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.document_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid REFERENCES public.teams(id) ON DELETE CASCADE,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  body        jsonb NOT NULL DEFAULT '{}'::jsonb, -- Tiptap doc JSON
  fields      text[] NOT NULL DEFAULT '{}',       -- placeholder field names
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_templates TO authenticated;
GRANT ALL ON public.document_templates TO service_role;
ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Team members can read document templates" ON public.document_templates;
CREATE POLICY "Team members can read document templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = document_templates.team_id AND tm.user_id = auth.uid()
    ))
  );

DROP POLICY IF EXISTS "Owners and admins manage document templates" ON public.document_templates;
CREATE POLICY "Owners and admins manage document templates"
  ON public.document_templates FOR ALL TO authenticated
  USING (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = document_templates.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    ))
  )
  WITH CHECK (
    created_by = auth.uid()
    OR (team_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.team_members tm
      WHERE tm.team_id = document_templates.team_id AND tm.user_id = auth.uid()
        AND tm.role IN ('owner','admin')
    ))
  );

CREATE INDEX IF NOT EXISTS document_templates_team_idx ON public.document_templates(team_id);
CREATE INDEX IF NOT EXISTS document_templates_created_by_idx ON public.document_templates(created_by);

-- ---------------------------------------------------------------------------
-- 4. Shared updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_template_kind_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_label_sets_updated_at ON public.label_sets;
CREATE TRIGGER trg_label_sets_updated_at
  BEFORE UPDATE ON public.label_sets
  FOR EACH ROW EXECUTE FUNCTION public.touch_template_kind_updated_at();

DROP TRIGGER IF EXISTS trg_report_templates_updated_at ON public.report_templates;
CREATE TRIGGER trg_report_templates_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_template_kind_updated_at();

DROP TRIGGER IF EXISTS trg_document_templates_updated_at ON public.document_templates;
CREATE TRIGGER trg_document_templates_updated_at
  BEFORE UPDATE ON public.document_templates
  FOR EACH ROW EXECUTE FUNCTION public.touch_template_kind_updated_at();
