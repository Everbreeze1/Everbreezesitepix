-- Structured context for a feedback report.
--
-- The Feedback page used to ask people to type "the project, device, and steps
-- you were taking" into a single freeform box, so all three arrived as prose
-- when they arrived at all. The page now asks for them separately: an optional
-- project picker, device details read from the browser, an optional screenshot,
-- and one text field for the narrative. These are the columns those land in.
--
-- Deliberately all nullable with no defaults. Every existing row predates them,
-- the in-app prompt (source = 'prompt') sets none of them, and the project
-- picker is optional even on the page.
--
-- Apply via the Everlumen Supabase SQL editor. Safe to re-run.
--
-- Until it is applied, submitFeedback (apps/web/src/lib/feedback.ts) detects
-- the missing columns, retries with the long-standing ones, and folds this
-- context into the description text, so the page keeps working either way.

-- 1. Columns.
ALTER TABLE public.issue_reports
  -- Which project the report is about. The id only: triage joins for the name,
  -- and the page tells the reporter that nothing else about the project is sent.
  ADD COLUMN IF NOT EXISTS project_id  uuid,
  -- Browser / OS / device / screen / viewport / time zone / language / raw UA,
  -- as read by lib/feedback-context.ts. jsonb rather than columns because it is
  -- read by a human during triage, not queried.
  ADD COLUMN IF NOT EXISTS client_info jsonb,
  -- Storage paths in the `feedback-attachments` bucket (see step 4).
  ADD COLUMN IF NOT EXISTS attachments text[];

-- 2. Reference the project so a deleted one does not leave a dangling id.
--    ON DELETE SET NULL, not CASCADE: a bug report outlives the project it was
--    filed against, and deleting a project must never delete evidence of a bug.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'issue_reports_project_id_fkey'
  ) THEN
    ALTER TABLE public.issue_reports
      ADD CONSTRAINT issue_reports_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. "Every report filed against this project", the one query the column adds.
--    Partial, because the overwhelming majority of rows have no project.
CREATE INDEX IF NOT EXISTS issue_reports_project_idx
  ON public.issue_reports(project_id, created_at DESC)
  WHERE project_id IS NOT NULL;

-- 4. Screenshots.
--
--    Private, unlike `company-logos`: a screenshot of a bug is a screenshot of
--    the reporter's own project data, and it must not be readable by URL. Triage
--    uses the service role, which bypasses RLS; the reporter can read back only
--    their own folder. 10 MB matches MAX_ATTACHMENT_BYTES in lib/feedback.ts.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'feedback-attachments',
  'feedback-attachments',
  false,
  10485760,
  ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Paths are `{auth_user_id}/{timestamp}-{n}-{name}`, matching the predicate
-- used by the company-logos policies in 20260815000100.
DROP POLICY IF EXISTS "Users upload own feedback attachments" ON storage.objects;
CREATE POLICY "Users upload own feedback attachments"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'feedback-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users read own feedback attachments" ON storage.objects;
CREATE POLICY "Users read own feedback attachments"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'feedback-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- No UPDATE or DELETE policy on purpose. Attachments are uploaded once, at
-- send time, under a timestamped path that never collides, and a reporter
-- deleting the screenshot out from under a report we are still working is not
-- something the product needs to support.
