-- Add labels/tags to project_templates - run against the Everlumen Supabase project.
-- Labels are free-form text tags used to organize templates (e.g. "HVAC Install").

ALTER TABLE public.project_templates
  ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS project_templates_labels_idx
  ON public.project_templates USING gin (labels);
