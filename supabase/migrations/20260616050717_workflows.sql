-- Workflows v1: workspace templates (phases + items) and per-project instances.
-- Apply via Supabase SQL editor for project ulmgvtuqjlzzadlwtiog.
-- Mirrors the checklists ownership pattern: templates owned by created_by,
-- instances scoped to the project owner.

-- ============================================================
-- workflow_templates
-- ============================================================
CREATE TABLE public.workflow_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  archived BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_templates_created_by_idx ON public.workflow_templates(created_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_templates TO authenticated;
GRANT ALL ON public.workflow_templates TO service_role;

ALTER TABLE public.workflow_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own workflow templates" ON public.workflow_templates
  FOR SELECT TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users insert own workflow templates" ON public.workflow_templates
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Users update own workflow templates" ON public.workflow_templates
  FOR UPDATE TO authenticated USING (auth.uid() = created_by);
CREATE POLICY "Users delete own workflow templates" ON public.workflow_templates
  FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- ============================================================
-- workflow_template_phases
-- ============================================================
CREATE TABLE public.workflow_template_phases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.workflow_templates(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  requires_signoff BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_template_phases_template_id_idx ON public.workflow_template_phases(template_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_template_phases TO authenticated;
GRANT ALL ON public.workflow_template_phases TO service_role;

ALTER TABLE public.workflow_template_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own template phases" ON public.workflow_template_phases
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workflow_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );
CREATE POLICY "Insert own template phases" ON public.workflow_template_phases
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.workflow_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );
CREATE POLICY "Update own template phases" ON public.workflow_template_phases
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workflow_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );
CREATE POLICY "Delete own template phases" ON public.workflow_template_phases
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.workflow_templates t WHERE t.id = template_id AND t.created_by = auth.uid())
  );

-- ============================================================
-- workflow_template_items
-- ============================================================
CREATE TABLE public.workflow_template_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_id UUID NOT NULL REFERENCES public.workflow_template_phases(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'photo', 'note')),
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX workflow_template_items_phase_id_idx ON public.workflow_template_items(phase_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workflow_template_items TO authenticated;
GRANT ALL ON public.workflow_template_items TO service_role;

ALTER TABLE public.workflow_template_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own template items" ON public.workflow_template_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.workflow_template_phases p
      JOIN public.workflow_templates t ON t.id = p.template_id
      WHERE p.id = phase_id AND t.created_by = auth.uid()
    )
  );
CREATE POLICY "Insert own template items" ON public.workflow_template_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workflow_template_phases p
      JOIN public.workflow_templates t ON t.id = p.template_id
      WHERE p.id = phase_id AND t.created_by = auth.uid()
    )
  );
CREATE POLICY "Update own template items" ON public.workflow_template_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.workflow_template_phases p
      JOIN public.workflow_templates t ON t.id = p.template_id
      WHERE p.id = phase_id AND t.created_by = auth.uid()
    )
  );
CREATE POLICY "Delete own template items" ON public.workflow_template_items
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.workflow_template_phases p
      JOIN public.workflow_templates t ON t.id = p.template_id
      WHERE p.id = phase_id AND t.created_by = auth.uid()
    )
  );

-- ============================================================
-- project_workflows  (per-project instance, snapshot of template at apply time)
-- ============================================================
CREATE TABLE public.project_workflows (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.workflow_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_workflows_project_id_idx ON public.project_workflows(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_workflows TO authenticated;
GRANT ALL ON public.project_workflows TO service_role;

ALTER TABLE public.project_workflows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View workflows on own projects" ON public.project_workflows
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );
CREATE POLICY "Insert workflows on own projects" ON public.project_workflows
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );
CREATE POLICY "Update workflows on own projects" ON public.project_workflows
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );
CREATE POLICY "Delete workflows on own projects" ON public.project_workflows
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND p.created_by = auth.uid())
  );

-- ============================================================
-- project_workflow_phases
-- ============================================================
CREATE TABLE public.project_workflow_phases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workflow_id UUID NOT NULL REFERENCES public.project_workflows(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL,
  description TEXT,
  requires_signoff BOOLEAN NOT NULL DEFAULT false,
  notes TEXT,
  signed_off_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  signed_off_at TIMESTAMPTZ,
  signoff_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_workflow_phases_workflow_id_idx ON public.project_workflow_phases(workflow_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_workflow_phases TO authenticated;
GRANT ALL ON public.project_workflow_phases TO service_role;

ALTER TABLE public.project_workflow_phases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own workflow phases" ON public.project_workflow_phases
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflows w
      JOIN public.projects p ON p.id = w.project_id
      WHERE w.id = workflow_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Insert own workflow phases" ON public.project_workflow_phases
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_workflows w
      JOIN public.projects p ON p.id = w.project_id
      WHERE w.id = workflow_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Update own workflow phases" ON public.project_workflow_phases
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflows w
      JOIN public.projects p ON p.id = w.project_id
      WHERE w.id = workflow_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Delete own workflow phases" ON public.project_workflow_phases
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflows w
      JOIN public.projects p ON p.id = w.project_id
      WHERE w.id = workflow_id AND p.created_by = auth.uid()
    )
  );

-- ============================================================
-- project_workflow_items
-- ============================================================
CREATE TABLE public.project_workflow_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  phase_id UUID NOT NULL REFERENCES public.project_workflow_phases(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('check', 'photo', 'note')),
  label TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  photo_id UUID REFERENCES public.photos(id) ON DELETE SET NULL,
  note_text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX project_workflow_items_phase_id_idx ON public.project_workflow_items(phase_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_workflow_items TO authenticated;
GRANT ALL ON public.project_workflow_items TO service_role;

ALTER TABLE public.project_workflow_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View own workflow items" ON public.project_workflow_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
      JOIN public.projects p ON p.id = w.project_id
      WHERE ph.id = phase_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Insert own workflow items" ON public.project_workflow_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
      JOIN public.projects p ON p.id = w.project_id
      WHERE ph.id = phase_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Update own workflow items" ON public.project_workflow_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
      JOIN public.projects p ON p.id = w.project_id
      WHERE ph.id = phase_id AND p.created_by = auth.uid()
    )
  );
CREATE POLICY "Delete own workflow items" ON public.project_workflow_items
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_workflow_phases ph
      JOIN public.project_workflows w ON w.id = ph.workflow_id
      JOIN public.projects p ON p.id = w.project_id
      WHERE ph.id = phase_id AND p.created_by = auth.uid()
    )
  );

-- ============================================================
-- updated_at trigger
-- ============================================================
CREATE TRIGGER workflow_templates_updated_at
  BEFORE UPDATE ON public.workflow_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================
-- Realtime
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_workflows;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_workflow_phases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.project_workflow_items;
