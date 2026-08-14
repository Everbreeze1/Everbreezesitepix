-- Platform-wide admin access (distinct from team_role, which is per-team).
-- Deliberately a separate table rather than a profiles.is_admin column -
-- easier to audit who has access and to revoke it.
-- Bootstrap: the first row must be inserted manually in the SQL editor -
-- see docs/ops.md. No UI can grant the first admin (chicken-and-egg).
-- Apply via the SitePix Supabase SQL editor (project ulmgvtuqjlzzadlwtiog). Idempotent.

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id    uuid NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);

-- No client access at all - every read/write goes through the service-role
-- key from apps/api's admin domain (requirePlatformAdmin()). Never exposed
-- to `authenticated` so a compromised browser session can't self-grant.
GRANT ALL ON public.platform_admins TO service_role;

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies defined for `authenticated` -> RLS default-denies all client access.
