-- Point a photo task's notification at the photo.
--
-- The client, on the photo viewer: "it should function for team members to
-- share comments and assign tasks to team members."
--
-- Assigning already reaches the person. `tasks_notify_assignee` has fired on
-- INSERT and on UPDATE OF assignee_user_id since 20260728120000, and the photo
-- panel's direct insert goes through it like any other task. What it could not
-- do is say WHICH photo. The link it wrote was:
--
--   '/projects/' || NEW.project_id
--
-- so a crew member tapping "New task assigned to you" landed on a job carrying
-- a few hundred thumbnails with no indication of the one the task was written
-- against. That is a search handed to the person you just gave work to.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS CHANGES
-- ---------------------------------------------------------------------------
-- One function body. When the task carries photos, the link gains the first of
-- them:
--
--   /projects/<project_id>?photo=<photo_id>
--
-- apps/web/src/routes/_app.projects.$projectId.tsx validates `photo` as a uuid
-- and ProjectDetailPage opens the viewer on it, clearing the reader's own phase
-- and tag filters first so a filter left from their last visit cannot swallow
-- the photo the link exists to show.
--
-- The first id, not all of them: `photo_ids` is an array because a task can be
-- raised against a set, and a link goes to one place. First is the one the
-- photo panel wrote when the task was created, which is the case this exists
-- for.
--
-- ---------------------------------------------------------------------------
-- WHAT IT LEAVES ALONE
-- ---------------------------------------------------------------------------
-- A task with no photos, which is most of them: `photo_ids` is NOT NULL DEFAULT
-- '{}' (20260618220000), so COALESCE drops the suffix and the link is
-- byte-identical to what it was. The trigger, its timing, and the
-- notification's title, body, type and entity columns are untouched. Only
-- `link_path` moves.
--
-- Notifications already sitting in the table keep the link they were written
-- with. They are a log of what was sent, and rewriting delivered messages to
-- point somewhere else is not a fix for anything.
--
-- The sibling mention notification is the same change on the TypeScript side,
-- in apps/api/src/domains/photos/comments.ts.
--
-- ---------------------------------------------------------------------------
-- NOTES
-- ---------------------------------------------------------------------------
-- CREATE OR REPLACE on the function only, declared exactly as 20260728120000
-- declares it, so the trigger keeps pointing at it and no event is missed
-- mid-migration. Idempotent: re-running installs the same body. Deliberately
-- unguarded, unlike the data migrations in this directory - `public.tasks`,
-- `tasks.photo_ids` and `create_notification` are all hard prerequisites of the
-- migration this replaces, so there is no database where this one is reachable
-- and they are not there.
--
-- Apply via the Everlumen Supabase SQL editor (or `supabase db push`).

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.notify_task_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _photo uuid;
BEGIN
  IF NEW.assignee_user_id IS DISTINCT FROM COALESCE(OLD.assignee_user_id, NULL) THEN
    -- NULL for a task raised against no photo, which the COALESCE below turns
    -- back into the plain project link this has always written.
    _photo := CASE
                WHEN COALESCE(array_length(NEW.photo_ids, 1), 0) > 0 THEN NEW.photo_ids[1]
                ELSE NULL
              END;

    PERFORM public.create_notification(
      NEW.assignee_user_id, auth.uid(), 'task_assigned',
      'New task assigned to you', NEW.title,
      '/projects/' || NEW.project_id || COALESCE('?photo=' || _photo::text, ''),
      NEW.project_id, 'task', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

-- === VERIFY ================================================================
-- The installed body should carry the suffix:
--
-- SELECT prosrc LIKE '%?photo=%' AS links_to_photo
--   FROM pg_proc WHERE proname = 'notify_task_assignee';
--
-- The trigger should still be attached to it, unchanged:
--
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgrelid = 'public.tasks'::regclass AND tgname = 'tasks_notify_assignee';
--
-- And on the next assignment of a photo task, the row it writes:
--
-- SELECT type, title, link_path FROM public.notifications
--  WHERE type = 'task_assigned'
--  ORDER BY created_at DESC LIMIT 5;
