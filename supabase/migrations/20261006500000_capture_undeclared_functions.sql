-- The functions and triggers behind the tables the previous migration captured.
--
-- WHY THIS IS SEPARATE, AND WHY IT COMES FIRST
--
-- `20261007000000_capture_undeclared_schema.sql` declares fourteen tables and
-- 73 row-level-security policies. Those policies CALL these functions:
-- `is_team_member`, `is_team_owner` and `has_role` appear throughout them. On a
-- database that does not have the functions, creating the policies fails, so
-- this file has to run BEFORE that one despite the later timestamp. Apply it
-- first, or apply both and re-run the other.
--
-- WHAT WAS MISSING
--
-- Eleven functions and six triggers that production has and no migration here
-- declares. Two of them decide whether anybody can read anything:
--
--   is_team_member / is_team_owner   the predicate almost every policy is built
--                                    from, so without them the security model
--                                    does not exist rather than merely failing
--   handle_new_user                  writes the `profiles` row when somebody
--                                    signs up; without it a new account has no
--                                    profile and the app has nowhere to put a
--                                    name
--
-- The rest keep `updated_at` honest and move the email queue along.
--
-- Taken from `pg_get_functiondef` and `pg_get_triggerdef`, so this is what is
-- running rather than what was intended. `CREATE OR REPLACE` on the functions
-- makes it safe against production; the triggers are dropped and recreated for
-- the same reason.

-- === FUNCTIONS ==============================================================

CREATE OR REPLACE FUNCTION public.delete_email(queue_name text, message_id bigint)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
BEGIN
  RETURN pgmq.delete(queue_name, message_id);
EXCEPTION WHEN undefined_table THEN
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.enqueue_email(queue_name text, payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
BEGIN
  RETURN pgmq.send(queue_name, payload);
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN pgmq.send(queue_name, payload);
END;
$function$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$function$;

CREATE OR REPLACE FUNCTION public.is_team_member(_team uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.team_members WHERE team_id = _team AND user_id = _user
  )
$function$;

CREATE OR REPLACE FUNCTION public.is_team_owner(_team uuid, _user uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.teams WHERE id = _team AND owner_id = _user
  )
$function$;

CREATE OR REPLACE FUNCTION public.move_to_dlq(source_queue text, dlq_name text, message_id bigint, payload jsonb)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
DECLARE new_id bigint;
BEGIN
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  PERFORM pgmq.delete(source_queue, message_id);
  RETURN new_id;
EXCEPTION WHEN undefined_table THEN
  BEGIN PERFORM pgmq.create(dlq_name); EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT pgmq.send(dlq_name, payload) INTO new_id;
  BEGIN PERFORM pgmq.delete(source_queue, message_id); EXCEPTION WHEN undefined_table THEN NULL; END;
  RETURN new_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.projects_sync_state_timestamps()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.starred IS DISTINCT FROM OLD.starred THEN
    NEW.starred_at := CASE
      WHEN NEW.starred THEN COALESCE(NEW.starred_at, now())
      ELSE NULL
    END;
  END IF;

  IF NEW.archived IS DISTINCT FROM OLD.archived THEN
    NEW.archived_at := CASE
      WHEN NEW.archived THEN COALESCE(NEW.archived_at, now())
      ELSE NULL
    END;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_email_batch(queue_name text, batch_size integer, vt integer)
 RETURNS TABLE(msg_id bigint, read_ct integer, message jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pgmq'
AS $function$
BEGIN
  RETURN QUERY SELECT r.msg_id, r.read_ct, r.message FROM pgmq.read(queue_name, vt, batch_size) r;
EXCEPTION WHEN undefined_table THEN
  PERFORM pgmq.create(queue_name);
  RETURN;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

CREATE OR REPLACE FUNCTION public.tags_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- === TRIGGERS ===============================================================

DROP TRIGGER IF EXISTS set_photos_updated_at ON public.photos;
CREATE TRIGGER set_photos_updated_at BEFORE UPDATE ON public.photos FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS set_profiles_updated_at ON public.profiles;
CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS project_groups_updated_at ON public.project_groups;
CREATE TRIGGER project_groups_updated_at BEFORE UPDATE ON public.project_groups FOR EACH ROW EXECUTE FUNCTION project_groups_set_updated_at();

DROP TRIGGER IF EXISTS projects_sync_state_timestamps_trigger ON public.projects;
CREATE TRIGGER projects_sync_state_timestamps_trigger BEFORE UPDATE OF starred, archived ON public.projects FOR EACH ROW EXECUTE FUNCTION projects_sync_state_timestamps();

DROP TRIGGER IF EXISTS tags_set_updated_at_trigger ON public.tags;
CREATE TRIGGER tags_set_updated_at_trigger BEFORE UPDATE ON public.tags FOR EACH ROW EXECUTE FUNCTION tags_set_updated_at();

DROP TRIGGER IF EXISTS walkthroughs_set_updated_at ON public.walkthroughs;
CREATE TRIGGER walkthroughs_set_updated_at BEFORE UPDATE ON public.walkthroughs FOR EACH ROW EXECUTE FUNCTION set_updated_at();
