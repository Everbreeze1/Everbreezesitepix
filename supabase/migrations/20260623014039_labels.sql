-- =============================================================================
-- Labels feature - safe, idempotent migration
-- Target: SitePix Supabase project (ulmgvtuqjlzzadlwtiog)
-- Run in: Supabase Dashboard → SQL Editor (safe to re-run)
-- =============================================================================
-- Notes
--   * Does NOT require public.teams / public.team_members to exist.
--   * If those tables are present, team-scoped policies activate automatically.
--   * If they are absent, labels behave as per-user (created_by = auth.uid()).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. labels table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.labels (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid,
  created_by  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  color       text NOT NULL DEFAULT '#3b82f6',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Add the FK to teams(id) only if public.teams exists, and only if the FK
-- isn't already present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'teams'
  )
  AND NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name   = 'labels'
      AND constraint_name = 'labels_team_id_fkey'
  ) THEN
    EXECUTE 'ALTER TABLE public.labels
             ADD CONSTRAINT labels_team_id_fkey
             FOREIGN KEY (team_id) REFERENCES public.teams(id) ON DELETE CASCADE';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.labels TO authenticated;
GRANT ALL ON public.labels TO service_role;

-- Unique label name per team (or per user if no team).
CREATE UNIQUE INDEX IF NOT EXISTS labels_team_name_unique
  ON public.labels (COALESCE(team_id::text, created_by::text), lower(name));

CREATE INDEX IF NOT EXISTS labels_team_idx ON public.labels(team_id);

ALTER TABLE public.labels ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. RLS policies - adapt to whether team_members exists
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  has_team_members boolean;
  has_role_col     boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'team_members'
  ) INTO has_team_members;

  IF has_team_members THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='team_members' AND column_name='role'
    ) INTO has_role_col;
  END IF;

  -- Drop existing policies so we can recreate cleanly
  EXECUTE 'DROP POLICY IF EXISTS "Team members can read labels" ON public.labels';
  EXECUTE 'DROP POLICY IF EXISTS "Members can create labels"    ON public.labels';
  EXECUTE 'DROP POLICY IF EXISTS "Managers can update labels"   ON public.labels';
  EXECUTE 'DROP POLICY IF EXISTS "Managers can delete labels"   ON public.labels';

  IF has_team_members THEN
    EXECUTE $POL$
      CREATE POLICY "Team members can read labels"
        ON public.labels FOR SELECT TO authenticated
        USING (
          created_by = auth.uid()
          OR (team_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.team_members tm
            WHERE tm.team_id = labels.team_id AND tm.user_id = auth.uid()
          ))
        )
    $POL$;

    EXECUTE $POL$
      CREATE POLICY "Members can create labels"
        ON public.labels FOR INSERT TO authenticated
        WITH CHECK (
          created_by = auth.uid()
          AND (
            team_id IS NULL
            OR EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = labels.team_id AND tm.user_id = auth.uid()
            )
          )
        )
    $POL$;

    IF has_role_col THEN
      EXECUTE $POL$
        CREATE POLICY "Managers can update labels"
          ON public.labels FOR UPDATE TO authenticated
          USING (
            created_by = auth.uid()
            OR (team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = labels.team_id AND tm.user_id = auth.uid()
                AND tm.role IN ('owner','admin')
            ))
          )
          WITH CHECK (true)
      $POL$;

      EXECUTE $POL$
        CREATE POLICY "Managers can delete labels"
          ON public.labels FOR DELETE TO authenticated
          USING (
            created_by = auth.uid()
            OR (team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = labels.team_id AND tm.user_id = auth.uid()
                AND tm.role IN ('owner','admin')
            ))
          )
      $POL$;
    ELSE
      EXECUTE $POL$
        CREATE POLICY "Managers can update labels"
          ON public.labels FOR UPDATE TO authenticated
          USING (
            created_by = auth.uid()
            OR (team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = labels.team_id AND tm.user_id = auth.uid()
            ))
          )
          WITH CHECK (true)
      $POL$;

      EXECUTE $POL$
        CREATE POLICY "Managers can delete labels"
          ON public.labels FOR DELETE TO authenticated
          USING (
            created_by = auth.uid()
            OR (team_id IS NOT NULL AND EXISTS (
              SELECT 1 FROM public.team_members tm
              WHERE tm.team_id = labels.team_id AND tm.user_id = auth.uid()
            ))
          )
      $POL$;
    END IF;

  ELSE
    -- No team_members table: per-user policies only.
    EXECUTE $POL$
      CREATE POLICY "Team members can read labels"
        ON public.labels FOR SELECT TO authenticated
        USING (created_by = auth.uid())
    $POL$;

    EXECUTE $POL$
      CREATE POLICY "Members can create labels"
        ON public.labels FOR INSERT TO authenticated
        WITH CHECK (created_by = auth.uid())
    $POL$;

    EXECUTE $POL$
      CREATE POLICY "Managers can update labels"
        ON public.labels FOR UPDATE TO authenticated
        USING (created_by = auth.uid())
        WITH CHECK (created_by = auth.uid())
    $POL$;

    EXECUTE $POL$
      CREATE POLICY "Managers can delete labels"
        ON public.labels FOR DELETE TO authenticated
        USING (created_by = auth.uid())
    $POL$;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_labels_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_labels_updated_at ON public.labels;
CREATE TRIGGER trg_labels_updated_at
  BEFORE UPDATE ON public.labels
  FOR EACH ROW EXECUTE FUNCTION public.touch_labels_updated_at();

-- ---------------------------------------------------------------------------
-- 4. projects.labels (text[]) - only if public.projects exists
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'projects'
  ) THEN
    EXECUTE 'ALTER TABLE public.projects
             ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT ''{}''';
    EXECUTE 'CREATE INDEX IF NOT EXISTS projects_labels_idx
             ON public.projects USING gin (labels)';
  END IF;
END $$;
