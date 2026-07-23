-- Add assigned_to to project_checklists for assigning checklists to team members
ALTER TABLE public.project_checklists
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS project_checklists_assigned_to_idx
  ON public.project_checklists(assigned_to);
