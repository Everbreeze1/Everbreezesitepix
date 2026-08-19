-- TASKS AS A CONVERSATION, NOT A DROPBOX.
--
-- The review of the Tasks tab, in the client's words:
--
--   "No notification fires on assignment. If a task doesn't push a
--    notification, email, or SMS to the assignee, crew members have no way to
--    know new work landed on them unless they're manually refreshing the app."
--
--   "Single assignee only, no watchers/CC. You can't loop in a second person
--    (e.g., assign to a tech but keep the office manager on the task)."
--
--   "No comments/activity thread on a task. There's nowhere to leave a note
--    like 'waiting on part' without editing the description field, which
--    overwrites rather than logs."
--
-- Three separate holes with one shape: a task could be handed over, and after
-- that nothing about it could reach a second person.
--
-- ===========================================================================
-- 1. WHY THE ASSIGNMENT NOTIFICATION WAS MISSING
-- ===========================================================================
-- `tasks_notify_assignee` has existed since 20260728120000 and reads:
--
--     IF NEW.assignee_user_id IS DISTINCT FROM COALESCE(OLD.assignee_user_id, NULL)
--
-- on a trigger declared AFTER INSERT OR UPDATE. In a PL/pgSQL trigger fired by
-- INSERT, OLD is not assigned - it is not a row of NULLs, it is a record with
-- no type - and touching a field of it raises
--
--     record "old" is not assigned yet
--
-- so the whole statement is rolled back. Creating a task with an assignee
-- already filled in is the single most common way a task is assigned in this
-- app: the dialog collects title and assignee together and INSERTs once, and
-- that is exactly the path this branch decides.
--
-- The fix is to ask TG_OP instead of asking OLD. On INSERT the question is
-- "is anyone assigned"; on UPDATE it is "did the assignee change". Same
-- notification, same link, no dependence on a record that does not exist.
--
-- `notify_checklist_assignee` and `notify_workflow_assignee` carry the same
-- construct and are corrected here too, so the three read alike and nobody has
-- to remember which of them was the broken one.
--
-- ===========================================================================
-- 2. WHAT IS ADDED
-- ===========================================================================
--   public.task_watchers   - the CC line. Anyone looped in on a task is told
--                            when it is reassigned, completed or commented on,
--                            without holding it.
--   public.task_comments   - the thread. "Waiting on part" is a message with an
--                            author and a time, not an edit that overwrites the
--                            description.
--   notifications.emailed_at
--                          - so an assignment can leave the app. The row is the
--                            record of what was owed; this column is the record
--                            of whether it also went out by mail, and it is what
--                            makes the sender idempotent (see
--                            apps/api/src/domains/tasks/service.ts).
--
-- ===========================================================================
-- 3. WHAT IS DELIBERATELY NOT HERE
-- ===========================================================================
-- Email is not sent from Postgres. This database has no outbound HTTP, and a
-- trigger that could block on a third-party API would make assigning a task as
-- slow and as failure-prone as the mail provider. The trigger's job is to
-- decide WHO is owed a message and write that down; delivery is the API's.
--
-- Idempotent, safe to re-run. Apply via the SitePix Supabase SQL editor
-- (project ulmgvtuqjlzzadlwtiog) or `supabase db push`.

SET lock_timeout = '5s';

-- =========================================================================
-- NOTIFICATION TYPES
-- =========================================================================
-- Restated whole, following 20260728170000 and 20260819000000: the constraint
-- is dropped and rebuilt rather than amended, so this file has to carry every
-- value that came before it.
--
--   task_comment  - somebody wrote on a task you are on
--   task_watching - you were added to a task's CC line
--   task_updated  - a task you watch was reassigned or closed. Distinct from
--                   `task_completed`, which is the assignor's report-back and
--                   carries the right to reopen; a watcher is being kept in the
--                   loop, which is a different message to a different person.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted',
  'admin_announcement',
  'workflow_assigned',
  'task_completed', 'checklist_completed', 'workflow_completed',
  -- new in this migration
  'task_comment', 'task_watching', 'task_updated'
));

-- Same discovery-by-what-it-constrains as 20260819000000: the entity_type check
-- was declared inline on the column in 20260728120000, so Postgres named it and
-- guessing that name wrong fails silently in the worst way - the DROP does
-- nothing, the ADD succeeds under a fresh name, and the old constraint stays
-- behind rejecting every new row.
DO $$
DECLARE
  _name text;
BEGIN
  FOR _name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.notifications'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%entity_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', _name);
  END LOOP;

  ALTER TABLE public.notifications ADD CONSTRAINT notifications_entity_type_check CHECK (
    entity_type IN ('task', 'checklist', 'photo_comment', 'team_invite', 'workflow', 'task_comment')
  );
END $$;

-- =========================================================================
-- EMAIL DELIVERY MARKER
-- =========================================================================
-- Nullable and never defaulted: NULL means "not sent by mail", which is the
-- honest reading for every notification written before this column existed and
-- for every one whose recipient has email turned off.
--
-- No grant to `authenticated`. 20260728120000 scoped the client's UPDATE to
-- `read_at` alone precisely so a browser cannot rewrite the record of what was
-- delivered, and this column is part of that record. Only the service role
-- stamps it.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS emailed_at timestamptz;

COMMENT ON COLUMN public.notifications.emailed_at IS
  'When this notification also went out as email. NULL means in-app only. Stamped by the API, never by the client.';

-- The sender asks one question - "what is owed for this entity and not yet
-- sent" - so that is the index.
CREATE INDEX IF NOT EXISTS notifications_pending_email_idx
  ON public.notifications(entity_id, created_at DESC)
  WHERE emailed_at IS NULL;

-- =========================================================================
-- WHO CAN SEE A TASK
-- =========================================================================
-- The watcher and comment policies both need this, and both would otherwise
-- re-derive it. Written SECURITY DEFINER and mirroring the two SELECT policies
-- on `tasks` exactly (owner, from 20260618220000; teammate, from 20260728120000)
-- rather than nesting a query that would be re-filtered by those same policies
-- at every row.
--
-- If task visibility ever changes, this changes with it. There is no third
-- copy: the policies below call this, they do not restate it.

CREATE OR REPLACE FUNCTION public.can_see_task(_task_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.tasks t
    WHERE t.id = _task_id
      AND _user_id IS NOT NULL
      AND (t.created_by = _user_id OR public.are_teammates(_user_id, t.created_by))
  );
$$;

GRANT EXECUTE ON FUNCTION public.can_see_task(uuid, uuid) TO authenticated;

-- =========================================================================
-- WATCHERS - the CC line
-- =========================================================================
-- A watcher is not an assignee and never becomes one. They hold no work, they
-- cannot close the task, and `may_complete_assignment` is untouched by this
-- file. What they get is every message the task generates.
--
-- The office manager in the client's example is a watcher: the tech holds the
-- job, the office knows the moment it moves.

CREATE TABLE IF NOT EXISTS public.task_watchers (
  task_id    uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who looped them in. Shown on the chip, and the reason a watcher can tell an
  -- inherited CC from one they set themselves.
  added_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS task_watchers_user_idx ON public.task_watchers(user_id);

-- Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
-- TO anon`, so a new public table is readable by the publishable key - which is
-- in the browser bundle - from the moment it exists. That is how `walkthroughs`
-- and `team_invites` leaked. Revoked before anything is granted; nothing public
-- renders who is copied in on a task, so there is no anonymous read path to
-- break.
REVOKE ALL ON public.task_watchers FROM anon, PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.task_watchers TO authenticated;
GRANT ALL ON public.task_watchers TO service_role;

ALTER TABLE public.task_watchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Watchers visible with the task" ON public.task_watchers;
CREATE POLICY "Watchers visible with the task" ON public.task_watchers
  FOR SELECT TO authenticated USING (public.can_see_task(task_id, auth.uid()));

DROP POLICY IF EXISTS "Anyone on the task may add a watcher" ON public.task_watchers;
CREATE POLICY "Anyone on the task may add a watcher" ON public.task_watchers
  FOR INSERT TO authenticated WITH CHECK (public.can_see_task(task_id, auth.uid()));

-- Removing is looser than adding on purpose: a watcher must always be able to
-- take themselves off a thread without finding whoever added them, and anyone
-- who can see the task can tidy its CC line the same way they can edit it.
DROP POLICY IF EXISTS "Watchers may be removed by the task's crew" ON public.task_watchers;
CREATE POLICY "Watchers may be removed by the task's crew" ON public.task_watchers
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR public.can_see_task(task_id, auth.uid()));

-- =========================================================================
-- COMMENTS - the thread
-- =========================================================================
-- Mirrors `photo_comments` down to the column names, including
-- `mentions uuid[]`, so the two threads in this product are one pattern rather
-- than two.
--
-- `project_id` is denormalised off the task for the same reason it is on
-- `photo_comments`: the notification a comment raises carries a project id, and
-- a trigger that had to join back to `tasks` for it would be a join per comment
-- on the hot path.

CREATE TABLE IF NOT EXISTS public.task_comments (
  id         uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id    uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text NOT NULL CHECK (length(btrim(body)) > 0 AND length(body) <= 4000),
  mentions   uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS task_comments_task_created_idx
  ON public.task_comments(task_id, created_at);

-- Same default-privileges trap as `task_watchers` above, and a worse leak if it
-- were missed: a comment thread is free text about a customer's job.
REVOKE ALL ON public.task_comments FROM anon, PUBLIC;
GRANT SELECT, INSERT, DELETE ON public.task_comments TO authenticated;
GRANT ALL ON public.task_comments TO service_role;

ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Comments visible with the task" ON public.task_comments;
CREATE POLICY "Comments visible with the task" ON public.task_comments
  FOR SELECT TO authenticated USING (public.can_see_task(task_id, auth.uid()));

DROP POLICY IF EXISTS "Task crew may comment" ON public.task_comments;
CREATE POLICY "Task crew may comment" ON public.task_comments
  FOR INSERT TO authenticated
  WITH CHECK (author_id = auth.uid() AND public.can_see_task(task_id, auth.uid()));

-- Only your own words. A thread whose entries can be deleted by anyone who can
-- read it is not a record of anything.
DROP POLICY IF EXISTS "Authors delete their own comments" ON public.task_comments;
CREATE POLICY "Authors delete their own comments" ON public.task_comments
  FOR DELETE TO authenticated USING (author_id = auth.uid());

-- Live delivery, same as `notifications` and `photo_comments`: a thread two
-- people are reading has to move for both of them.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.task_watchers;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================================================================
-- THE ASSIGNMENT NOTIFICATION, FIXED
-- =========================================================================
-- Declared exactly as 20260728120000 and 20260905000000 declare it, so the
-- trigger keeps pointing at it and no event is missed mid-migration. The photo
-- link from 20260905000000 is carried forward unchanged.

CREATE OR REPLACE FUNCTION public.notify_task_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _photo uuid;
  _assigned boolean;
BEGIN
  -- TG_OP, not OLD. On INSERT there is no OLD to read, and reading it is what
  -- stopped this notification from ever firing on the create-with-assignee
  -- path - which is how the dialog assigns a task.
  _assigned := CASE TG_OP
                 WHEN 'INSERT' THEN NEW.assignee_user_id IS NOT NULL
                 ELSE NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id
               END;

  IF _assigned THEN
    _photo := CASE
                WHEN COALESCE(array_length(NEW.photo_ids, 1), 0) > 0 THEN NEW.photo_ids[1]
                ELSE NULL
              END;

    PERFORM public.create_notification(
      NEW.assignee_user_id, auth.uid(), 'task_assigned',
      'New task assigned to you', NEW.title,
      /*
       * A photo task opens its photo, which is what 20260905000000 added and
       * which is right: the task was written against that picture, and the
       * viewer carries the tasks panel.
       *
       * Everything else now opens the task. It used to be the bare project
       * link, which lands the reader on a grid of thumbnails with no
       * indication that the message was about a task at all - the same search
       * handed to the person you just gave work to that the photo link exists
       * to remove.
       */
      '/projects/' || NEW.project_id ||
        COALESCE('?photo=' || _photo::text, '?task=' || NEW.id::text),
      NEW.project_id, 'task', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- The same construct, in the two siblings that copied it.
CREATE OR REPLACE FUNCTION public.notify_checklist_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _assigned boolean;
BEGIN
  _assigned := CASE TG_OP
                 WHEN 'INSERT' THEN NEW.assigned_to IS NOT NULL
                 ELSE NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
               END;

  IF _assigned THEN
    PERFORM public.create_notification(
      NEW.assigned_to, auth.uid(), 'checklist_assigned',
      'New checklist assigned to you', NEW.name,
      '/projects/' || NEW.project_id, NEW.project_id, 'checklist', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_workflow_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _assigned boolean;
BEGIN
  _assigned := CASE TG_OP
                 WHEN 'INSERT' THEN NEW.assigned_to IS NOT NULL
                 ELSE NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
               END;

  IF _assigned THEN
    PERFORM public.create_notification(
      NEW.assigned_to, auth.uid(), 'workflow_assigned',
      'New workflow assigned to you', NEW.name,
      '/projects/' || NEW.project_id, NEW.project_id, 'workflow', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- =========================================================================
-- WATCHERS GET TOLD
-- =========================================================================
-- Two events reach the CC line: the task changed hands, or it closed.
--
-- Everyone who already has their own message about the event is excluded, so
-- being both the assignee and a watcher does not produce two bells for one
-- thing: the assignee has `task_assigned`, the assignor has `task_completed`,
-- and `create_notification` drops the row when the recipient is the actor.

CREATE OR REPLACE FUNCTION public.notify_task_watchers() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _watcher uuid;
  _reassigned boolean;
  _completed boolean;
  _title text;
  _link text;
BEGIN
  _reassigned := NEW.assignee_user_id IS DISTINCT FROM OLD.assignee_user_id;
  _completed  := NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done';

  IF NOT (_reassigned OR _completed) THEN
    RETURN NEW;
  END IF;

  -- Completion is the louder of the two, so it wins when one update does both.
  _title := CASE WHEN _completed THEN 'Task completed' ELSE 'Task reassigned' END;
  _link  := '/projects/' || NEW.project_id || '?task=' || NEW.id::text;

  FOR _watcher IN
    SELECT w.user_id
      FROM public.task_watchers w
     WHERE w.task_id = NEW.id
       AND w.user_id IS DISTINCT FROM NEW.assignee_user_id
       AND w.user_id IS DISTINCT FROM COALESCE(NEW.assigned_by, NEW.created_by)
  LOOP
    PERFORM public.create_notification(
      _watcher, auth.uid(), 'task_updated',
      _title, NEW.title, _link, NEW.project_id, 'task', NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

-- UPDATE only. A task that has just been INSERTed has no watchers - nothing can
-- subscribe to a row that did not exist a moment ago - so an INSERT arm would
-- be a scan of an empty set on every task ever created, and would also put OLD
-- back into a function that has to run on INSERT.
DROP TRIGGER IF EXISTS tasks_notify_watchers ON public.tasks;
CREATE TRIGGER tasks_notify_watchers
  AFTER UPDATE OF assignee_user_id, status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_watchers();

-- Being added to a thread is itself worth a message: otherwise the first thing
-- a watcher hears is a comment about a task they have never seen.
CREATE OR REPLACE FUNCTION public.notify_task_watcher_added() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _task record;
BEGIN
  SELECT t.title, t.project_id INTO _task FROM public.tasks t WHERE t.id = NEW.task_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM public.create_notification(
    NEW.user_id, auth.uid(), 'task_watching',
    'You were added to a task', _task.title,
    '/projects/' || _task.project_id || '?task=' || NEW.task_id::text,
    _task.project_id, 'task', NEW.task_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_watchers_notify_added ON public.task_watchers;
CREATE TRIGGER task_watchers_notify_added
  AFTER INSERT ON public.task_watchers
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_watcher_added();

-- =========================================================================
-- A COMMENT REACHES EVERYONE ON THE TASK
-- =========================================================================
-- The audience is the task's whole cast, gathered in one UNION so nobody is
-- counted twice and nobody has to be remembered separately:
--
--   the assignee            - it is their job being discussed
--   the assignor            - they own the outcome
--   the creator             - who raised it, when nobody handed it over
--   every watcher           - the point of the CC line
--   everyone who has already written on the thread
--   anyone named in the message
--
-- minus the author, who is doing the writing. `create_notification` drops the
-- self-notification anyway; excluding here also keeps the loop short.
--
-- A mention gets a louder title but the same type. Splitting mentions into
-- their own notification type would mean a reader who is both mentioned and
-- watching gets two bells for one sentence.

CREATE OR REPLACE FUNCTION public.notify_task_comment() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _task record;
  _author text;
  _recipient uuid;
  _link text;
BEGIN
  SELECT t.title, t.project_id, t.assignee_user_id, t.assigned_by, t.created_by
    INTO _task
    FROM public.tasks t
   WHERE t.id = NEW.task_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), p.email)
    INTO _author
    FROM public.profiles p
   WHERE p.id = NEW.author_id;
  _author := COALESCE(_author, 'Someone');

  _link := '/projects/' || NEW.project_id || '?task=' || NEW.task_id::text;

  FOR _recipient IN
    SELECT DISTINCT x.user_id FROM (
      SELECT _task.assignee_user_id AS user_id
      UNION SELECT _task.assigned_by
      UNION SELECT _task.created_by
      UNION SELECT w.user_id FROM public.task_watchers w WHERE w.task_id = NEW.task_id
      UNION SELECT c.author_id FROM public.task_comments c WHERE c.task_id = NEW.task_id
      UNION SELECT unnest(NEW.mentions)
    ) AS x
    WHERE x.user_id IS NOT NULL AND x.user_id <> NEW.author_id
  LOOP
    PERFORM public.create_notification(
      _recipient, NEW.author_id, 'task_comment',
      CASE
        WHEN _recipient = ANY (NEW.mentions) THEN _author || ' mentioned you'
        ELSE _author || ' commented on a task'
      END,
      -- The task's name first, then the message: a bell that says only
      -- "waiting on part" tells the reader nothing about which job.
      _task.title || ' - ' || NEW.body,
      _link, NEW.project_id, 'task_comment', NEW.id
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS task_comments_notify ON public.task_comments;
CREATE TRIGGER task_comments_notify
  AFTER INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_comment();

-- =========================================================================
-- VERIFY
-- =========================================================================
-- The assignment trigger no longer reads OLD on INSERT:
--
--   SELECT prosrc LIKE '%TG_OP%' AS tg_op_aware
--     FROM pg_proc WHERE proname = 'notify_task_assignee';
--
-- The two new tables, their policies, and the delivery marker:
--
--   SELECT tablename, policyname, cmd FROM pg_policies
--    WHERE tablename IN ('task_watchers', 'task_comments') ORDER BY 1, 3;
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'notifications' AND column_name = 'emailed_at';
--
-- End to end, on a task assigned to somebody other than yourself - one
-- 'task_assigned' row should appear for the assignee:
--
--   SELECT type, title, recipient_id, emailed_at FROM public.notifications
--    WHERE entity_type = 'task' ORDER BY created_at DESC LIMIT 5;
