-- Teams v1: account owner + invited members share projects.
-- Apply via Supabase SQL editor on project ulmgvtuqjlzzadlwtiog.
-- This migration is ADDITIVE — existing owner-only RLS policies remain,
-- and we add teammate-access policies alongside them (RLS combines with OR).

-- ============================================================
-- Enum: team_role
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.team_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- teams
-- ============================================================
CREATE TABLE IF NOT EXISTS public.teams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS teams_one_per_owner ON public.teams(owner_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.teams TO authenticated;
GRANT ALL ON public.teams TO service_role;

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- team_members
-- ============================================================
CREATE TABLE IF NOT EXISTS public.team_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.team_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, user_id),
  UNIQUE (user_id) -- a user belongs to at most one team in v1
);
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON public.team_members(team_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON public.team_members(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_members TO authenticated;
GRANT ALL ON public.team_members TO service_role;

ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- team_invites
-- ============================================================
CREATE TABLE IF NOT EXISTS public.team_invites (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role public.team_role NOT NULL DEFAULT 'member',
  token TEXT NOT NULL UNIQUE,
  invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at TIMESTAMPTZ,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_invites_team_id_idx ON public.team_invites(team_id);
CREATE INDEX IF NOT EXISTS team_invites_email_idx ON public.team_invites(lower(email));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- Helper: which team does a user belong to?
-- ============================================================
CREATE OR REPLACE FUNCTION public.user_team_id(_user_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT team_id FROM public.team_members WHERE user_id = _user_id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.are_teammates(_a UUID, _b UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _a = _b OR EXISTS (
    SELECT 1
    FROM public.team_members ma
    JOIN public.team_members mb ON ma.team_id = mb.team_id
    WHERE ma.user_id = _a AND mb.user_id = _b
  )
$$;

CREATE OR REPLACE FUNCTION public.is_team_admin(_user_id UUID, _team_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members
    WHERE user_id = _user_id AND team_id = _team_id AND role IN ('owner', 'admin')
  )
$$;

-- ============================================================
-- RLS: teams
-- ============================================================
DROP POLICY IF EXISTS "Members view their team" ON public.teams;
CREATE POLICY "Members view their team" ON public.teams
  FOR SELECT TO authenticated USING (
    owner_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.team_members tm WHERE tm.team_id = id AND tm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Users create their own team" ON public.teams;
CREATE POLICY "Users create their own team" ON public.teams
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner updates their team" ON public.teams;
CREATE POLICY "Owner updates their team" ON public.teams
  FOR UPDATE TO authenticated USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owner deletes their team" ON public.teams;
CREATE POLICY "Owner deletes their team" ON public.teams
  FOR DELETE TO authenticated USING (owner_id = auth.uid());

-- ============================================================
-- RLS: team_members
-- ============================================================
DROP POLICY IF EXISTS "Members view team roster" ON public.team_members;
CREATE POLICY "Members view team roster" ON public.team_members
  FOR SELECT TO authenticated USING (
    team_id = public.user_team_id(auth.uid())
  );

DROP POLICY IF EXISTS "Admins manage team members" ON public.team_members;
CREATE POLICY "Admins manage team members" ON public.team_members
  FOR ALL TO authenticated
  USING (public.is_team_admin(auth.uid(), team_id))
  WITH CHECK (public.is_team_admin(auth.uid(), team_id));

DROP POLICY IF EXISTS "Users leave their team" ON public.team_members;
CREATE POLICY "Users leave their team" ON public.team_members
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- ============================================================
-- RLS: team_invites
-- ============================================================
DROP POLICY IF EXISTS "Admins manage invites" ON public.team_invites;
CREATE POLICY "Admins manage invites" ON public.team_invites
  FOR ALL TO authenticated
  USING (public.is_team_admin(auth.uid(), team_id))
  WITH CHECK (public.is_team_admin(auth.uid(), team_id));

-- Accept-invite flow uses service role; no anon read needed.

-- ============================================================
-- Teammate access to shared resources (ADDITIVE policies).
-- Existing owner-only policies remain — RLS unions across policies.
-- ============================================================

-- projects
DROP POLICY IF EXISTS "Teammates view team projects" ON public.projects;
CREATE POLICY "Teammates view team projects" ON public.projects
  FOR SELECT TO authenticated USING (public.are_teammates(auth.uid(), created_by));

DROP POLICY IF EXISTS "Teammates update team projects" ON public.projects;
CREATE POLICY "Teammates update team projects" ON public.projects
  FOR UPDATE TO authenticated USING (public.are_teammates(auth.uid(), created_by));

DROP POLICY IF EXISTS "Teammates insert team projects" ON public.projects;
CREATE POLICY "Teammates insert team projects" ON public.projects
  FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS "Teammates delete team projects" ON public.projects;
CREATE POLICY "Teammates delete team projects" ON public.projects
  FOR DELETE TO authenticated USING (public.are_teammates(auth.uid(), created_by));

-- photos
DROP POLICY IF EXISTS "Teammates view team photos" ON public.photos;
CREATE POLICY "Teammates view team photos" ON public.photos
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

DROP POLICY IF EXISTS "Teammates insert team photos" ON public.photos;
CREATE POLICY "Teammates insert team photos" ON public.photos
  FOR INSERT TO authenticated WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

DROP POLICY IF EXISTS "Teammates update team photos" ON public.photos;
CREATE POLICY "Teammates update team photos" ON public.photos
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

DROP POLICY IF EXISTS "Teammates delete team photos" ON public.photos;
CREATE POLICY "Teammates delete team photos" ON public.photos
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

-- videos
DROP POLICY IF EXISTS "Teammates manage team videos" ON public.videos;
CREATE POLICY "Teammates manage team videos" ON public.videos
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

-- walkthroughs
DROP POLICY IF EXISTS "Teammates manage team walkthroughs" ON public.walkthroughs;
CREATE POLICY "Teammates manage team walkthroughs" ON public.walkthroughs
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

-- project_checklists
DROP POLICY IF EXISTS "Teammates manage team project checklists" ON public.project_checklists;
CREATE POLICY "Teammates manage team project checklists" ON public.project_checklists
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.projects p WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by))
  );

-- project_checklist_items
DROP POLICY IF EXISTS "Teammates manage team checklist items" ON public.project_checklist_items;
CREATE POLICY "Teammates manage team checklist items" ON public.project_checklist_items
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.project_checklists c
      JOIN public.projects p ON p.id = c.project_id
      WHERE c.id = checklist_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- ============================================================
-- updated_at trigger for teams
-- ============================================================
DROP TRIGGER IF EXISTS teams_updated_at ON public.teams;
CREATE TRIGGER teams_updated_at
  BEFORE UPDATE ON public.teams
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
