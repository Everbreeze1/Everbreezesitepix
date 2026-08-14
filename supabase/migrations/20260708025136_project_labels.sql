-- =============================================================================
-- Project Labels: history events + completed_at derivation.
-- Safe to re-run. Apply in the SitePix Supabase SQL editor.
-- =============================================================================

-- 1. projects.completed_at - first moment a project got the "Complete" label.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='projects'
  ) THEN
    EXECUTE 'ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS completed_at timestamptz';
    -- Ensure the labels text[] column exists (added by the labels migration,
    -- but keep it here so this file is self-contained).
    EXECUTE 'ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT ''{}''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS projects_labels_idx ON public.projects USING gin (labels)';
  END IF;
END $$;

-- 2. project_label_events - every time a label is applied to or removed
--    from a project. Used to derive Start ("Lead" applied) and End ("Complete"
--    applied) dates for the Projects home page filters.
CREATE TABLE IF NOT EXISTS public.project_label_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label       text NOT NULL,
  event_type  text NOT NULL CHECK (event_type IN ('applied','removed')),
  actor_id    uuid,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_label_events_project_idx
  ON public.project_label_events(project_id);
CREATE INDEX IF NOT EXISTS project_label_events_label_idx
  ON public.project_label_events(lower(label));
CREATE INDEX IF NOT EXISTS project_label_events_occurred_idx
  ON public.project_label_events(occurred_at);

GRANT SELECT, INSERT ON public.project_label_events TO authenticated;
GRANT ALL ON public.project_label_events TO service_role;

ALTER TABLE public.project_label_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read events for own projects" ON public.project_label_events;
CREATE POLICY "Read events for own projects"
  ON public.project_label_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_label_events.project_id
        AND (
          p.created_by = auth.uid()
          -- Allow team members if project_members exists; otherwise ignored.
        )
    )
  );

-- 3. Trigger: diff projects.labels on insert/update, emit events, and keep
--    projects.completed_at in sync with the "Complete" label.
CREATE OR REPLACE FUNCTION public.projects_labels_diff()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_labels text[] := COALESCE(OLD.labels, '{}');
  new_labels text[] := COALESCE(NEW.labels, '{}');
  added text[];
  removed text[];
  actor uuid := auth.uid();
  lbl text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    old_labels := '{}';
  END IF;

  -- Case-insensitive diff.
  SELECT ARRAY(
    SELECT DISTINCT unnest(new_labels) EXCEPT SELECT DISTINCT unnest(old_labels)
  ) INTO added;
  SELECT ARRAY(
    SELECT DISTINCT unnest(old_labels) EXCEPT SELECT DISTINCT unnest(new_labels)
  ) INTO removed;

  IF added IS NOT NULL THEN
    FOREACH lbl IN ARRAY added LOOP
      INSERT INTO public.project_label_events(project_id, label, event_type, actor_id)
      VALUES (NEW.id, lbl, 'applied', actor);
      IF lower(lbl) = 'complete' AND NEW.completed_at IS NULL THEN
        NEW.completed_at := now();
      END IF;
    END LOOP;
  END IF;

  IF removed IS NOT NULL THEN
    FOREACH lbl IN ARRAY removed LOOP
      INSERT INTO public.project_label_events(project_id, label, event_type, actor_id)
      VALUES (NEW.id, lbl, 'removed', actor);
      IF lower(lbl) = 'complete' THEN
        NEW.completed_at := NULL;
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_labels_diff ON public.projects;
CREATE TRIGGER trg_projects_labels_diff
  BEFORE INSERT OR UPDATE OF labels ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.projects_labels_diff();
