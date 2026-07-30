-- Built-in "Example Templates" for the document/page template library.
--
-- Until now `document_templates` could only hold team-owned rows: the SELECT
-- policy required either `created_by = auth.uid()` or membership of a
-- non-null `team_id`, so a shared row with `team_id IS NULL` was invisible to
-- everyone. Example templates are modelled as `team_id IS NULL AND
-- created_by IS NULL` — readable by every authenticated user, writable by
-- nobody (the existing FOR ALL policy can never match a NULL `created_by`),
-- so "Duplicate" is the only way to get an editable copy.

-- 1. created_by must be nullable for ownerless built-ins.
ALTER TABLE public.document_templates ALTER COLUMN created_by DROP NOT NULL;

-- 2. Stable slug so re-running the seed updates in place instead of
--    duplicating. NULL for user/team templates; Postgres allows many NULLs
--    in a unique index.
ALTER TABLE public.document_templates ADD COLUMN IF NOT EXISTS slug text;
CREATE UNIQUE INDEX IF NOT EXISTS document_templates_slug_key
  ON public.document_templates(slug);

-- 3. Everyone can read the built-ins.
DROP POLICY IF EXISTS "Anyone can read example document templates" ON public.document_templates;
CREATE POLICY "Anyone can read example document templates"
  ON public.document_templates FOR SELECT TO authenticated
  USING (team_id IS NULL AND created_by IS NULL);

-- ---------------------------------------------------------------------------
-- 001 Timesheet: Labor Hours & Remittance
-- ---------------------------------------------------------------------------
-- Merge fields use SitePix's flat token vocabulary (see resolvePageTokens in
-- apps/api/src/domains/projects/pages.ts) and are resolved at read time, so a
-- renamed project updates every document that references it.
--
-- The photo slots are inline SVG data URIs with no `data-photo-id`. Clicking
-- one in the editor opens the project photo picker and swaps it in place;
-- any slot left unfilled is skipped by the PDF exporter (pdf-lib cannot embed
-- SVG), so placeholders never leak into a delivered document.
INSERT INTO public.document_templates (slug, team_id, created_by, name, body, fields)
VALUES (
  'example-001-timesheet',
  NULL,
  NULL,
  '001 Timesheet: Labor Hours & Remittance',
  jsonb_build_object(
    'style', 'report',
    'description', 'Weekly crew hours with rates and totals, proof-of-work photos, and a supervisor sign-off line.',
    'html', $html$<h2>Labor Hours &amp; Remittance</h2><p><strong>Project:</strong> {{project_name}} &nbsp;·&nbsp; <strong>Site:</strong> {{project_address}}</p><p><strong>Week ending:</strong> {{date}} &nbsp;·&nbsp; <strong>Prepared by:</strong> {{prepared_by}} &nbsp;·&nbsp; <strong>Company:</strong> {{company}}</p><table><tbody><tr><th><p>Name</p></th><th><p>Week / Ck #</p></th><th><p>Reg. hrs</p></th><th><p>OT hrs</p></th><th><p>Rate/hr</p></th><th><p>Amount</p></th><th><p>Role</p></th></tr><tr><td><p><em>e.g. R. Alvarez</em></p></td><td><p><em>6/22 – 6/28 · Ck 5612</em></p></td><td><p><em>37.5</em></p></td><td><p><em>2.0</em></p></td><td><p><em>$18.00</em></p></td><td><p><em>$729.00</em></p></td><td><p><em>Project manager</em></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td></tr><tr><td><p><strong>Total</strong></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p></p></td><td><p><strong>$0.00</strong></p></td><td><p></p></td></tr></tbody></table><h3>Attachments / proof of work</h3><p><img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='176' height='140'%3E%3Crect x='0.5' y='0.5' width='175' height='139' rx='6' fill='rgb(244,245,247)' stroke='rgb(203,208,216)' stroke-dasharray='5 4'/%3E%3Ctext x='88' y='68' font-family='sans-serif' font-size='12' font-weight='700' fill='rgb(107,114,128)' text-anchor='middle'%3EPhoto 1%3C/text%3E%3Ctext x='88' y='86' font-family='sans-serif' font-size='10' fill='rgb(156,163,175)' text-anchor='middle'%3EClick to add%3C/text%3E%3C/svg%3E" width="32%" height="140" alt="Photo slot 1"><img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='176' height='140'%3E%3Crect x='0.5' y='0.5' width='175' height='139' rx='6' fill='rgb(244,245,247)' stroke='rgb(203,208,216)' stroke-dasharray='5 4'/%3E%3Ctext x='88' y='68' font-family='sans-serif' font-size='12' font-weight='700' fill='rgb(107,114,128)' text-anchor='middle'%3EPhoto 2%3C/text%3E%3Ctext x='88' y='86' font-family='sans-serif' font-size='10' fill='rgb(156,163,175)' text-anchor='middle'%3EClick to add%3C/text%3E%3C/svg%3E" width="32%" height="140" alt="Photo slot 2"><img src="data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='176' height='140'%3E%3Crect x='0.5' y='0.5' width='175' height='139' rx='6' fill='rgb(244,245,247)' stroke='rgb(203,208,216)' stroke-dasharray='5 4'/%3E%3Ctext x='88' y='68' font-family='sans-serif' font-size='12' font-weight='700' fill='rgb(107,114,128)' text-anchor='middle'%3EPhoto 3%3C/text%3E%3Ctext x='88' y='86' font-family='sans-serif' font-size='10' fill='rgb(156,163,175)' text-anchor='middle'%3EClick to add%3C/text%3E%3C/svg%3E" width="32%" height="140" alt="Photo slot 3"></p><h3>Work performed</h3><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Task 1</p></li><li data-type="taskItem" data-checked="false"><p>Task 2</p></li><li data-type="taskItem" data-checked="false"><p>Task 3</p></li></ul><h3>Materials &amp; equipment used</h3><ul><li><p>Item or machine 1</p></li><li><p>Item or machine 2</p></li></ul><p></p><p><strong>Supervisor sign-off:</strong> ______________________________ &nbsp;&nbsp; <strong>Date:</strong> ______________</p>$html$
  ),
  ARRAY['company', 'date', 'prepared_by', 'project_address', 'project_name']
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    body = EXCLUDED.body,
    fields = EXCLUDED.fields,
    archived = false;
