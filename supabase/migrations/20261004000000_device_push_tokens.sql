-- DEVICE PUSH TOKENS - run this in the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent, safe to re-run.
--
-- Where a person's phones are, so a notification raised by a trigger can also
-- reach them when the app is closed. The `notifications` table
-- (20260728120000_notifications.sql) is the record; this is the delivery
-- address, and the two are deliberately separate: a notification is still
-- correct with no device registered, and a device that unregisters must not
-- take the notification history with it.

-- =========================
-- TABLE
-- =========================
CREATE TABLE IF NOT EXISTS public.device_push_tokens (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The Expo push token, "ExponentPushToken[...]". Not the raw FCM or APNs
  -- token: Expo's service is what the send path talks to, and it is the thing
  -- that knows which transport a given token needs.
  token        text NOT NULL,
  platform     text NOT NULL CHECK (platform IN ('ios', 'android')),
  -- What the device calls itself, for the "signed in on" list. Cosmetic, and
  -- nullable because `expo-device` returns null on an emulator.
  device_name  text,
  -- Touched on every app launch. A token nothing has refreshed in months
  -- belongs to an app that was uninstalled, and Expo will reject it; the sweep
  -- at the bottom uses this rather than waiting for a delivery failure.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

/*
 * One row per token, not per (user, token).
 *
 * A phone handed from one employee to another re-registers the same token under
 * a new user, and without this the old owner keeps receiving the new owner's
 * notifications. The upsert in `registerPushToken` targets this constraint, so
 * re-registering moves the row rather than duplicating it.
 */
CREATE UNIQUE INDEX IF NOT EXISTS device_push_tokens_token_key
  ON public.device_push_tokens(token);

CREATE INDEX IF NOT EXISTS device_push_tokens_user_idx
  ON public.device_push_tokens(user_id);

/*
 * Anon first, and this is not a formality.
 *
 * Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
 * TO anon`, so a new public table is readable by the publishable key - which
 * ships inside the app bundle and the web bundle - from the moment it exists.
 * A table of push tokens keyed to user ids is a list of every device every
 * customer owns, so this line is the difference between a delivery address book
 * and a public one. `tests/invariants.test.ts` enforces it, and caught this
 * file without it.
 */
REVOKE ALL ON public.device_push_tokens FROM anon;

-- A client may register and unregister its own device and see its own list.
-- Nothing else: the send path runs with the service role, because delivering to
-- somebody else's device is exactly what a client must never be able to do.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.device_push_tokens TO authenticated;
GRANT ALL ON public.device_push_tokens TO service_role;

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners view own devices" ON public.device_push_tokens;
CREATE POLICY "Owners view own devices" ON public.device_push_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners register own devices" ON public.device_push_tokens;
CREATE POLICY "Owners register own devices" ON public.device_push_tokens
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

/*
 * The UPDATE policy is what makes a handed-over phone work.
 *
 * `USING` is permissive on purpose: the row being overwritten may still belong
 * to the previous owner, and the new owner has to be able to claim it. What
 * stops that being a hole is `WITH CHECK`, which forces the row to end up
 * pointing at the caller. So anybody can take a token off somebody else, and
 * nobody can push a token onto somebody else, which is the correct way round:
 * the person holding the phone is the person who receives on it.
 */
DROP POLICY IF EXISTS "Owners claim a device" ON public.device_push_tokens;
CREATE POLICY "Owners claim a device" ON public.device_push_tokens
  FOR UPDATE TO authenticated USING (true) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners unregister own devices" ON public.device_push_tokens;
CREATE POLICY "Owners unregister own devices" ON public.device_push_tokens
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- =========================
-- Housekeeping
-- =========================

/*
 * Drop tokens nothing has refreshed in 90 days.
 *
 * An uninstalled app never unregisters: the row simply stops being touched. Left
 * alone these accumulate forever and every send wastes a request on each one,
 * which is how a push path gets slower the longer it runs. Ninety days is long
 * enough to survive a phone left in a drawer over a shutdown period.
 *
 * Not scheduled here. Call it from the same place the other sweeps run.
 */
CREATE OR REPLACE FUNCTION public.sweep_stale_push_tokens()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed integer;
BEGIN
  DELETE FROM public.device_push_tokens
  WHERE last_seen_at < now() - interval '90 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END $$;

REVOKE ALL ON FUNCTION public.sweep_stale_push_tokens() FROM public;
GRANT EXECUTE ON FUNCTION public.sweep_stale_push_tokens() TO service_role;
