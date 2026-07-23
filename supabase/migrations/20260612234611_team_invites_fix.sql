-- Fix: team_invites is missing the `role` column (and possibly others).
-- Cause: a prior team_invites table existed without `role`, so CREATE TABLE
-- IF NOT EXISTS in the v1 migration was a no-op. This script is idempotent
-- and brings the table up to the expected shape.
-- Apply in Supabase SQL editor on project ulmgvtuqjlzzadlwtiog.

-- Make sure the enum exists (no-op if it already does)
DO $$ BEGIN
  CREATE TYPE public.team_role AS ENUM ('owner', 'admin', 'member');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Create team_invites if it really doesn't exist
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

-- Add any columns that are missing on an older table shape
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS role public.team_role NOT NULL DEFAULT 'member';
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS token TEXT;
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days');
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.team_invites
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Unique index on token (no-op if already there)
CREATE UNIQUE INDEX IF NOT EXISTS team_invites_token_key ON public.team_invites(token);
CREATE INDEX IF NOT EXISTS team_invites_team_id_idx ON public.team_invites(team_id);
CREATE INDEX IF NOT EXISTS team_invites_email_idx ON public.team_invites(lower(email));

-- Grants + RLS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.team_invites TO authenticated;
GRANT ALL ON public.team_invites TO service_role;
ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage invites" ON public.team_invites;
CREATE POLICY "Admins manage invites" ON public.team_invites
  FOR ALL TO authenticated
  USING (public.is_team_admin(auth.uid(), team_id))
  WITH CHECK (public.is_team_admin(auth.uid(), team_id));

-- Force PostgREST to reload its schema cache
NOTIFY pgrst, 'reload schema';
