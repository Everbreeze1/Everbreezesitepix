-- Pro and Team sell "add as many users as you want" - lift their seat ceiling.
-- Apply manually in the Supabase SQL editor on project ulmgvtuqjlzzadlwtiog.
-- Safe to re-run.
--
-- 999 rather than a true unlimited: member_limit is an INT the invite flow
-- compares against, and every seat past the included count is still billed.
-- Mirrors PLAN_MEMBER_CAP (apps/api/src/lib/team-plan.ts) and UNLIMITED_SEATS
-- (apps/web/src/lib/pricing.ts).

CREATE OR REPLACE FUNCTION public.teams_sync_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.member_limit := CASE NEW.plan
    WHEN 'starter' THEN 2
    WHEN 'pro'     THEN 999
    WHEN 'team'    THEN 999
    ELSE 2
  END;
  RETURN NEW;
END;
$$;

-- Deliberately NO backfill.
--
-- This trigger only writes the plan's ceiling as a starting value; the real
-- number on a paying team is the purchased seat count, written afterwards by
-- syncPurchasedSeats() in apps/api/src/domains/billing/webhook.ts. A blanket
-- `UPDATE teams SET plan = plan` would re-fire this trigger and overwrite that
-- count with 999, handing every existing Pro and Team customer unlimited seats
-- they never paid for.
--
-- Existing rows still sitting on the old 50 keep it until their next plan
-- change or webhook sync. 50 is not a ceiling any current customer is near, so
-- there is nothing to rescue; if one ever is, raise that team's member_limit
-- directly rather than re-firing the trigger across the table.
