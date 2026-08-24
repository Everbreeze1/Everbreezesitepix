-- One open invite per address per team.
--
-- `team_invites` has no unique constraint on (team_id, email) - the only UNIQUE
-- is `token` (20260612191404_teams.sql:58, 20260612234611_team_invites_fix.sql:43).
-- The invite dialog's Enter handler was not guarded by `isPending`, and rpcOp
-- mints a fresh Idempotency-Key per call, so two rapid submits both cleared the
-- duplicate probe in inviteMemberService and both inserted.
--
-- Once two open rows existed the damage compounded: the probe used
-- `.maybeSingle()`, which on >1 row sets PGRST116 and NULLS `data`, and the
-- caller destructured only `data`. So `dup` came back null forever and every
-- later invite added yet another row rather than resending. On Starter (cap 2)
-- the strays eat the one invitable seat and the owner is locked out behind a
-- misleading "at its 2-user limit" error.
--
-- Emails are normalised to lower(btrim(...)) on write from this commit onward,
-- so the index is a plain (team_id, email) rather than a lower(email) expression
-- index that a case-sensitive `.eq()` would silently fail to use.
--
-- Creates no table, so the anon-revoke rule for migrations >= 20260811 does not
-- apply here - if a future edit adds one, it must REVOKE anon.
--
-- Apply via the Everlumen Supabase SQL editor. Idempotent - safe to re-run.

SET lock_timeout = '5s';

-- === PART 1 - normalise, so the index and the .eq() lookup agree ============

UPDATE public.team_invites
   SET email = lower(btrim(email))
 WHERE email IS DISTINCT FROM lower(btrim(email));

-- === PART 2 - dedupe, or PART 3 cannot create the index ====================
-- Keep the newest open invite per (team_id, email). The older ones are what the
-- race produced; they are indistinguishable to the invitee, and only one token
-- can be redeemed anyway.

DELETE FROM public.team_invites t
 USING public.team_invites keep
 WHERE t.accepted_at IS NULL
   AND keep.accepted_at IS NULL
   AND keep.team_id = t.team_id
   AND keep.email   = t.email
   AND (keep.created_at, keep.id) > (t.created_at, t.id);

-- === PART 3 - the constraint ===============================================
-- Partial on purpose: an ACCEPTED invite is history, and must be allowed to
-- coexist with a later re-invite of the same address (someone who left and came
-- back).

CREATE UNIQUE INDEX IF NOT EXISTS team_invites_one_open_per_email_idx
  ON public.team_invites (team_id, email)
  WHERE accepted_at IS NULL;

-- === VERIFY ================================================================
-- Expect: the first query returns zero rows, and the index is listed.

SELECT team_id, email, count(*)
  FROM public.team_invites
 WHERE accepted_at IS NULL
 GROUP BY 1, 2
HAVING count(*) > 1;

SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename = 'team_invites'
 ORDER BY indexname;
