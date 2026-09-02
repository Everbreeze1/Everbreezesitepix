-- The tables production has always had and this repo has never declared.
--
-- WHY THIS EXISTS
--
-- `LAUNCH.md` 1.4 records it as a blocker: `walkthroughs`, `photos`, `projects`
-- and `profiles` are created by no migration here. Comparing the live database
-- against every `create table` in `supabase/migrations` puts the real number at
-- FOURTEEN, listed below. Between them they hold the projects, the photographs,
-- the people and the tags - the substance of the product.
--
-- The consequence is that `supabase/migrations` cannot rebuild production. There
-- is no disaster-recovery path and no way to stand up a staging copy, because
-- the most important tables would simply be absent.
--
-- It has a second cost that is easy to miss. A table no migration declares has
-- no reviewed shape, so gaps in it are invisible: `photos.project_id` carried no
-- foreign key for the life of the project, and eight rows now point at projects
-- that no longer exist. That was found by reading the live catalogue, which is
-- the only place the truth was written down.
--
-- WHAT THIS IS
--
-- Generated from the live catalogue (`pg_class`, `pg_constraint`, `pg_indexes`,
-- `pg_policy`, `information_schema.role_table_grants`) rather than written by
-- hand, so it says what production actually is rather than what anyone remembers
-- deciding. Columns, constraints, indexes, RLS state, 73 policies and the grants.
--
-- HOW TO USE IT
--
-- Idempotent by construction - `IF NOT EXISTS` on tables and indexes, constraints
-- wrapped so a duplicate is skipped, policies dropped before being recreated. It
-- can be run against production, where it should be a no-op, and that is the way
-- to check it is faithful before trusting it for recovery.
--
-- WHAT IT DOES NOT COVER
--
--   * Triggers and functions. Several of these tables have them; they live in
--     other migrations or nowhere, and they need the same treatment next.
--   * Data. Structure only.
--   * `storage.*` and `auth.*`. Supabase owns those.
--
-- ONE THING THIS FILE REPRODUCES THAT YOU MAY NOT WANT
--
-- Eleven of these tables grant `anon` the full set - SELECT, INSERT, UPDATE,
-- DELETE, TRUNCATE - among them `photos`, `profiles`, `videos` and
-- `user_roles`. The grants are reproduced below because this file describes
-- production as it is, not as it should be.
--
-- They are not an open door. RLS is enabled on all fourteen and every one
-- carries policies (`photos` has fifteen), so a grant without a matching policy
-- reaches no rows, and the anon-exposure probe recorded in `LAUNCH.md` found
-- nothing readable. This is the Supabase default posture: grant broadly, filter
-- with RLS.
--
-- It is still inconsistent with this repo's own standard. `tests/invariants.test.ts`
-- requires `REVOKE ALL ... FROM anon` on new tables, which is why the three
-- tables here that predate nothing - `projects`, `walkthroughs`,
-- `walkthrough_photos` - already have it and these eleven do not. Closing that
-- gap is a separate change with its own testing, because revoking a grant that
-- something quietly depends on fails at runtime rather than here:
--
--   REVOKE ALL ON public.photos FROM anon;   -- and the other ten
--
-- Left alone deliberately. A recovery file that changes the thing it is meant to
-- reproduce is not a recovery file.

-- Verifying it: run it against an empty database, then diff the catalogue of
-- that database against production. Anything that differs is something this file
-- still does not say.

-- ---------------------------------------------------------------- email_send_log
CREATE TABLE IF NOT EXISTS public.email_send_log (
  id uuid default gen_random_uuid() not null,
  message_id text,
  template_name text not null,
  recipient_email text not null,
  status text not null,
  error_message text,
  metadata jsonb,
  created_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.email_send_log ADD CONSTRAINT email_send_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS email_send_log_created_at_idx ON public.email_send_log USING btree (created_at DESC);
CREATE INDEX IF NOT EXISTS email_send_log_message_id_idx ON public.email_send_log USING btree (message_id);
ALTER TABLE public.email_send_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can insert send log" ON public.email_send_log;
CREATE POLICY "Service role can insert send log" ON public.email_send_log
  FOR INSERT
  WITH CHECK ((auth.role() = 'service_role'::text));
DROP POLICY IF EXISTS "Service role can read send log" ON public.email_send_log;
CREATE POLICY "Service role can read send log" ON public.email_send_log
  FOR SELECT
  USING ((auth.role() = 'service_role'::text));
DROP POLICY IF EXISTS "Service role can update send log" ON public.email_send_log;
CREATE POLICY "Service role can update send log" ON public.email_send_log
  FOR UPDATE
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_send_log TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_send_log TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_send_log TO service_role;

-- ---------------------------------------------------------------- email_send_state
CREATE TABLE IF NOT EXISTS public.email_send_state (
  id integer default 1 not null,
  batch_size integer default 10 not null,
  send_delay_ms integer default 200 not null,
  auth_email_ttl_minutes integer default 15 not null,
  transactional_email_ttl_minutes integer default 60 not null,
  retry_after_until timestamp with time zone,
  updated_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD CONSTRAINT email_send_state_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.email_send_state ADD CONSTRAINT email_send_state_singleton CHECK ((id = 1));
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
ALTER TABLE public.email_send_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can manage send state" ON public.email_send_state;
CREATE POLICY "Service role can manage send state" ON public.email_send_state
  FOR ALL
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_send_state TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_send_state TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_send_state TO service_role;

-- ---------------------------------------------------------------- email_unsubscribe_tokens
CREATE TABLE IF NOT EXISTS public.email_unsubscribe_tokens (
  id uuid default gen_random_uuid() not null,
  token text not null,
  email text not null,
  created_at timestamp with time zone default now() not null,
  used_at timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE public.email_unsubscribe_tokens ADD CONSTRAINT email_unsubscribe_tokens_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.email_unsubscribe_tokens ADD CONSTRAINT email_unsubscribe_tokens_token_key UNIQUE (token);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS email_unsubscribe_tokens_email_idx ON public.email_unsubscribe_tokens USING btree (lower(email));
ALTER TABLE public.email_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can insert tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can insert tokens" ON public.email_unsubscribe_tokens
  FOR INSERT
  WITH CHECK ((auth.role() = 'service_role'::text));
DROP POLICY IF EXISTS "Service role can mark tokens as used" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can mark tokens as used" ON public.email_unsubscribe_tokens
  FOR UPDATE
  USING ((auth.role() = 'service_role'::text))
  WITH CHECK ((auth.role() = 'service_role'::text));
DROP POLICY IF EXISTS "Service role can read tokens" ON public.email_unsubscribe_tokens;
CREATE POLICY "Service role can read tokens" ON public.email_unsubscribe_tokens
  FOR SELECT
  USING ((auth.role() = 'service_role'::text));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_unsubscribe_tokens TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_unsubscribe_tokens TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.email_unsubscribe_tokens TO service_role;

-- ---------------------------------------------------------------- photo_tags
CREATE TABLE IF NOT EXISTS public.photo_tags (
  photo_id uuid not null,
  tag_id uuid not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.photo_tags ADD CONSTRAINT photo_tags_pkey PRIMARY KEY (photo_id, tag_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.photo_tags ADD CONSTRAINT photo_tags_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.photo_tags ADD CONSTRAINT photo_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS photo_tags_created_by_idx ON public.photo_tags USING btree (created_by);
CREATE INDEX IF NOT EXISTS photo_tags_tag_id_idx ON public.photo_tags USING btree (tag_id);
ALTER TABLE public.photo_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can delete photo tags" ON public.photo_tags;
CREATE POLICY "Authenticated users can delete photo tags" ON public.photo_tags
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM photos ph
  WHERE (ph.id = photo_tags.photo_id))));
DROP POLICY IF EXISTS "Authenticated users can insert photo tags" ON public.photo_tags;
CREATE POLICY "Authenticated users can insert photo tags" ON public.photo_tags
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM photos ph
  WHERE (ph.id = photo_tags.photo_id))));
DROP POLICY IF EXISTS "Authenticated users can read photo tags" ON public.photo_tags;
CREATE POLICY "Authenticated users can read photo tags" ON public.photo_tags
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM photos ph
  WHERE (ph.id = photo_tags.photo_id))));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.photo_tags TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.photo_tags TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.photo_tags TO service_role;

-- ---------------------------------------------------------------- photos
CREATE TABLE IF NOT EXISTS public.photos (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  storage_path text not null,
  caption text,
  taken_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  latitude double precision,
  longitude double precision,
  phase text,
  tags text[],
  size_bytes bigint,
  uploaded_by uuid,
  image_url text,
  hidden boolean default false not null,
  deleted_at timestamp with time zone,
  archived boolean default false not null,
  archived_at timestamp with time zone,
  thumb_path text
);

DO $$ BEGIN
  ALTER TABLE public.photos ADD CONSTRAINT photos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.photos ADD CONSTRAINT photos_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.photos ADD CONSTRAINT photos_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON public.photos USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_photos_project_active ON public.photos USING btree (project_id, taken_at DESC NULLS LAST, created_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS photos_project_id_idx ON public.photos USING btree (project_id);
ALTER TABLE public.photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Restricted members add photos to assigned projects" ON public.photos;
CREATE POLICY "Restricted members add photos to assigned projects" ON public.photos
  FOR INSERT
  TO authenticated
  WITH CHECK (((uploaded_by = auth.uid()) AND member_can_reach_project(auth.uid(), project_id)));
DROP POLICY IF EXISTS "Restricted members edit photos on assigned projects" ON public.photos;
CREATE POLICY "Restricted members edit photos on assigned projects" ON public.photos
  FOR UPDATE
  TO authenticated
  USING (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Restricted members view photos on assigned projects" ON public.photos;
CREATE POLICY "Restricted members view photos on assigned projects" ON public.photos
  FOR SELECT
  TO authenticated
  USING (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Subcontractors edit their own photos" ON public.photos;
CREATE POLICY "Subcontractors edit their own photos" ON public.photos
  FOR UPDATE
  TO authenticated
  USING (((uploaded_by = auth.uid()) AND subcontractor_can_reach_project(auth.uid(), project_id)));
DROP POLICY IF EXISTS "Subcontractors upload to assigned projects" ON public.photos;
CREATE POLICY "Subcontractors upload to assigned projects" ON public.photos
  FOR INSERT
  TO authenticated
  WITH CHECK (((uploaded_by = auth.uid()) AND subcontractor_can_reach_project(auth.uid(), project_id)));
DROP POLICY IF EXISTS "Subcontractors view photos on assigned projects" ON public.photos;
CREATE POLICY "Subcontractors view photos on assigned projects" ON public.photos
  FOR SELECT
  TO authenticated
  USING (subcontractor_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Teammates delete team photos" ON public.photos;
CREATE POLICY "Teammates delete team photos" ON public.photos
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = photos.project_id) AND are_teammates(auth.uid(), p.created_by)))));
DROP POLICY IF EXISTS "Teammates insert team photos" ON public.photos;
CREATE POLICY "Teammates insert team photos" ON public.photos
  FOR INSERT
  TO authenticated
  WITH CHECK (((uploaded_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = photos.project_id) AND are_teammates(auth.uid(), p.created_by))))));
DROP POLICY IF EXISTS "Teammates manage team photos" ON public.photos;
CREATE POLICY "Teammates manage team photos" ON public.photos
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = photos.project_id) AND are_teammates(auth.uid(), p.created_by)))));
DROP POLICY IF EXISTS "Teammates update team photos" ON public.photos;
CREATE POLICY "Teammates update team photos" ON public.photos
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = photos.project_id) AND are_teammates(auth.uid(), p.created_by)))));
DROP POLICY IF EXISTS "Teammates view team photos" ON public.photos;
CREATE POLICY "Teammates view team photos" ON public.photos
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = photos.project_id) AND are_teammates(auth.uid(), p.created_by)))));
DROP POLICY IF EXISTS "photos_delete_own" ON public.photos;
CREATE POLICY "photos_delete_own" ON public.photos
  FOR DELETE
  TO authenticated
  USING ((uploaded_by = auth.uid()));
DROP POLICY IF EXISTS "photos_insert_own" ON public.photos;
CREATE POLICY "photos_insert_own" ON public.photos
  FOR INSERT
  TO authenticated
  WITH CHECK ((uploaded_by = auth.uid()));
DROP POLICY IF EXISTS "photos_select_own" ON public.photos;
CREATE POLICY "photos_select_own" ON public.photos
  FOR SELECT
  TO authenticated
  USING ((uploaded_by = auth.uid()));
DROP POLICY IF EXISTS "photos_update_own" ON public.photos;
CREATE POLICY "photos_update_own" ON public.photos
  FOR UPDATE
  TO authenticated
  USING ((uploaded_by = auth.uid()))
  WITH CHECK ((uploaded_by = auth.uid()));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.photos TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.photos TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.photos TO service_role;

-- ---------------------------------------------------------------- profiles
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid not null,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company text,
  company_address text,
  company_phone text,
  company_logo_url text,
  watermark_enabled boolean default true not null,
  report_photos_per_page smallint default 2 not null,
  job_title text,
  setup_prompt_dismissed_at timestamp with time zone,
  notification_prefs jsonb default '{}'::jsonb not null
);

DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_report_photos_per_page_check CHECK (((report_photos_per_page >= 1) AND (report_photos_per_page <= 4)));
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = id));
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile" ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS "profiles delete own" ON public.profiles;
CREATE POLICY "profiles delete own" ON public.profiles
  FOR DELETE
  TO authenticated
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS "profiles insert own" ON public.profiles;
CREATE POLICY "profiles insert own" ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = id));
DROP POLICY IF EXISTS "profiles select own" ON public.profiles;
CREATE POLICY "profiles select own" ON public.profiles
  FOR SELECT
  TO authenticated
  USING ((auth.uid() = id));
DROP POLICY IF EXISTS "profiles update own" ON public.profiles;
CREATE POLICY "profiles update own" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING ((auth.uid() = id))
  WITH CHECK ((auth.uid() = id));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.profiles TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.profiles TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.profiles TO service_role;

-- ---------------------------------------------------------------- project_tags
CREATE TABLE IF NOT EXISTS public.project_tags (
  project_id uuid not null,
  tag_id uuid not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.project_tags ADD CONSTRAINT project_tags_pkey PRIMARY KEY (project_id, tag_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.project_tags ADD CONSTRAINT project_tags_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.project_tags ADD CONSTRAINT project_tags_tag_id_fkey FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS project_tags_created_by_idx ON public.project_tags USING btree (created_by);
CREATE INDEX IF NOT EXISTS project_tags_tag_id_idx ON public.project_tags USING btree (tag_id);
ALTER TABLE public.project_tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can delete project tags" ON public.project_tags;
CREATE POLICY "Authenticated users can delete project tags" ON public.project_tags
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE (p.id = project_tags.project_id))));
DROP POLICY IF EXISTS "Authenticated users can insert project tags" ON public.project_tags;
CREATE POLICY "Authenticated users can insert project tags" ON public.project_tags
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM projects p
  WHERE (p.id = project_tags.project_id))));
DROP POLICY IF EXISTS "Authenticated users can read project tags" ON public.project_tags;
CREATE POLICY "Authenticated users can read project tags" ON public.project_tags
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE (p.id = project_tags.project_id))));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.project_tags TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.project_tags TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.project_tags TO service_role;

-- ---------------------------------------------------------------- projects
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid default gen_random_uuid() not null,
  created_by uuid default auth.uid() not null,
  name text not null,
  description text,
  street text,
  city text,
  state text,
  zip text,
  latitude double precision,
  longitude double precision,
  status text default 'active'::text not null,
  tags text[],
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  starred boolean default false not null,
  starred_at timestamp with time zone,
  archived boolean default false not null,
  archived_at timestamp with time zone,
  gps_latitude numeric(10,7),
  gps_longitude numeric(10,7),
  gps_accuracy_meters numeric,
  gps_address text,
  gps_captured_at timestamp with time zone,
  labels text[] default '{}'::text[] not null,
  owner_id uuid,
  deleted_at timestamp with time zone,
  location text,
  share_token uuid default gen_random_uuid() not null,
  share_revoked_at timestamp with time zone default now(),
  share_decided_at timestamp with time zone,
  client_name text,
  client_contact text,
  project_number text,
  pipeline_stage_id uuid,
  scheduled_date date,
  team_id uuid,
  completed_at timestamp with time zone
);

DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_pipeline_stage_id_fkey FOREIGN KEY (pipeline_stage_id) REFERENCES pipeline_stages(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.projects ADD CONSTRAINT projects_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON public.projects USING btree (deleted_at) WHERE (deleted_at IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_projects_owner_active ON public.projects USING btree (owner_id, updated_at DESC) WHERE (deleted_at IS NULL);
CREATE INDEX IF NOT EXISTS projects_archived_at_idx ON public.projects USING btree (archived_at DESC) WHERE (archived = true);
CREATE INDEX IF NOT EXISTS projects_created_by_archived_idx ON public.projects USING btree (created_by, archived);
CREATE INDEX IF NOT EXISTS projects_created_by_idx ON public.projects USING btree (created_by);
CREATE INDEX IF NOT EXISTS projects_created_by_starred_idx ON public.projects USING btree (created_by, starred);
CREATE INDEX IF NOT EXISTS projects_labels_idx ON public.projects USING gin (labels);
CREATE INDEX IF NOT EXISTS projects_pipeline_stage_id_idx ON public.projects USING btree (pipeline_stage_id) WHERE (pipeline_stage_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS projects_scheduled_date_idx ON public.projects USING btree (scheduled_date) WHERE (scheduled_date IS NOT NULL);
CREATE INDEX IF NOT EXISTS projects_starred_at_idx ON public.projects USING btree (starred_at DESC) WHERE (starred = true);
CREATE INDEX IF NOT EXISTS projects_status_idx ON public.projects USING btree (status);
CREATE INDEX IF NOT EXISTS projects_team_id_idx ON public.projects USING btree (team_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_share_token_key ON public.projects USING btree (share_token);
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Restricted members update assigned projects" ON public.projects;
CREATE POLICY "Restricted members update assigned projects" ON public.projects
  FOR UPDATE
  TO authenticated
  USING (member_can_reach_project(auth.uid(), id));
DROP POLICY IF EXISTS "Restricted members view assigned projects" ON public.projects;
CREATE POLICY "Restricted members view assigned projects" ON public.projects
  FOR SELECT
  TO authenticated
  USING (member_can_reach_project(auth.uid(), id));
DROP POLICY IF EXISTS "Subcontractors view assigned projects" ON public.projects;
CREATE POLICY "Subcontractors view assigned projects" ON public.projects
  FOR SELECT
  TO authenticated
  USING (subcontractor_can_reach_project(auth.uid(), id));
DROP POLICY IF EXISTS "Teammates delete team projects" ON public.projects;
CREATE POLICY "Teammates delete team projects" ON public.projects
  FOR DELETE
  TO authenticated
  USING (are_teammates(auth.uid(), created_by));
DROP POLICY IF EXISTS "Teammates insert team projects" ON public.projects;
CREATE POLICY "Teammates insert team projects" ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK ((created_by = auth.uid()));
DROP POLICY IF EXISTS "Teammates update team projects" ON public.projects;
CREATE POLICY "Teammates update team projects" ON public.projects
  FOR UPDATE
  TO authenticated
  USING (are_teammates(auth.uid(), created_by));
DROP POLICY IF EXISTS "Teammates view team projects" ON public.projects;
CREATE POLICY "Teammates view team projects" ON public.projects
  FOR SELECT
  TO authenticated
  USING (are_teammates(auth.uid(), created_by));
DROP POLICY IF EXISTS "own projects" ON public.projects;
CREATE POLICY "own projects" ON public.projects
  FOR ALL
  TO authenticated
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));
DROP POLICY IF EXISTS "projects_delete_own" ON public.projects;
CREATE POLICY "projects_delete_own" ON public.projects
  FOR DELETE
  TO authenticated
  USING ((created_by = auth.uid()));
DROP POLICY IF EXISTS "projects_insert_own" ON public.projects;
CREATE POLICY "projects_insert_own" ON public.projects
  FOR INSERT
  TO authenticated
  WITH CHECK ((created_by = auth.uid()));
DROP POLICY IF EXISTS "projects_select_own" ON public.projects;
CREATE POLICY "projects_select_own" ON public.projects
  FOR SELECT
  TO authenticated
  USING ((created_by = auth.uid()));
DROP POLICY IF EXISTS "projects_update_own" ON public.projects;
CREATE POLICY "projects_update_own" ON public.projects
  FOR UPDATE
  TO authenticated
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));
REVOKE ALL ON public.projects FROM anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.projects TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.projects TO service_role;

-- ---------------------------------------------------------------- suppressed_emails
CREATE TABLE IF NOT EXISTS public.suppressed_emails (
  id uuid default gen_random_uuid() not null,
  email text not null,
  reason text not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.suppressed_emails ADD CONSTRAINT suppressed_emails_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS suppressed_emails_email_idx ON public.suppressed_emails USING btree (lower(email));
ALTER TABLE public.suppressed_emails ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can insert suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can insert suppressed emails" ON public.suppressed_emails
  FOR INSERT
  WITH CHECK ((auth.role() = 'service_role'::text));
DROP POLICY IF EXISTS "Service role can read suppressed emails" ON public.suppressed_emails;
CREATE POLICY "Service role can read suppressed emails" ON public.suppressed_emails
  FOR SELECT
  USING ((auth.role() = 'service_role'::text));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.suppressed_emails TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.suppressed_emails TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.suppressed_emails TO service_role;

-- ---------------------------------------------------------------- tags
CREATE TABLE IF NOT EXISTS public.tags (
  id uuid default gen_random_uuid() not null,
  name text not null,
  color text default '#64748b'::text not null,
  created_by uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.tags ADD CONSTRAINT tags_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS tags_created_by_idx ON public.tags USING btree (created_by);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_lower_unique_idx ON public.tags USING btree (lower(name));
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can insert tags" ON public.tags;
CREATE POLICY "Authenticated users can insert tags" ON public.tags
  FOR INSERT
  TO authenticated
  WITH CHECK ((auth.uid() = created_by));
DROP POLICY IF EXISTS "Authenticated users can read tags" ON public.tags;
CREATE POLICY "Authenticated users can read tags" ON public.tags
  FOR SELECT
  TO authenticated
  USING (true);
DROP POLICY IF EXISTS "Creators or admins can delete tags" ON public.tags;
CREATE POLICY "Creators or admins can delete tags" ON public.tags
  FOR DELETE
  TO authenticated
  USING (((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role)));
DROP POLICY IF EXISTS "Creators or admins can update tags" ON public.tags;
CREATE POLICY "Creators or admins can update tags" ON public.tags
  FOR UPDATE
  TO authenticated
  USING (((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK (((auth.uid() = created_by) OR has_role(auth.uid(), 'admin'::app_role)));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tags TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tags TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.tags TO service_role;

-- ---------------------------------------------------------------- user_roles
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  role app_role not null,
  created_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.user_roles ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Admins can read all roles" ON public.user_roles;
CREATE POLICY "Admins can read all roles" ON public.user_roles
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT
  TO authenticated
  USING ((user_id = auth.uid()));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.user_roles TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.user_roles TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.user_roles TO service_role;

-- ---------------------------------------------------------------- videos
CREATE TABLE IF NOT EXISTS public.videos (
  id uuid default gen_random_uuid() not null,
  caption text,
  created_at timestamp with time zone default now() not null,
  duration_seconds numeric default 0 not null,
  mime_type text,
  project_id uuid not null,
  size_bytes numeric default 0 not null,
  storage_path text not null,
  transcript text,
  uploaded_by uuid not null
);

DO $$ BEGIN
  ALTER TABLE public.videos ADD CONSTRAINT videos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.videos ADD CONSTRAINT videos_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE NOT VALID;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
ALTER TABLE public.videos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Restricted members add assigned videos" ON public.videos;
CREATE POLICY "Restricted members add assigned videos" ON public.videos
  FOR INSERT
  TO authenticated
  WITH CHECK (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Restricted members amend assigned videos" ON public.videos;
CREATE POLICY "Restricted members amend assigned videos" ON public.videos
  FOR UPDATE
  TO authenticated
  USING (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Restricted members view assigned videos" ON public.videos;
CREATE POLICY "Restricted members view assigned videos" ON public.videos
  FOR SELECT
  TO authenticated
  USING (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Teammates manage team videos" ON public.videos;
CREATE POLICY "Teammates manage team videos" ON public.videos
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = videos.project_id) AND are_teammates(auth.uid(), p.created_by)))));
DROP POLICY IF EXISTS "Users can manage their own project videos" ON public.videos;
CREATE POLICY "Users can manage their own project videos" ON public.videos
  FOR ALL
  TO authenticated
  USING ((auth.uid() = uploaded_by));
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.videos TO anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.videos TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.videos TO service_role;

-- ---------------------------------------------------------------- walkthrough_photos
CREATE TABLE IF NOT EXISTS public.walkthrough_photos (
  id uuid default gen_random_uuid() not null,
  walkthrough_id uuid not null,
  photo_id uuid not null,
  created_by uuid not null,
  offset_seconds integer default 0 not null,
  spoken_note text,
  position integer default 0 not null,
  created_at timestamp with time zone default now() not null
);

DO $$ BEGIN
  ALTER TABLE public.walkthrough_photos ADD CONSTRAINT walkthrough_photos_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthrough_photos ADD CONSTRAINT walkthrough_photos_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthrough_photos ADD CONSTRAINT walkthrough_photos_photo_id_fkey FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthrough_photos ADD CONSTRAINT walkthrough_photos_walkthrough_id_fkey FOREIGN KEY (walkthrough_id) REFERENCES walkthroughs(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthrough_photos ADD CONSTRAINT walkthrough_photos_walkthrough_id_photo_id_key UNIQUE (walkthrough_id, photo_id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS walkthrough_photos_photo_idx ON public.walkthrough_photos USING btree (photo_id);
CREATE INDEX IF NOT EXISTS walkthrough_photos_walk_idx ON public.walkthrough_photos USING btree (walkthrough_id);
CREATE INDEX IF NOT EXISTS walkthrough_photos_walkthrough_position_idx ON public.walkthrough_photos USING btree (walkthrough_id, "position");
CREATE UNIQUE INDEX IF NOT EXISTS walkthrough_photos_unique_link_idx ON public.walkthrough_photos USING btree (walkthrough_id, photo_id);
ALTER TABLE public.walkthrough_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Restricted members amend assigned walkthrough photos" ON public.walkthrough_photos;
CREATE POLICY "Restricted members amend assigned walkthrough photos" ON public.walkthrough_photos
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM walkthroughs w
  WHERE ((w.id = walkthrough_photos.walkthrough_id) AND member_can_reach_project(auth.uid(), w.project_id)))));
DROP POLICY IF EXISTS "Restricted members link assigned walkthrough photos" ON public.walkthrough_photos;
CREATE POLICY "Restricted members link assigned walkthrough photos" ON public.walkthrough_photos
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM walkthroughs w
  WHERE ((w.id = walkthrough_photos.walkthrough_id) AND member_can_reach_project(auth.uid(), w.project_id)))));
DROP POLICY IF EXISTS "Restricted members view assigned walkthrough photos" ON public.walkthrough_photos;
CREATE POLICY "Restricted members view assigned walkthrough photos" ON public.walkthrough_photos
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM walkthroughs w
  WHERE ((w.id = walkthrough_photos.walkthrough_id) AND member_can_reach_project(auth.uid(), w.project_id)))));
DROP POLICY IF EXISTS "Teammates manage team walkthrough photos" ON public.walkthrough_photos;
CREATE POLICY "Teammates manage team walkthrough photos" ON public.walkthrough_photos
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM walkthroughs w
  WHERE ((w.id = walkthrough_photos.walkthrough_id) AND ((w.created_by = auth.uid()) OR (EXISTS ( SELECT 1
           FROM projects p
          WHERE ((p.id = w.project_id) AND are_teammates(auth.uid(), p.created_by)))))))));
DROP POLICY IF EXISTS "walkthrough_photos_write" ON public.walkthrough_photos;
CREATE POLICY "walkthrough_photos_write" ON public.walkthrough_photos
  FOR ALL
  TO authenticated
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));
REVOKE ALL ON public.walkthrough_photos FROM anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.walkthrough_photos TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.walkthrough_photos TO service_role;

-- ---------------------------------------------------------------- walkthroughs
CREATE TABLE IF NOT EXISTS public.walkthroughs (
  id uuid default gen_random_uuid() not null,
  project_id uuid not null,
  created_by uuid not null,
  title text default 'Walkthrough'::text not null,
  description text,
  audio_url text,
  status text default 'recording'::text not null,
  started_at timestamp with time zone default now() not null,
  ended_at timestamp with time zone,
  duration_seconds integer default 0 not null,
  transcript text,
  summary_markdown text,
  share_token uuid,
  video_path text,
  video_mime_type text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  source text default 'recorded'::text not null,
  narration_json jsonb
);

DO $$ BEGIN
  ALTER TABLE public.walkthroughs ADD CONSTRAINT walkthroughs_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthroughs ADD CONSTRAINT walkthroughs_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthroughs ADD CONSTRAINT walkthroughs_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthroughs ADD CONSTRAINT walkthroughs_share_token_key UNIQUE (share_token);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthroughs ADD CONSTRAINT walkthroughs_source_check CHECK ((source = ANY (ARRAY['recorded'::text, 'summary'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.walkthroughs ADD CONSTRAINT walkthroughs_status_check CHECK ((status = ANY (ARRAY['recording'::text, 'generating'::text, 'ready'::text, 'failed'::text])));
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS walkthroughs_created_by_idx ON public.walkthroughs USING btree (created_by);
CREATE INDEX IF NOT EXISTS walkthroughs_project_created_idx ON public.walkthroughs USING btree (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS walkthroughs_project_id_idx ON public.walkthroughs USING btree (project_id);
CREATE INDEX IF NOT EXISTS walkthroughs_share_token_idx ON public.walkthroughs USING btree (share_token);
ALTER TABLE public.walkthroughs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Restricted members add assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members add assigned walkthroughs" ON public.walkthroughs
  FOR INSERT
  TO authenticated
  WITH CHECK (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Restricted members amend assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members amend assigned walkthroughs" ON public.walkthroughs
  FOR UPDATE
  TO authenticated
  USING (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Restricted members view assigned walkthroughs" ON public.walkthroughs;
CREATE POLICY "Restricted members view assigned walkthroughs" ON public.walkthroughs
  FOR SELECT
  TO authenticated
  USING (member_can_reach_project(auth.uid(), project_id));
DROP POLICY IF EXISTS "Teammates manage team walkthroughs" ON public.walkthroughs;
CREATE POLICY "Teammates manage team walkthroughs" ON public.walkthroughs
  FOR ALL
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = walkthroughs.project_id) AND are_teammates(auth.uid(), p.created_by)))));
DROP POLICY IF EXISTS "walkthroughs_delete" ON public.walkthroughs;
CREATE POLICY "walkthroughs_delete" ON public.walkthroughs
  FOR DELETE
  TO authenticated
  USING ((created_by = auth.uid()));
DROP POLICY IF EXISTS "walkthroughs_insert" ON public.walkthroughs;
CREATE POLICY "walkthroughs_insert" ON public.walkthroughs
  FOR INSERT
  TO authenticated
  WITH CHECK (((created_by = auth.uid()) AND (EXISTS ( SELECT 1
   FROM projects p
  WHERE ((p.id = walkthroughs.project_id) AND (p.created_by = auth.uid()))))));
DROP POLICY IF EXISTS "walkthroughs_update" ON public.walkthroughs;
CREATE POLICY "walkthroughs_update" ON public.walkthroughs
  FOR UPDATE
  TO authenticated
  USING ((created_by = auth.uid()))
  WITH CHECK ((created_by = auth.uid()));
REVOKE ALL ON public.walkthroughs FROM anon;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.walkthroughs TO authenticated;
GRANT DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE ON public.walkthroughs TO service_role;
