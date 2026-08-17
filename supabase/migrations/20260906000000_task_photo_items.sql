-- Per-photo completion for a task raised against several photos.
--
-- The client, on the Tasks tab: "we assign multiple photos on the tasks ...
-- Right now its all lumped into one button for showing completion. no details
-- what was done and what needs to get done."
--
-- He is describing the schema, not the styling. 20260618220000 gave `tasks` a
-- `photo_ids uuid[]` and one `status` column, so a task raised against twelve
-- photos has exactly one state covering all twelve. Two consequences, both
-- reachable in the shipped app:
--
--   1. The photo viewer's task panel loads tasks with
--      `photo_ids @> ARRAY[this photo]` and its status circle writes
--      `tasks.status`. A crew member ticking the job off on the third photo
--      therefore closed it on the other eleven, and it rendered struck through
--      on every one of them. That is not a missing feature, it is the wrong
--      row being written.
--   2. The project Tasks tab has one pill per task, "Completed" or a due date.
--      Nothing in the schema could answer "which photos are handled", so
--      nothing in the UI could show it.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS ADDS
-- ---------------------------------------------------------------------------
-- `task_photo_items`, one row per (task, photo) that has been touched: its own
-- status, its own "what was done" note, and who closed it and when. Rows are
-- created lazily, so a photo with no row is simply outstanding and no backfill
-- is needed for open work.
--
-- `tasks.photo_ids` stays the membership list. It is what the notification
-- trigger (20260905000000) and the report builders read, and moving membership
-- into the new table would have rewritten all of them for no gain. This table
-- holds per-photo STATE, keyed to a photo the task already carries.
--
-- `tasks.status` becomes a rollup for any task that carries photos:
--
--   every photo done  -> 'done'
--   some photos done  -> 'in_progress'
--   no photos done    -> whatever it was, except that a task which was 'done'
--                        reopens to 'open'
--
-- so the existing completion notification, the group rollup, the tab counts and
-- every "open tasks" query keep working untouched and are now telling the
-- truth. A task with no photos, which is most of them, is unaffected end to
-- end: no rows here, no rollup, the status column is still written directly.
--
-- ---------------------------------------------------------------------------
-- WHO MAY CLOSE ONE
-- ---------------------------------------------------------------------------
-- The same rule as everything else, `may_complete_assignment` from
-- 20260819000000, read off the PARENT task. Closing one photo of somebody
-- else's task is closing part of their work, so it asks the same question. The
-- rollup applies the rule a second time before promoting the task to 'done',
-- which means it can never hand out a completion that
-- `tasks_enforce_completer` would then refuse, and can never raise inside an
-- unrelated edit.
--
-- Apply via the SitePix Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

-- =========================================================================
-- 0. LOCKS, ALL OF THEM, UP FRONT
-- =========================================================================
-- The first attempt at this migration died with `40P01 deadlock detected`, and
-- nothing in the statements below was wrong. The app was live against the same
-- database, and the two sessions wanted the same two tables in opposite orders:
--
--   this migration : task_photo_items (RLS, policies, triggers) then tasks
--                    (the photo_ids trigger, now in section 8)
--   an app request : whichever of the two the planner reached first
--
-- A request that reads `task_photo_items` also reads `public.tasks`, because
-- the RLS policies in section 2 answer "may you see this row" with an EXISTS
-- against the parent task. One PostgREST request therefore holds locks on both
-- tables inside one transaction, which is the other half of the cycle.
--
-- Postgres cannot deadlock on locks that every session asks for in the same
-- order, so this migration asks for all of them first, before it does any work.
-- `tasks` leads because it is the table that exists on a first run.
--
-- If this fails with `55P03 lock_not_available` instead, nothing has been
-- applied and nothing is damaged: an app session was mid-read and did not
-- release within the 5s above. Close the tabs that have a project open and run
-- it again. Everything in this file is idempotent, so re-running after any
-- failure is the intended way to recover, not a risk.

-- `photos` joins the list because section 5 puts a trigger on it, which needs
-- ACCESS EXCLUSIVE there too. Same rule as the other two: taken here, in a fixed
-- order, rather than wherever the statement that needs it happens to sit.
LOCK TABLE public.tasks IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.photos IN ACCESS EXCLUSIVE MODE;

-- Only on a re-run: on a first run the table does not exist yet, and locking it
-- by name would be a syntax-time failure rather than a no-op.
DO $$
BEGIN
  IF to_regclass('public.task_photo_items') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.task_photo_items IN ACCESS EXCLUSIVE MODE';
  END IF;
END $$;

-- -------------------------------------------------------------------------
-- 0b. QUIET THE TRIGGERS THIS FILE'S OWN BULK STATEMENTS WOULD SET OFF
-- -------------------------------------------------------------------------
-- Sections 5 to 7 rewrite `photo_ids` and `status` across the whole table. Three
-- triggers would react to that, and all three would be wrong to:
--
--   tasks_sync_photo_items   Would recompute a task's status from item rows that
--                            section 6 has not written yet, so pruning a dead
--                            photo id off a closed task would read as "no photos
--                            done" and reopen it. Dropped rather than disabled,
--                            because section 4 recreates it anyway.
--   tasks_updated_at         Would stamp `updated_at = now()` on a housekeeping
--                            write. That is not just cosmetic here: section 6
--                            falls back to `updated_at` for the completion date
--                            of a closed task that never recorded one, so
--                            bumping it first would date every one of them today.
--   tasks_notify_completed   Fires on any status change into 'done'. Section 7
--                            restores completions that an earlier run of this
--                            file demoted, and telling a foreman his year-old
--                            jobs just finished is not a repair.
--
-- All three are restored in section 8. `ALTER TABLE ... DISABLE TRIGGER` is
-- transactional and this file runs as one transaction - which section 0 already
-- depends on, since `LOCK TABLE` outside one is an error - so a failure anywhere
-- below rolls the disables back with everything else. There is no state in which
-- the migration has quietly left them off.
DROP TRIGGER IF EXISTS tasks_sync_photo_items ON public.tasks;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_updated_at') THEN
    ALTER TABLE public.tasks DISABLE TRIGGER tasks_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_notify_completed') THEN
    ALTER TABLE public.tasks DISABLE TRIGGER tasks_notify_completed;
  END IF;
END $$;

-- =========================================================================
-- 1. TABLE
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.task_photo_items (
  task_id      uuid NOT NULL REFERENCES public.tasks(id)  ON DELETE CASCADE,
  photo_id     uuid NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  -- Two states, not the three `tasks.status` carries. "In progress" is a
  -- statement about a set of photos, and this row is one photo: it is either
  -- handled or it is not. The middle state is what the rollup derives.
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  -- The detail the client said was missing. What was actually done to this
  -- picture, in the words of whoever did it.
  note         text,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, photo_id)
);

COMMENT ON TABLE public.task_photo_items IS
  'Per-photo state for a task that spans several photos. tasks.photo_ids is the membership list; this is what has been done to each of them. A missing row means outstanding.';
COMMENT ON COLUMN public.task_photo_items.note IS
  'What was done to this photo, written by the person who closed it. Free text, shown on the task row and in reports.';

-- The photo viewer asks "what is outstanding on this picture" across every
-- task in the project, so photo_id leads that lookup and the primary key
-- (task_id first) cannot serve it.
CREATE INDEX IF NOT EXISTS task_photo_items_photo_id_idx
  ON public.task_photo_items(photo_id);
CREATE INDEX IF NOT EXISTS task_photo_items_open_idx
  ON public.task_photo_items(task_id) WHERE status = 'open';

-- Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
-- TO anon`, so a new public table is readable by the publishable key - which is
-- in the browser bundle - from the moment it exists. That is how `walkthroughs`
-- and `team_invites` leaked. Revoked before anything is granted, and there is
-- no anonymous read path to break: nothing public renders per-photo task state.
REVOKE ALL ON public.task_photo_items FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_photo_items TO authenticated;
GRANT ALL ON public.task_photo_items TO service_role;

-- =========================================================================
-- 2. RLS - reachable by exactly the people who can reach the parent task
-- =========================================================================
-- Written as four separate policies rather than one FOR ALL, for the reason
-- 20260819000000 spells out: a permissive FOR ALL carries its own WITH CHECK,
-- and RLS ORs permissive policies together, so a later plan gate added to this
-- table would be repealed by the policy sitting underneath it. There is no such
-- gate today. There does not need to be one for the narrow grants to be the
-- correct ones.
--
-- Teammates get INSERT and DELETE here, which `tasks` itself deliberately
-- withholds. Creating a task and ticking a photo off it are different acts: the
-- first is authorship, the second is the assignee doing the work they were
-- handed, and a lazily created row is how that work gets recorded at all.

ALTER TABLE public.task_photo_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Reach task photo items" ON public.task_photo_items;
CREATE POLICY "Reach task photo items" ON public.task_photo_items
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_photo_items.task_id
        AND (t.created_by = auth.uid() OR public.are_teammates(auth.uid(), t.created_by))
    )
  );

DROP POLICY IF EXISTS "Record task photo items" ON public.task_photo_items;
CREATE POLICY "Record task photo items" ON public.task_photo_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_photo_items.task_id
        AND (t.created_by = auth.uid() OR public.are_teammates(auth.uid(), t.created_by))
    )
  );

DROP POLICY IF EXISTS "Amend task photo items" ON public.task_photo_items;
CREATE POLICY "Amend task photo items" ON public.task_photo_items
  FOR UPDATE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_photo_items.task_id
        AND (t.created_by = auth.uid() OR public.are_teammates(auth.uid(), t.created_by))
    )
  );

DROP POLICY IF EXISTS "Clear task photo items" ON public.task_photo_items;
CREATE POLICY "Clear task photo items" ON public.task_photo_items
  FOR DELETE TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.tasks t
      WHERE t.id = task_photo_items.task_id
        AND (t.created_by = auth.uid() OR public.are_teammates(auth.uid(), t.created_by))
    )
  );

-- =========================================================================
-- 3. ENFORCEMENT AND STAMPING - BEFORE, so a refused close never lands
-- =========================================================================
-- The rights question is asked of the PARENT task, unchanged from
-- `enforce_task_completer`. The timestamp and the completer are stamped here
-- rather than trusted from the client, so "done by whom, when" is a fact of the
-- write and not of whichever screen happened to make it.

CREATE OR REPLACE FUNCTION public.enforce_task_photo_item_completer() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _assigned_to uuid;
  _assigned_by uuid;
  _photo_ids   uuid[];
BEGIN
  SELECT t.assignee_user_id, t.assigned_by, t.photo_ids
    INTO _assigned_to, _assigned_by, _photo_ids
    FROM public.tasks t WHERE t.id = NEW.task_id;

  /*
   * A new row has to be about a photo the task actually covers.
   *
   * The foreign key only says the photo exists somewhere in the library, and
   * membership lives in `tasks.photo_ids`, which nothing else here references.
   * So a row could be created for a photo the task says nothing about - and the
   * rollup in section 4 filters by `= ANY(photo_ids)`, so it would sit there
   * counting for nothing and forever: invisible in the breakdown, never cleaned
   * up, and read back by anything that lists a task's items rather than walking
   * its photo_ids.
   *
   * INSERT only, and that distinction is the whole care of it. A photo dropped
   * from the task after its row was written is legitimate and common - the row
   * stops counting, which is exactly what lets it count again if the photo is
   * added back - so an UPDATE must still be able to reopen it or correct its
   * note. Judging an UPDATE by today's membership would refuse edits to a
   * record of work that has already happened.
   *
   * `NOT FOUND` is left to the foreign key, which raises the right error for a
   * task id that does not exist.
   */
  IF TG_OP = 'INSERT'
     AND FOUND
     AND NOT (NEW.photo_id = ANY(COALESCE(_photo_ids, '{}'::uuid[]))) THEN
    RAISE EXCEPTION 'That photo is not part of this task.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF NEW.status = 'done'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'done')
     AND auth.uid() IS NOT NULL THEN
    IF NOT public.may_complete_assignment(_assigned_to, _assigned_by, auth.uid()) THEN
      RAISE EXCEPTION 'Only the assignee, the person who assigned it, or a manager can mark this photo done.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.status = 'done' THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.completed_by := COALESCE(NEW.completed_by, auth.uid());
  ELSE
    -- Reopening drops the signature with the completion. Keeping the note,
    -- deliberately: "what was done" survives being reopened, because it is a
    -- record of work and not a property of the checkbox.
    NEW.completed_at := NULL;
    NEW.completed_by := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_photo_items_enforce_completer ON public.task_photo_items;
CREATE TRIGGER task_photo_items_enforce_completer
  BEFORE INSERT OR UPDATE ON public.task_photo_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_task_photo_item_completer();

-- =========================================================================
-- 4. ROLLUP - the task's own status follows its photos
-- =========================================================================
-- Counted against `photo_ids` and not against the item rows, so a photo dropped
-- from the task stops counting immediately and cannot leave a task showing
-- "12 of 11 done" or, worse, stuck at 11 of 12 forever because the twelfth
-- photo is no longer part of the job.

CREATE OR REPLACE FUNCTION public.task_photo_rollup_status(
  _task_id uuid,
  _photo_ids uuid[],
  _current text
) RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  /*
   * DISTINCT, not array_length.
   *
   * `photo_ids` is a plain uuid[] with no uniqueness behind it, so the same
   * photo can appear twice - and this table is keyed (task_id, photo_id), so it
   * can only ever hold one row for it. Counting the array's length against
   * distinct rows made a task with a duplicated id permanently uncompletable:
   * two of three, forever, with no photo left to tick. Worse than stuck, it
   * disagreed with `taskPhotoProgress` in apps/web/src/lib/task-photo-items.ts,
   * which walks the array and therefore counted the duplicate twice - so the
   * tick showed the task done and a reload put it back to in progress.
   *
   * Both halves now count photos rather than array slots, which is what "which
   * photos are handled" meant in the first place.
   */
  _total int;
  _done  int;
BEGIN
  SELECT count(DISTINCT m.photo_id) INTO _total
    FROM unnest(COALESCE(_photo_ids, '{}'::uuid[])) AS m(photo_id);

  IF _total = 0 THEN
    RETURN _current;
  END IF;

  SELECT count(*) INTO _done
    FROM public.task_photo_items i
   WHERE i.task_id = _task_id
     AND i.status = 'done'
     AND i.photo_id = ANY(_photo_ids);

  IF _done >= _total THEN
    RETURN 'done';
  ELSIF _done > 0 THEN
    RETURN 'in_progress';
  ELSIF _current = 'done' THEN
    -- Every photo reopened, so the task cannot still read as closed.
    RETURN 'open';
  END IF;

  -- Nothing ticked. Leave a manually set 'in_progress' alone: a crew member who
  -- has started but photographed nothing yet is still started.
  RETURN _current;
END;
$$;

/**
 * When this task's work was actually finished, read back off its photos.
 *
 * `tasks.completed_at` is not a safe thing to re-derive from `now()`, because a
 * task can pass through 'not done' and back inside a single statement. Purging one
 * photo from a fully closed task does exactly that:
 *
 *   1. the foreign key cascade deletes that photo's item row, and the AFTER ROW
 *      rollup recomputes while `photo_ids` still names the purged photo - so the
 *      task is short of its own denominator, demotes, and `completed_at` is nulled
 *   2. the AFTER STATEMENT trigger in section 5 then prunes the dead id, the
 *      status recomputes honestly, and the task is 'done' again
 *
 * Correct at both ends, and the date was silently moved to the purge in between.
 * The item rows still carry the real one, so that is where it comes from. It also
 * answers the ordinary case better than `now()` did: the last photo's timestamp IS
 * when the task became complete, whether that was a second or a year ago.
 */
CREATE OR REPLACE FUNCTION public.task_photo_completed_at(_task_id uuid, _photo_ids uuid[])
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max(i.completed_at)
    FROM public.task_photo_items i
   WHERE i.task_id = _task_id
     AND i.status = 'done'
     AND i.photo_id = ANY(_photo_ids);
$$;

CREATE OR REPLACE FUNCTION public.rollup_task_from_photo_items() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _task_id uuid := COALESCE(NEW.task_id, OLD.task_id);
  _t       public.tasks%ROWTYPE;
  _target  text;
BEGIN
  SELECT * INTO _t FROM public.tasks WHERE id = _task_id;
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  _target := public.task_photo_rollup_status(_t.id, _t.photo_ids, _t.status);

  -- The rollup never hands out a completion the direct route would refuse. It
  -- demotes rather than raising: the caller was allowed to write the item they
  -- wrote, and failing their write because of a rule about a different row
  -- would be a refusal they cannot act on. In practice this is unreachable,
  -- since ticking the last photo is itself gated on the same rule.
  IF _target = 'done'
     AND auth.uid() IS NOT NULL
     AND NOT public.may_complete_assignment(_t.assignee_user_id, _t.assigned_by, auth.uid()) THEN
    _target := 'in_progress';
  END IF;

  IF _target IS DISTINCT FROM _t.status THEN
    UPDATE public.tasks
       SET status = _target,
           completed_at = CASE
             WHEN _target = 'done'
               THEN COALESCE(_t.completed_at,
                             public.task_photo_completed_at(_t.id, _t.photo_ids),
                             now())
             ELSE NULL
           END
     WHERE id = _t.id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS task_photo_items_rollup ON public.task_photo_items;
CREATE TRIGGER task_photo_items_rollup
  AFTER INSERT OR UPDATE OR DELETE ON public.task_photo_items
  FOR EACH ROW EXECUTE FUNCTION public.rollup_task_from_photo_items();

-- Changing which photos a task covers changes the answer, so the rollup runs
-- again. BEFORE, assigning into NEW, so this is one row version and cannot
-- recurse. The WHEN clause matters: the task dialog sends `photo_ids` on every
-- save, and without it an unchanged array would let the rollup overrule a
-- status the person had just chosen by hand.
CREATE OR REPLACE FUNCTION public.sync_task_status_to_photo_items() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target text;
BEGIN
  _target := public.task_photo_rollup_status(NEW.id, NEW.photo_ids, NEW.status);

  IF _target = 'done'
     AND auth.uid() IS NOT NULL
     AND NOT public.may_complete_assignment(NEW.assignee_user_id, NEW.assigned_by, auth.uid()) THEN
    _target := 'in_progress';
  END IF;

  IF _target IS DISTINCT FROM NEW.status THEN
    NEW.status := _target;
    -- Recovered, never restamped. This trigger is the second half of the purge
    -- sequence described on `task_photo_completed_at`, so `NEW.completed_at` has
    -- very often just been nulled by the first half.
    NEW.completed_at := CASE
      WHEN _target = 'done'
        THEN COALESCE(NEW.completed_at,
                      public.task_photo_completed_at(NEW.id, NEW.photo_ids),
                      now())
      ELSE NULL
    END;
  END IF;

  RETURN NEW;
END;
$$;

-- Its TRIGGER is created in section 8, not here.
--
-- Section 5 prunes dead photo ids off `tasks.photo_ids`, and this trigger reacts
-- to exactly that column. If it were live for that statement it would recompute a
-- closed task's status against item rows section 6 has not written yet, read "no
-- photos done", and reopen the task - and section 6 only backfills tasks that are
-- still 'done', so the completion would be gone for good rather than merely
-- wrong. The function is defined here with its sibling; the trigger waits until
-- every bulk statement in this file has run.

-- `task_photo_rollup_status` is deliberately NOT granted to `authenticated`. The
-- REVOKE is in section 8, after section 7 has finished calling it.

-- =========================================================================
-- 5. MEMBERSHIP HYGIENE - a task may not carry a photo that no longer exists
-- =========================================================================
-- `tasks.photo_ids` is a uuid[] with no foreign key behind it, and photos are
-- genuinely hard deleted: `purgePhotosService` in apps/api/src/domains/trash/
-- service.ts runs `photos.delete()`, and apps/api/src/domains/hooks/
-- purge-trash.ts does the same on a schedule with nobody watching. So a task
-- keeps naming a photo that has been gone for a month.
--
-- Harmless while `status` was one column. Not harmless now that it is a fraction:
--
--   1. The denominator counts the dead id and the numerator cannot. Section 4
--      counts item rows, and the foreign key on this table refuses a row for a
--      photo that does not exist - so a task with one purged photo sits at two of
--      three, in progress, and NO SEQUENCE OF TICKS CAN EVER CLOSE IT. The
--      checklist even draws the row, so a crew member taps it and gets a foreign
--      key error on a job the app told them to finish.
--   2. Section 6 skips those photos, correctly, and the rollup in section 4 then
--      reads the shortfall as unfinished work: a task closed last spring is
--      demoted to 'in_progress' and its `completed_at` set to NULL. That is the
--      backfill reopening finished jobs.
--
-- Both come from one thing - membership that outlived the photo - so that is what
-- gets fixed, rather than teaching every reader to distrust the array. `_total`
-- stays a plain count of `photo_ids`, which is what keeps it identical to
-- `taskPhotoProgress` in apps/web/src/lib/task-photo-items.ts: the browser only
-- ever has the array, so any rule the SQL applies that the array cannot express
-- would put the two halves back into disagreement.

-- Going forward. Statement level with a transition table rather than FOR EACH
-- ROW: a trash purge deletes photos in chunks of hundreds, and a per-row trigger
-- would walk `tasks` once per photo.
CREATE OR REPLACE FUNCTION public.prune_deleted_photos_from_tasks() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Every reference qualified, and the unnest aliased to something that is not
  -- `id`. `... WHERE d.id = id` would have bound the right-hand side to
  -- `deleted.id`, not to the unnested element - a tautology that prunes every
  -- photo off every matching task.
  UPDATE public.tasks t
     SET photo_ids = ARRAY(
           SELECT m.photo_id FROM unnest(t.photo_ids) AS m(photo_id)
            WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.id = m.photo_id))
   WHERE t.photo_ids && ARRAY(SELECT d.id FROM deleted d);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS photos_prune_task_membership ON public.photos;
CREATE TRIGGER photos_prune_task_membership
  AFTER DELETE ON public.photos
  REFERENCING OLD TABLE AS deleted
  FOR EACH STATEMENT EXECUTE FUNCTION public.prune_deleted_photos_from_tasks();

-- The overlap test above, and the photo viewer's existing
-- `photo_ids @> ARRAY[this photo]` lookup, are both GIN operators that have been
-- running as sequential scans.
CREATE INDEX IF NOT EXISTS tasks_photo_ids_gin_idx ON public.tasks USING gin (photo_ids);

-- The photos already purged, once. This has to happen BEFORE section 6 so the
-- backfill sees an honest array and has nothing to fall short of, and it runs
-- with `tasks_sync_photo_items` dropped (section 0b) so pruning a closed task
-- cannot recompute its status against item rows that do not exist yet.
--
-- Gone means gone from `photos`, not `deleted_at IS NOT NULL`. A trashed photo is
-- still a row, can still be restored, and the checklist still draws it and lets a
-- crew member tick it - so dropping it from the task would lose the membership the
-- restore is supposed to bring back. Only a purge is permanent, and only a purge
-- is what the foreign key on this table refuses.
UPDATE public.tasks t
   SET photo_ids = ARRAY(
         SELECT m.photo_id FROM unnest(t.photo_ids) AS m(photo_id)
          WHERE EXISTS (SELECT 1 FROM public.photos ph WHERE ph.id = m.photo_id))
 WHERE EXISTS (
         SELECT 1 FROM unnest(t.photo_ids) AS m(photo_id)
          WHERE NOT EXISTS (SELECT 1 FROM public.photos ph WHERE ph.id = m.photo_id));

-- =========================================================================
-- 6. BACKFILL - a task already closed is closed on every photo it carries
-- =========================================================================
-- Without this, every historically completed multi-photo task would render as
-- "0 of 12 photos" on the first load after deploy, which reads as work
-- reappearing rather than as a new column arriving.
--
-- Open tasks get nothing on purpose. A missing row already means outstanding,
-- so writing millions of 'open' rows would buy the same answer at a cost.
--
-- The EXISTS guard is not decoration: `photo_ids` is a plain uuid[] with no
-- foreign key behind it, so it can name photos that have since been deleted,
-- and the FK on this table would reject them. Section 5 has already pruned those
-- ids, so on a first run this guard should find nothing left to skip; it stays
-- because it is the thing standing between a stale id and a failed migration.
--
-- `completed_by` is left NULL, not set to `created_by`.
--
-- `tasks` has no `completed_by` column, so there is nothing on the row that
-- records who actually closed the work - and `created_by` is whoever WROTE the
-- task, which for assigned work is precisely the person who did not do it. The
-- column is rendered as "closed by" the moment any screen wants it, and a
-- confident wrong name is worse than a blank: nobody double-checks a name that
-- looks filled in. NULL says what is true, which is that this predates the
-- record being kept.

INSERT INTO public.task_photo_items (task_id, photo_id, status, completed_at, completed_by)
SELECT t.id,
       p.photo_id,
       'done',
       COALESCE(t.completed_at, t.updated_at),
       NULL
  FROM public.tasks t
  CROSS JOIN LATERAL unnest(t.photo_ids) AS p(photo_id)
 WHERE t.status = 'done'
   AND COALESCE(array_length(t.photo_ids, 1), 0) > 0
   AND EXISTS (SELECT 1 FROM public.photos ph WHERE ph.id = p.photo_id)
ON CONFLICT (task_id, photo_id) DO NOTHING;

-- =========================================================================
-- 7. RECONCILE - make the stored status agree with the rollup, once
-- =========================================================================
-- An earlier copy of this file backfilled before it pruned, so any task that was
-- closed while naming a since-purged photo came out of section 6 short of its own
-- denominator and was demoted to 'in_progress' with `completed_at` set to NULL.
-- Finished jobs reopened, on a schema change, which is the worst thing a
-- migration can do quietly.
--
-- Not a special case for that bug, though: this asks section 4's own function
-- what each task's status should be and writes the answer. Nothing is guessed,
-- and the same statement settles any other drift - a status hand-edited while
-- photos were being ticked, an interrupted run - which is also why it is safe on
-- a database that never had the problem: there, every row already agrees and no
-- row is touched.
--
-- The date is recovered rather than restamped. Section 6 wrote the task's
-- original completion onto each item row before the rollup could null it, so the
-- item rows are where the real date still lives; `now()` is the last resort for a
-- task that never recorded one at all.
UPDATE public.tasks t
   SET status = public.task_photo_rollup_status(t.id, t.photo_ids, t.status),
       completed_at = CASE
         WHEN public.task_photo_rollup_status(t.id, t.photo_ids, t.status) = 'done'
           THEN COALESCE(t.completed_at,
                         public.task_photo_completed_at(t.id, t.photo_ids),
                         now())
         ELSE NULL
       END
 WHERE COALESCE(array_length(t.photo_ids, 1), 0) > 0
   AND public.task_photo_rollup_status(t.id, t.photo_ids, t.status) IS DISTINCT FROM t.status;

-- =========================================================================
-- 8. RESTORE THE TRIGGERS SECTION 0b QUIETED
-- =========================================================================
-- Last, so that every bulk statement above ran against a table nothing was
-- watching. From here on the rollup is live and a task's status follows its
-- photos, which is the steady state the whole file exists to reach.
DROP TRIGGER IF EXISTS tasks_sync_photo_items ON public.tasks;
CREATE TRIGGER tasks_sync_photo_items
  BEFORE UPDATE OF photo_ids ON public.tasks
  FOR EACH ROW
  WHEN (OLD.photo_ids IS DISTINCT FROM NEW.photo_ids)
  EXECUTE FUNCTION public.sync_task_status_to_photo_items();

-- Deliberately NOT granted to `authenticated`.
--
-- Its only callers are the two triggers above, and a trigger function runs as the
-- definer whatever the caller may execute, so a grant buys them nothing. What it
-- would buy an ordinary session is a SECURITY DEFINER reader of
-- `task_photo_items` with the RLS in section 2 switched off: hand it a task id
-- and an array of photo ids and it answers how many of them are closed,
-- regardless of whose task it is. Unguessable ids are not an access rule, and
-- this is the one table in the file whose whole point was that the parent task
-- decides who may look.
--
-- REVOKE rather than simply omitting the GRANT, because Supabase's
-- `ALTER DEFAULT PRIVILEGES` hands PUBLIC execute on new functions - the same
-- default that section 1 revokes on the table - and because a re-run has to be
-- able to take the privilege back off a database that already ran an earlier copy
-- of this file. Here rather than beside the function so that section 7, which
-- calls it directly, is not relying on the migration role happening to own it.
REVOKE ALL ON FUNCTION public.task_photo_rollup_status(uuid, uuid[], text)
  FROM anon, authenticated, PUBLIC;
-- Same reasoning, same reader: it answers when a task's photos were closed
-- without asking whose task it is.
REVOKE ALL ON FUNCTION public.task_photo_completed_at(uuid, uuid[])
  FROM anon, authenticated, PUBLIC;

-- These two were disabled rather than dropped, so they have to be switched back
-- on by hand - and if this file ever gains an early exit above, it has to come
-- back through here.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_updated_at') THEN
    ALTER TABLE public.tasks ENABLE TRIGGER tasks_updated_at;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_notify_completed') THEN
    ALTER TABLE public.tasks ENABLE TRIGGER tasks_notify_completed;
  END IF;
END $$;

-- Nothing below this line may be left disabled. Fails loudly rather than handing
-- back a database whose completion notifications have silently stopped working.
DO $$
DECLARE
  _off text;
BEGIN
  SELECT string_agg(tgname::text, ', ') INTO _off
    FROM pg_trigger
   WHERE tgrelid IN ('public.tasks'::regclass, 'public.task_photo_items'::regclass)
     AND NOT tgisinternal
     AND tgenabled = 'D';
  IF _off IS NOT NULL THEN
    RAISE EXCEPTION 'Migration finished with triggers still disabled: %', _off;
  END IF;
END $$;

-- === VERIFY ================================================================
-- The table, its policies and its two triggers:
--
-- SELECT policyname, cmd FROM pg_policies
--  WHERE tablename = 'task_photo_items' ORDER BY cmd;
--
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'public.task_photo_items'::regclass AND NOT tgisinternal;
--
-- Every closed task with photos should now read as fully covered, and no task
-- should claim more done photos than it carries:
--
-- SELECT t.id, t.status,
--        COALESCE(array_length(t.photo_ids, 1), 0) AS photos,
--        count(i.*) FILTER (WHERE i.status = 'done') AS done
--   FROM public.tasks t
--   LEFT JOIN public.task_photo_items i
--          ON i.task_id = t.id AND i.photo_id = ANY(t.photo_ids)
--  WHERE COALESCE(array_length(t.photo_ids, 1), 0) > 0
--  GROUP BY t.id
--  HAVING count(i.*) FILTER (WHERE i.status = 'done') > COALESCE(array_length(t.photo_ids, 1), 0)
--      OR (t.status = 'done' AND count(i.*) FILTER (WHERE i.status = 'done')
--            < COALESCE(array_length(t.photo_ids, 1), 0));
--
-- Both should return no rows.
--
-- Rows about a photo the task does not carry. New ones are refused by the
-- trigger in section 3, but a database that ran an earlier copy of this file may
-- already hold some. They are inert - the rollup counts against `photo_ids`, so
-- they change no status and no count - which is why they are reported here for a
-- decision rather than deleted by this migration. Some are legitimate history: a
-- photo dropped from a task after its work was recorded.
--
-- SELECT i.task_id, i.photo_id, i.status, i.note, i.updated_at
--   FROM public.task_photo_items i
--   JOIN public.tasks t ON t.id = i.task_id
--  WHERE NOT (i.photo_id = ANY(COALESCE(t.photo_ids, '{}'::uuid[])));
--
-- No task may still name a photo that does not exist. This is what made a task
-- uncompletable and what made the backfill reopen closed work, so it is the one
-- to check after a run - and any row it returns means the trigger in section 5 is
-- missing or was added after the photo was purged:
--
-- SELECT t.id, t.title, p.photo_id AS missing_photo
--   FROM public.tasks t
--   CROSS JOIN LATERAL unnest(t.photo_ids) AS p(photo_id)
--  WHERE NOT EXISTS (SELECT 1 FROM public.photos ph WHERE ph.id = p.photo_id);
--
-- An earlier copy of this file stamped `completed_by = created_by` on backfilled
-- rows, which names the task's author rather than whoever closed the work. Section
-- 6 now writes NULL, but `ON CONFLICT DO NOTHING` will not go back and correct
-- rows that already exist, so clearing them is a separate decision.
--
-- The discriminator is `created_at` against `completed_at`: a backfilled row was
-- created at migration time and carries a completion date from whenever the task
-- was actually closed, so the two are far apart. A row written by someone ticking
-- a photo has both stamped in the same statement. Check what it selects before
-- turning it into an UPDATE:
--
-- SELECT i.task_id, i.photo_id, i.completed_by, i.completed_at, i.created_at
--   FROM public.task_photo_items i
--  WHERE i.completed_by IS NOT NULL
--    AND i.note IS NULL
--    AND i.completed_at IS NOT NULL
--    AND i.created_at > i.completed_at + interval '1 minute';
--
-- UPDATE public.task_photo_items i SET completed_by = NULL
--  WHERE ... the same predicate ...;
--
-- And nothing may be left disabled. Section 8 raises if so, but after a manual
-- recovery it is worth asking directly - `tgenabled` is 'O' for a live trigger:
--
-- SELECT tgrelid::regclass AS table_name, tgname, tgenabled
--   FROM pg_trigger
--  WHERE tgrelid IN ('public.tasks'::regclass, 'public.photos'::regclass,
--                    'public.task_photo_items'::regclass)
--    AND NOT tgisinternal
--  ORDER BY 1, 2;
