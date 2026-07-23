-- Checklists v1: workspace templates + per-project instances
-- Apply via: supabase db push  (or paste into Supabase SQL editor for project ulmgvtuqjlzzadlwtiog)
-- Owned by individual users (created_by). Scoped to project owner for project_checklists.

-- ============================================================
-- checklist_templates
-- ============================================================
CREATE TABLE public.checklist_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX checklist_templates_created_by_idx ON public.checklist_templates(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_templates TO authenticated;
GRANT ALL ON public.checklist_templates TO service_role;

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own templates" ON public.checklist_templates
  FOR SELECT TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users insert own templates" ON public.checklist_templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users update own templates" ON public.checklist_templates
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users delete own templates" ON public.checklist_templates
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- ============================================================
-- checklist_template_items
-- ============================================================
CREATE TABLE public.checklist_template_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.checklist_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX checklist_template_items_template_id_idx ON public.checklist_template_items(template_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.checklist_template_items TO authenticated;
GRANT ALL ON public.checklist_template_items TO service_role;

ALTER TABLE public.checklist_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own template items" ON public.checklist_template_items
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.checklist_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );
CREATE POLICY "Users insert own template items" ON public.checklist_template_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.checklist_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );
CREATE POLICY "Users update own template items" ON public.checklist_template_items
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.checklist_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );
CREATE POLICY "Users delete own template items" ON public.checklist_template_items
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.checklist_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );

-- ============================================================
-- project_checklists
-- ============================================================
CREATE TABLE public.project_checklists (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_checklists_project_id_idx ON public.project_checklists(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_checklists TO authenticated;
GRANT ALL ON public.project_checklists TO service_role;

ALTER TABLE public.project_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view checklists on own projects" ON public.project_checklists
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );
CREATE POLICY "Users insert checklists on own projects" ON public.project_checklists
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );
CREATE POLICY "Users update checklists on own projects" ON public.project_checklists
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );
CREATE POLICY "Users delete checklists on own projects" ON public.project_checklists
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );

-- ============================================================
-- project_checklist_items
-- ============================================================
CREATE TABLE public.project_checklist_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  checklist_id UUID NOT NULL REFERENCES public.project_checklists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_checklist_items_checklist_id_idx ON public.project_checklist_items(checklist_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_checklist_items TO authenticated;
GRANT ALL ON public.project_checklist_items TO service_role;

ALTER TABLE public.project_checklist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view items on own project checklists" ON public.project_checklist_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_checklists c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = checklist_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Users insert items on own project checklists" ON public.project_checklist_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_checklists c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = checklist_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Users update items on own project checklists" ON public.project_checklist_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_checklists c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = checklist_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Users delete items on own project checklists" ON public.project_checklist_items
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_checklists c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = checklist_id AND p.created_by = auth.uid()
    )
  );

-- ============================================================
-- updated_at trigger for templates
-- ============================================================
CREATE TRIGGER checklist_templates_updated_at
  BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_checklists;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_checklist_items;
