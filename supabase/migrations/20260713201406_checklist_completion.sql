-- Checklist completion: track when a checklist is marked complete and store
-- a snapshot (items + responses) so completed checklists can be surfaced in
-- the project's Documents tab.
-- Idempotent. Safe to re-run.

ALTER TABLE public.project_checklists
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS snapshot jsonb;

CREATE INDEX IF NOT EXISTS project_checklists_completed_at_idx
  ON public.project_checklists(project_id, completed_at DESC);
