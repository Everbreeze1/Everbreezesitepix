-- Split the AI Summary out of `walkthroughs` into an object of its own.
--
-- "Right now opening an 'AI Summary' from Reports loads at a /walkthroughs/{id}
-- URL with the tab title 'Walkthrough,' even when there's no video. These need
-- to be separate object types before anything else on this list will hold
-- together."
--
-- They were one table with a `source` discriminator, and every consequence of
-- that showed: a summary carried a duration of 0:00 and a null video_path it
-- could never use, the Walkthroughs tab could not offer separate Videos and
-- Summaries sections because both were the same row type, and the Reports tab
-- had no way to list one without the other. A discriminator column is not a
-- type, and the product had started asking it to be one.
--
-- After this:
--   walkthroughs           - a recording. Always has a walk behind it.
--   walkthrough_summaries  - the AI write-up. Optionally attached to a
--                            recording; a summary written from photos alone
--                            simply has a null walkthrough_id.
--
-- The notes live WITH their photos, in one `photo_notes` array, rather than as
-- a narration list beside a photo list. That is the other half of the client's
-- complaint and it is a data-shape problem, not a layout one: two lists in the
-- database become two lists on the page no matter how they are styled.

-- ===========================================================================
-- 0. LOCKS, TAKEN FIRST AND IN A FIXED ORDER
-- ===========================================================================
-- The first attempt at this migration deadlocked, and the reason is worth
-- writing down because it is not obvious.
--
-- It created `walkthrough_summaries` (which holds an ACCESS EXCLUSIVE lock on
-- the new table until commit) and only later asked for a lock on
-- `walkthroughs`. Meanwhile a running app session was doing the opposite: it
-- held a read lock on `walkthroughs` from `listProjectWalkthroughs` and then
-- asked to read `walkthrough_summaries`. Two sessions wanting the same two
-- tables in opposite orders is the whole definition of a deadlock, and Postgres
-- killed one of them.
--
-- Postgres cannot deadlock on locks that every session asks for in the same
-- order, so this migration asks for all of them first, before it does any work.
-- Same fix, and the same reasoning, as
-- 20260906000000_task_photo_items.sql.
--
-- If this fails with `55P03 lock_not_available` instead, nothing has been
-- applied and nothing is damaged: an app session was mid-read and did not let
-- go within the 5s below. Close any tab with a project open - or stop the dev
-- server - and run it again. Everything in this file is idempotent, so
-- re-running after a failure is the intended way to recover, not a risk.
SET lock_timeout = '5s';

LOCK TABLE public.walkthroughs IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.walkthrough_photos IN ACCESS EXCLUSIVE MODE;

-- Only on a re-run: on a first run the table does not exist yet, and naming it
-- in a LOCK statement would be a parse-time failure rather than a no-op.
DO $$
BEGIN
  IF to_regclass('public.walkthrough_summaries') IS NOT NULL THEN
    EXECUTE 'LOCK TABLE public.walkthrough_summaries IN ACCESS EXCLUSIVE MODE';
  END IF;
END $$;

-- ===========================================================================
-- 1. THE TABLE
-- ===========================================================================
create table if not exists public.walkthrough_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  /*
   * The recording this summarises, or null when there is no walk behind it.
   *
   * `on delete set null` rather than cascade: deleting a recording to free the
   * storage must not silently take the written summary with it. The summary is
   * the artefact a client was sent; the video is the raw material.
   */
  walkthrough_id uuid references public.walkthroughs(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null,
  markdown text,
  /* 'generating' | 'ready' | 'failed' - same vocabulary as walkthroughs.status. */
  status text not null default 'ready',
  /*
   * [{ "photoId": uuid, "offsetSeconds": int, "note": text, "spoken": text|null }]
   *
   * One entry per captured photo, in timeline order, each carrying its own
   * note. `spoken` is null when nobody spoke near that moment, which is what
   * lets the UI render a narrated shot differently from a silent one.
   */
  photo_notes jsonb not null default '[]'::jsonb,
  /* What was said, kept on the summary so it survives deleting the recording. */
  transcript text,
  share_token uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_walkthrough_summaries_project
  on public.walkthrough_summaries (project_id, created_at desc);
create index if not exists idx_walkthrough_summaries_walkthrough
  on public.walkthrough_summaries (walkthrough_id);
-- The public share route looks up by token and nothing else.
create unique index if not exists idx_walkthrough_summaries_share_token
  on public.walkthrough_summaries (share_token) where share_token is not null;

comment on table public.walkthrough_summaries is
  'The AI write-up of a walkthrough, or of a set of photos. Split out of walkthroughs so a summary and a recording are separate object types.';

-- ===========================================================================
-- 2. updated_at
-- ===========================================================================
-- Same trigger function the rest of the schema uses.
DROP TRIGGER IF EXISTS trg_walkthrough_summaries_updated_at ON public.walkthrough_summaries;
CREATE TRIGGER trg_walkthrough_summaries_updated_at
  BEFORE UPDATE ON public.walkthrough_summaries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ===========================================================================
-- 3. RLS
-- ===========================================================================
-- Mirrors `walkthroughs` exactly, including the created_by escape hatch that
-- keeps an author's own work reachable when the project row has gone. Anything
-- that can read a walkthrough can read its summary, and nothing else can.
ALTER TABLE public.walkthrough_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Teammates manage team walkthrough summaries" ON public.walkthrough_summaries;
CREATE POLICY "Teammates manage team walkthrough summaries" ON public.walkthrough_summaries
  FOR ALL TO authenticated USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id AND public.are_teammates(auth.uid(), p.created_by)
    )
  );

-- The restricted-role trio, matching 20260913000000_restricted_role_no_delete.sql:
-- read, create and amend on a project they are assigned to, but never delete.
DROP POLICY IF EXISTS "Restricted members view assigned summaries" ON public.walkthrough_summaries;
CREATE POLICY "Restricted members view assigned summaries" ON public.walkthrough_summaries
  FOR SELECT TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members add assigned summaries" ON public.walkthrough_summaries;
CREATE POLICY "Restricted members add assigned summaries" ON public.walkthrough_summaries
  FOR INSERT TO authenticated
  WITH CHECK (public.member_can_reach_project(auth.uid(), project_id));

DROP POLICY IF EXISTS "Restricted members amend assigned summaries" ON public.walkthrough_summaries;
CREATE POLICY "Restricted members amend assigned summaries" ON public.walkthrough_summaries
  FOR UPDATE TO authenticated
  USING (public.member_can_reach_project(auth.uid(), project_id));

/*
 * REVOKE before GRANT, and this one is not boilerplate.
 *
 * Supabase ships `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES
 * TO anon`, so a public table is readable by the publishable key - which ships
 * in the browser bundle - from the moment it exists. RLS does not save it,
 * because the grant is checked first.
 *
 * That is precisely how `walkthroughs` and `walkthrough_photos` leaked once
 * before, share tokens included, and this table carries a `share_token` of its
 * own. `tests/invariants.test.ts` fails any post-20260811 migration that
 * creates a public table without this line, and it caught this one.
 */
REVOKE ALL ON public.walkthrough_summaries FROM anon, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.walkthrough_summaries TO authenticated;

-- ===========================================================================
-- 4. MOVE THE EXISTING SUMMARIES ACROSS
-- ===========================================================================
-- One statement, so a partial move is impossible.
--
-- `share_token` comes across unchanged. That is what keeps the links already
-- sent to clients working: the public share route looks the token up in this
-- table as well as in `walkthroughs`, so a URL a customer already holds still
-- resolves to the same document after the row has moved.
DO $$
DECLARE
  _moved integer;
BEGIN
  WITH moved AS (
    INSERT INTO public.walkthrough_summaries (
      project_id, walkthrough_id, created_by, title, markdown, status,
      photo_notes, transcript, share_token, created_at, updated_at
    )
    SELECT
      w.project_id,
      -- A summary written from photos has no recording behind it, and these
      -- rows never had one: `source = 'summary'` IS that fact.
      NULL,
      w.created_by,
      w.title,
      w.summary_markdown,
      COALESCE(w.status, 'ready'),
      COALESCE(
        (
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'photoId',       wp.photo_id,
                     'offsetSeconds', COALESCE(wp.offset_seconds, 0),
                     'note',          COALESCE(wp.spoken_note, ''),
                     'spoken',        wp.spoken_note
                   )
                   ORDER BY wp.position, wp.created_at
                 )
          FROM public.walkthrough_photos wp
          WHERE wp.walkthrough_id = w.id
        ),
        '[]'::jsonb
      ),
      w.transcript,
      w.share_token,
      w.created_at,
      w.updated_at
    FROM public.walkthroughs w
    WHERE w.source = 'summary'
      -- Idempotent: a second run moves nothing, because the token or the
      -- (project, title, created_at) triple is already present.
      AND NOT EXISTS (
        SELECT 1 FROM public.walkthrough_summaries s
        WHERE s.project_id = w.project_id
          AND s.title = w.title
          AND s.created_at = w.created_at
      )
    RETURNING 1
  )
  SELECT count(*) INTO _moved FROM moved;

  -- The originals go, so nothing lists them as recordings. Their photo links
  -- go with them; the photos themselves are untouched - they are the user's
  -- own gallery photos and belong to the project, not to the summary.
  DELETE FROM public.walkthrough_photos
   WHERE walkthrough_id IN (SELECT id FROM public.walkthroughs WHERE source = 'summary');

  DELETE FROM public.walkthroughs WHERE source = 'summary';

  RAISE NOTICE 'walkthrough summaries moved out of walkthroughs: %', _moved;
END $$;

-- ===========================================================================
-- 5. WALKTHROUGHS IS NOW RECORDINGS ONLY
-- ===========================================================================
-- `source` is left in place rather than dropped: older deployed bundles still
-- select it, and a column that always reads 'recorded' is harmless where a
-- missing one is a 400 from PostgREST on every walkthrough query.
--
-- There is deliberately no `ALTER COLUMN source SET DEFAULT 'recorded'` here.
-- It was in the first draft, and it was the statement that deadlocked - for
-- nothing, because 20260814000000_walkthrough_source.sql already set that
-- exact default on line 43. It changed no value and took an ACCESS EXCLUSIVE
-- lock on the busiest table in the schema to do it.
comment on column public.walkthroughs.source is
  'Vestigial. Always ''recorded'' since 20261003000000 split summaries into walkthrough_summaries.';

-- ===========================================================================
-- 6. LET PostgREST SEE THE NEW TABLE
-- ===========================================================================
-- The schema cache is what answers `/rest/v1/walkthrough_summaries`, and it is
-- only rebuilt when told. Without this the app's summary calls 404 until
-- something else happens to reload it, which reads as "the migration did not
-- work".
NOTIFY pgrst, 'reload schema';
