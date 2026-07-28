-- Records platform-admin actions (grants/revokes, broadcasts, billing syncs)
-- for accountability. Service-role only, same access pattern as
-- platform_admins — never exposed to `authenticated`. Idempotent.

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id          uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_id_idx ON public.admin_audit_log (actor_id);

GRANT ALL ON public.admin_audit_log TO service_role;

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
-- No policies for `authenticated` -> RLS default-denies all client access.
