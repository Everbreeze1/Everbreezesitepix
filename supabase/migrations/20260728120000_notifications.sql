-- NOTIFICATIONS - run this in the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent, safe to re-run.

-- =========================
-- TABLE
-- =========================
CREATE TABLE IF NOT EXISTS public.notifications (
  id           uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type         text NOT NULL CHECK (type IN (
                 'task_assigned', 'checklist_assigned', 'photo_comment_mention', 'team_invite_accepted'
               )),
  title        text NOT NULL,
  body         text,
  link_path    text,
  project_id   uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type  text CHECK (entity_type IN ('task', 'checklist', 'photo_comment', 'team_invite')),
  entity_id    uuid,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_recipient_created_idx
  ON public.notifications(recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications(recipient_id) WHERE read_at IS NULL;

-- No INSERT/DELETE grant to `authenticated` at all - rows can only be created by a
-- SECURITY DEFINER trigger function below, or by server code using the service-role
-- key. UPDATE is column-scoped to `read_at` so a client can mark-read but can never
-- rewrite title/body/actor_id even by calling supabase.from(...) directly.
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recipients view own notifications" ON public.notifications;
CREATE POLICY "Recipients view own notifications" ON public.notifications
  FOR SELECT TO authenticated USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS "Recipients mark own notifications read" ON public.notifications;
CREATE POLICY "Recipients mark own notifications read" ON public.notifications
  FOR UPDATE TO authenticated USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

-- Live delivery to the bell dropdown (matches project_checklists / photo_comments / etc.)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- =========================
-- Fix: `tasks` was missed when teammate policies were added in 20260612191404_teams.sql.
-- Every other shared table (projects, photos, videos, walkthroughs, project_checklists)
-- got an additive "Teammates ..." policy there; tasks never did, so a task assigned to
-- a teammate is invisible to them (created_by-only RLS). Additive - existing owner-only
-- policies remain, RLS unions them.
-- =========================
DROP POLICY IF EXISTS "Teammates view team tasks" ON public.tasks;
CREATE POLICY "Teammates view team tasks" ON public.tasks
  FOR SELECT TO authenticated USING (public.are_teammates(auth.uid(), created_by));

DROP POLICY IF EXISTS "Teammates update team tasks" ON public.tasks;
CREATE POLICY "Teammates update team tasks" ON public.tasks
  FOR UPDATE TO authenticated USING (public.are_teammates(auth.uid(), created_by));

-- =========================
-- Shared insert helper - centralizes "never notify yourself / never notify a null
-- recipient" so every trigger and server call site gets it for free.
-- =========================
CREATE OR REPLACE FUNCTION public.create_notification(
  _recipient_id uuid,
  _actor_id uuid,
  _type text,
  _title text,
  _body text,
  _link_path text,
  _project_id uuid,
  _entity_type text,
  _entity_id uuid
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.notifications
    (recipient_id, actor_id, type, title, body, link_path, project_id, entity_type, entity_id)
  SELECT _recipient_id, _actor_id, _type, _title, _body, _link_path, _project_id, _entity_type, _entity_id
  WHERE _recipient_id IS NOT NULL AND _recipient_id IS DISTINCT FROM _actor_id;
$$;

-- =========================
-- Trigger: task assigned to you
-- =========================
CREATE OR REPLACE FUNCTION public.notify_task_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assignee_user_id IS DISTINCT FROM COALESCE(OLD.assignee_user_id, NULL) THEN
    PERFORM public.create_notification(
      NEW.assignee_user_id, auth.uid(), 'task_assigned',
      'New task assigned to you', NEW.title,
      '/projects/' || NEW.project_id, NEW.project_id, 'task', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tasks_notify_assignee ON public.tasks;
CREATE TRIGGER tasks_notify_assignee
  AFTER INSERT OR UPDATE OF assignee_user_id ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.notify_task_assignee();

-- =========================
-- Trigger: checklist assigned to you
-- =========================
CREATE OR REPLACE FUNCTION public.notify_checklist_assignee() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.assigned_to IS DISTINCT FROM COALESCE(OLD.assigned_to, NULL) THEN
    PERFORM public.create_notification(
      NEW.assigned_to, auth.uid(), 'checklist_assigned',
      'New checklist assigned to you', NEW.name,
      '/projects/' || NEW.project_id, NEW.project_id, 'checklist', NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS checklists_notify_assignee ON public.project_checklists;
CREATE TRIGGER checklists_notify_assignee
  AFTER INSERT OR UPDATE OF assigned_to ON public.project_checklists
  FOR EACH ROW EXECUTE FUNCTION public.notify_checklist_assignee();

-- Photo-comment mentions and team-invite-accepted notifications are inserted from
-- application code (apps/api/src/domains/photos/comments.ts,
-- apps/api/src/domains/teams/service.ts) via the service-role key, not triggers here -
-- both of those write paths already run server-side via getSupabaseAdmin(), which
-- carries no user JWT, so auth.uid() would be NULL inside a trigger fired by them.
