-- Let the new roles actually be stored.
--
-- ---------------------------------------------------------------------------
-- THE BUG, AND WHY NOTHING CAUGHT IT
-- ---------------------------------------------------------------------------
-- 20260909000000 added 'manager', 'standard' and 'restricted' to the
-- `public.team_role` ENUM. That worked. But the live `team_members` table also
-- carries a CHECK constraint, `team_members_role_check`, which independently
-- restricts the same column to the ORIGINAL three values - and that constraint
-- exists only on the database. It appears in no migration in this folder, so
-- reading the repo gives no hint it is there.
--
-- Result, in production, before this file:
--
--   INSERT ... role = 'member'      -> 201 Created
--   INSERT ... role = 'manager'     -> 400, SQLSTATE 23514
--   INSERT ... role = 'restricted'  -> 400, SQLSTATE 23514
--
-- So the pricing card sold "Advanced roles & permissions", the picker offered
-- Manager and Restricted, `updateMemberRole` accepted them, and the database
-- refused every one. The feature was unreachable end to end.
--
-- It survived verification because the check that was run - filtering
-- `team_members?role=eq.restricted` - only proves the ENUM can PARSE the label.
-- A CHECK constraint is evaluated on WRITE, and nothing wrote. Reading a value
-- back is not evidence you can store it; only an INSERT is. The end-to-end test
-- that finally caught this creates a real user, gives them the role, and signs
-- in as them.
--
-- ---------------------------------------------------------------------------
-- WHY `role::text` RATHER THAN THE ENUM
-- ---------------------------------------------------------------------------
-- The presence of a CHECK on an enum-typed column is itself odd, and it means
-- the live column and 20260612191404's definition of it have drifted at some
-- point. Comparing `role::text` against a list of strings is correct whether
-- the column is `public.team_role` or plain TEXT, so this file does not have to
-- guess which one production actually has.
--
-- 'member' stays in the list. It is the historical spelling of Standard, every
-- existing non-admin row still carries it, and dropping it here would fail the
-- constraint against live data the moment it is validated.
--
-- Idempotent: DROP CONSTRAINT IF EXISTS before ADD. Safe to re-run.
-- Apply in the SitePix Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

-- ===========================================================================
-- team_members
-- ===========================================================================
ALTER TABLE public.team_members
  DROP CONSTRAINT IF EXISTS team_members_role_check;

ALTER TABLE public.team_members
  ADD CONSTRAINT team_members_role_check
  CHECK (role::text IN ('owner', 'admin', 'manager', 'standard', 'member', 'restricted'));

-- ===========================================================================
-- team_invites
-- ===========================================================================
-- Same column, same enum, same story - and inviting somebody straight in as a
-- Manager is a thing the invite dialog can legitimately do, so it needs the
-- same widening. Written defensively: if no such constraint exists on this
-- table, the DROP is a no-op and the ADD simply creates one that matches
-- team_members, which is where it should have been anyway.
ALTER TABLE public.team_invites
  DROP CONSTRAINT IF EXISTS team_invites_role_check;

ALTER TABLE public.team_invites
  ADD CONSTRAINT team_invites_role_check
  CHECK (role::text IN ('owner', 'admin', 'manager', 'standard', 'member', 'restricted'));

-- === VERIFY ================================================================
-- The constraints now name all six roles:
--
-- SELECT conrelid::regclass AS table, conname, pg_get_constraintdef(oid)
--   FROM pg_constraint
--  WHERE conname IN ('team_members_role_check', 'team_invites_role_check');
--
-- The real proof is a WRITE, not a read - that is the mistake this file exists
-- to correct. Against a scratch row, each of these must succeed and then be
-- rolled back:
--
-- BEGIN;
--   UPDATE public.team_members SET role = 'manager'    WHERE role = 'member';
--   UPDATE public.team_members SET role = 'restricted' WHERE role = 'manager';
--   UPDATE public.team_members SET role = 'standard'   WHERE role = 'restricted';
-- ROLLBACK;
--
-- Nothing was migrated, so the roster is untouched. Counts should be unchanged:
--
-- SELECT role, count(*) FROM public.team_members GROUP BY 1 ORDER BY 2 DESC;
