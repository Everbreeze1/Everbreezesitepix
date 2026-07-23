-- Project Groups: user-owned groupings of projects.
-- Apply manually in the Supabase SQL editor on project ulmgvtuqjlzzadlwtiog.
-- Safe to re-run.

-- ============================================================
-- 1. project_groups table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_groups_owner_idx ON public.project_groups(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_groups TO authenticated;
GRANT ALL ON public.project_groups TO service_role;

ALTER TABLE public.project_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners manage their groups" ON public.project_groups;
CREATE POLICY "Owners manage their groups"
  ON public.project_groups
  FOR ALL
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Update trigger
CREATE OR REPLACE FUNCTION public.project_groups_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_groups_updated_at_trg ON public.project_groups;
CREATE TRIGGER project_groups_updated_at_trg
  BEFORE UPDATE ON public.project_groups
  FOR EACH ROW EXECUTE FUNCTION public.project_groups_set_updated_at();

-- ============================================================
-- 2. project_group_members join table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.project_group_members (
  group_id UUID NOT NULL REFERENCES public.project_groups(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, project_id)
);

CREATE INDEX IF NOT EXISTS project_group_members_project_idx ON public.project_group_members(project_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_group_members TO authenticated;
GRANT ALL ON public.project_group_members TO service_role;

ALTER TABLE public.project_group_members ENABLE ROW LEVEL SECURITY;

-- Members are readable / writable when the caller owns the parent group.
DROP POLICY IF EXISTS "Group owners manage members" ON public.project_group_members;
CREATE POLICY "Group owners manage members"
  ON public.project_group_members
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.project_groups g
      WHERE g.id = project_group_members.group_id
        AND g.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_groups g
      WHERE g.id = project_group_members.group_id
        AND g.owner_id = auth.uid()
    )
  );
