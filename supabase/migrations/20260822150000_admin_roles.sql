-- Admin dashboard: split platform admin into capability roles.
--
-- WHY
--
-- `platform_admins` is binary: a row means total access. That was defensible
-- when the console could do four things, all of them read-only or trivial. It
-- is not defensible now that the same table gates deleting a customer account,
-- comping a team onto the top tier, cancelling a live subscription, and
-- revoking every share link a customer has sent.
--
-- Support is not billing is not engineering. Somebody answering tickets needs
-- to read accounts and resend a confirmation email; they do not need to be one
-- mis-click from deleting the account or from granting themselves a permanent
-- free plan.
--
-- The default is deliberately `superadmin`. Existing rows keep exactly the
-- access they have today - this migration must not lock anyone out of the
-- console mid-shift - and narrowing an individual is a follow-up decision made
-- per person, in the Users screen.
--
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent. Safe to re-run.

ALTER TABLE public.platform_admins
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'superadmin';

-- Any pre-existing NULL (possible if the column was added by hand without the
-- default) becomes superadmin, for the no-lockout reason above.
UPDATE public.platform_admins SET role = 'superadmin' WHERE role IS NULL OR role = '';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'platform_admins_role_check') THEN
    ALTER TABLE public.platform_admins
      ADD CONSTRAINT platform_admins_role_check
      CHECK (role IN ('support', 'billing', 'superadmin'));
  END IF;
END $$;

-- Access is unchanged and stays unchanged: no grants for `authenticated`, so
-- RLS default-denies every client read. The API reaches this table through the
-- service role only, in requirePlatformAdmin().
GRANT ALL ON public.platform_admins TO service_role;

-- Verify:
--   SELECT user_id, role, granted_at FROM public.platform_admins ORDER BY granted_at;
--
-- To narrow someone to support-only:
--   UPDATE public.platform_admins SET role = 'support' WHERE user_id = '<uuid>';
