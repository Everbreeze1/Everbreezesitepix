-- Tasks: add proper assignee_user_id (team member) field
-- Apply via: supabase db push (or paste into Supabase SQL editor for project ulmgvtuqjlzzadlwtiog)

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assignee_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_assignee_user_id_idx
  ON public.tasks(assignee_user_id);
