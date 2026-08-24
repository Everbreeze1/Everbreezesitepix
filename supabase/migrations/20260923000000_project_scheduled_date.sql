-- A JOB NEEDS A DAY BEFORE IT CAN SIT ON A CALENDAR.
--
-- The client, on the workspace Calendar tab:
--
--   "Right now there's no way to see what's happening across all jobs at once.
--    With dozens of active projects, there's no single place to answer 'what's
--    due today' or 'what's scheduled this week' without opening each project
--    individually."
--
-- Half of that was already answerable: `tasks.due_date` is a real calendar
-- date, so "what's due today" only needed a view that read every project's
-- tasks at once. The other half was not. A project sitting in a pipeline stage
-- called "Scheduled" carries no date anywhere: `pipeline_stages` says where a
-- job is in the process, never when it is booked, and `projects` had only
-- created_at / updated_at, which are both facts about the record rather than
-- about the work. So "scheduled this week" had no column to read.
--
-- This adds it. One nullable calendar date on the project, meaning "the day
-- this job is booked for". NULL means nobody has committed to a day yet, which
-- is the honest state for most of a pipeline and is what the calendar's
-- "Awaiting a date" rail lists.
--
-- ===========================================================================
-- WHY A `date` AND NOT A `timestamptz`
-- ===========================================================================
-- The same reason tasks.due_date is one, written up in
-- packages/shared/src/calendar-date.ts: "Tuesday the 22nd" is a calendar date,
-- not an instant. A timestamptz would make the day a crew is booked for shift
-- across a timezone boundary, and the whole point of the column is that the
-- office and the van agree about which day they are talking about. Times of
-- day are deliberately out of scope here: this answers "which day", and a job
-- that needs an arrival window is a later decision, not one to guess at now.
--
-- ===========================================================================
-- WHAT DELIBERATELY DOES NOT HAPPEN
-- ===========================================================================
-- No trigger ties this to `pipeline_stage_id`, in either direction. Dragging a
-- job into "Scheduled" does not invent a date for it, and setting a date does
-- not move it between columns. 20260922000000_pipeline_stage_status.sql made
-- the stage own `projects.status` because those two really were one fact
-- recorded twice; a stage and a date are two different facts, and a job can
-- legitimately be booked for the 22nd while still sitting at "Lead/Quoted".
--
-- No backfill either. There is no existing value anywhere that means "the day
-- this is booked for", so any guess (created_at, updated_at) would fill the
-- calendar with dates nobody chose, which is worse than an empty calendar.
--
-- RLS is untouched: this is a column on `projects`, so every existing policy
-- on the table already governs who can read and write it.
--
-- Apply via the Everlumen Supabase SQL editor (project ulmgvtuqjlzzadlwtiog).
-- Idempotent: safe to re-run.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS scheduled_date date;

-- The column turned out to already exist in at least one deployed database,
-- created outside this migrations folder and used by nothing. IF NOT EXISTS
-- means this file leaves that one alone, including its type, so say so rather
-- than assume: a timestamptz here hands the browser
-- "2026-08-20T00:00:00+00:00" where the calendar expects "2026-08-20", and
-- the day a job shows on then depends on the reader's timezone. The
-- conversion is deliberately NOT run automatically - it is a type change on a
-- live table, and it is the operator's call.
DO $$
DECLARE
  actual text;
BEGIN
  SELECT data_type INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'projects'
    AND column_name = 'scheduled_date';

  IF actual IS DISTINCT FROM 'date' THEN
    RAISE NOTICE
      'projects.scheduled_date is %, not date. The calendar reads it as a calendar date. To convert: ALTER TABLE public.projects ALTER COLUMN scheduled_date TYPE date USING scheduled_date::date;',
      actual;
  END IF;
END $$;

-- Partial, because the calendar only ever asks for the rows that have one and
-- in most workspaces that is a small slice of the table.
CREATE INDEX IF NOT EXISTS projects_scheduled_date_idx
  ON public.projects(scheduled_date)
  WHERE scheduled_date IS NOT NULL;

COMMENT ON COLUMN public.projects.scheduled_date IS
  'The calendar day this job is booked for. A date, not an instant, for the same reason tasks.due_date is: it must read as the same day in the office and in the van. NULL means no day has been committed to yet. Independent of pipeline_stage_id - a stage says where a job is in the process, this says when it happens.';
