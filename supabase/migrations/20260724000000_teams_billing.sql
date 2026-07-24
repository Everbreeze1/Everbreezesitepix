-- Real Stripe billing fields on teams, replacing the hardcoded test-account
-- allowlists that previously granted free full access.
-- Apply manually in the Supabase SQL editor (or `supabase db push`). Safe to re-run.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS subscription_status TEXT NOT NULL DEFAULT 'inactive',
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS teams_stripe_customer_id_idx
  ON public.teams (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS teams_stripe_subscription_id_idx
  ON public.teams (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
