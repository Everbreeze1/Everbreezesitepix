-- Detach the two internal teams from a Stripe account we no longer use.
--
-- WHY
--
-- `createBillingPortalSession` returned HTTP 500 on every call from 2026-08-13
-- onwards. The cause was not code: both teams carrying Stripe ids were created
-- under a PREVIOUS Stripe account, and the live key belongs to
-- acct_1TwmiPEbTYVRi4sY. Every `stripe_customer_id` stays syntactically valid
-- across that switch, so nothing looked wrong - the ids were there, the plans
-- said "team", the statuses said "active" - and only the API calls failed, one
-- button at a time.
--
-- The current account is the correct one: it holds all six configured prices
-- and an enabled webhook pointing at https://api.everlumen.co/v1/billing/webhook.
-- Both affected teams are the owner's own internal/test accounts, confirmed by
-- the owner. So the fix is to stop pointing at the dead account.
--
-- WHY NOT JUST NULL THE IDS
--
-- Clearing the pointers alone would leave two teams on the `team` plan with
-- `subscription_status = 'active'` and nothing backing it - which is precisely
-- the paywall-hole signature from LAUNCH.md 1.0a that the reconciliation report
-- and the "Paid, unbacked" filter exist to catch. That would turn a known,
-- explained situation into a permanent false alarm.
--
-- So each team is marked complimentary instead. `is_internal` grants
-- `isActive: true` and forces `tier: "team"` in getCallerTeamPlan (see
-- apps/api/src/lib/team-plan.ts:113-121), so access is unchanged, and the
-- status becomes honest: no subscription, access granted deliberately.
--
-- REVERSING THIS
--
-- The values below are recorded so this is undoable, though the ids only mean
-- anything to the old Stripe account:
--
--   bash                       1095ea0b-df66-40e5-b0e3-14fb3c977f3d
--     stripe_customer_id       cus_Ux5O84LN0pFohP
--     stripe_subscription_id   sub_1U09X7EpxPafC2DyoKHWBNE7
--     subscription_status      active     is_internal  false
--
--   Everbreeze Heating and Air 6544c3d6-d1d1-4a68-9999-efe77f44949e
--     stripe_customer_id       cus_Uxbu73LMCX3eaO
--     stripe_subscription_id   sub_1TyOWpEpxPafC2DyAco7ti9d
--     subscription_status      active     is_internal  false
--
-- Idempotent: scoped to the two ids, and re-running finds nothing to change.

UPDATE public.teams
   SET stripe_customer_id     = NULL,
       stripe_subscription_id = NULL,
       is_internal            = true,
       -- No subscription backs these any more, and saying "active" would be a
       -- claim about a payment that is not happening. Access comes from
       -- is_internal above, not from this column.
       subscription_status    = 'inactive'
 WHERE id IN (
         '1095ea0b-df66-40e5-b0e3-14fb3c977f3d',  -- bash
         '6544c3d6-d1d1-4a68-9999-efe77f44949e'   -- Everbreeze Heating and Air
       )
   AND (stripe_customer_id IS NOT NULL OR stripe_subscription_id IS NOT NULL);

-- Verify - expect both rows complimentary, no Stripe ids, and still active
-- access because is_internal is what grants it:
--   SELECT name, plan, subscription_status, is_internal,
--          stripe_customer_id, stripe_subscription_id
--     FROM public.teams ORDER BY name;
--
-- And expect zero rows, i.e. no team looks like an unbacked paid plan:
--   SELECT name FROM public.teams
--    WHERE plan <> 'starter' AND stripe_subscription_id IS NULL AND NOT is_internal;
