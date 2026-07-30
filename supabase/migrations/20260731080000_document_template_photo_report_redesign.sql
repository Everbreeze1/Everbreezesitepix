-- Photo Report -- redesign of an existing, untracked example template
--
-- "Photo Report" already existed in the live document_templates table before
-- this migration (created some other way -- Settings > Document Templates,
-- or an earlier out-of-band seed -- there's no trace of it anywhere in this
-- repo's migrations). Its old design used a single blue "+ Click to add
-- photos" upload button per section; this replaces that with the same
-- numbered dashed photo-slot convention every other example template in
-- this family uses (see 20260730000000_document_template_examples.sql and
-- the 002-004 Pre-Built Report migrations), one slot per section, sized to
-- the full document width since there's no sibling slot in the row.
--
-- Since the existing row was created outside this migration history it has
-- no slug (only rows inserted by these migrations get one), so a plain
-- ON CONFLICT (slug) upsert would just add a second, duplicate "Photo
-- Report" entry instead of updating the original. Adopt it first: tag the
-- oldest untracked row named "Photo Report" with our slug, then upsert by
-- that slug as usual -- updates the adopted row if one existed, inserts
-- fresh otherwise.
--
-- Matched on team_id IS NULL only, not created_by: the app's own "Example
-- Templates" vs "Your Company" split (listDocumentTemplatesService) is keyed
-- on team_id alone, and the row appearing under "Example Templates" in the
-- screenshot confirms team_id is null here -- but if it was created via
-- Settings > Document Templates / "Save as a New Template" by a solo user
-- with no team, created_by would still be that user's real id, not null.
UPDATE public.document_templates
SET slug = 'example-photo-report-generic'
WHERE id = (
  SELECT id FROM public.document_templates
  WHERE name = 'Photo Report' AND slug IS NULL AND team_id IS NULL
  ORDER BY created_at ASC
  LIMIT 1
);

INSERT INTO public.document_templates (slug, team_id, created_by, name, body, fields)
VALUES (
  'example-photo-report-generic',
  NULL,
  NULL,
  'Photo Report',
  jsonb_build_object(
    'style', 'report',
    'description', 'Generic photo report template with placeholders for text and photos.',
    'html', $html$<h1>Photo Report</h1><h2>Section 1</h2><p><strong>Section Summary</strong></p><p>Placeholder Text</p><p><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'720'%20height%3D'320'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'719'%20height%3D'319'%20rx%3D'6'%20fill%3D'rgb(244%2C245%2C247)'%20stroke%3D'rgb(203%2C208%2C216)'%20stroke-dasharray%3D'5%204'%2F%3E%3Ctext%20x%3D'360'%20y%3D'152'%20font-family%3D'sans-serif'%20font-size%3D'14'%20font-weight%3D'700'%20fill%3D'rgb(107%2C114%2C128)'%20text-anchor%3D'middle'%3EPhoto%201%3C%2Ftext%3E%3Ctext%20x%3D'360'%20y%3D'172'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(156%2C163%2C175)'%20text-anchor%3D'middle'%3EClick%20to%20add%3C%2Ftext%3E%3C%2Fsvg%3E" width="100%" height="320" alt="Photo slot 1"></p><h2>Section 2</h2><p><strong>Section Summary</strong></p><p>Placeholder Text</p><p><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'720'%20height%3D'320'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'719'%20height%3D'319'%20rx%3D'6'%20fill%3D'rgb(244%2C245%2C247)'%20stroke%3D'rgb(203%2C208%2C216)'%20stroke-dasharray%3D'5%204'%2F%3E%3Ctext%20x%3D'360'%20y%3D'152'%20font-family%3D'sans-serif'%20font-size%3D'14'%20font-weight%3D'700'%20fill%3D'rgb(107%2C114%2C128)'%20text-anchor%3D'middle'%3EPhoto%202%3C%2Ftext%3E%3Ctext%20x%3D'360'%20y%3D'172'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(156%2C163%2C175)'%20text-anchor%3D'middle'%3EClick%20to%20add%3C%2Ftext%3E%3C%2Fsvg%3E" width="100%" height="320" alt="Photo slot 2"></p><h2>Section 3</h2><p><strong>Section Summary</strong></p><p>Placeholder Text</p><p><img src="data:image/svg+xml;utf8,%3Csvg%20xmlns%3D'http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg'%20width%3D'720'%20height%3D'320'%3E%3Crect%20x%3D'0.5'%20y%3D'0.5'%20width%3D'719'%20height%3D'319'%20rx%3D'6'%20fill%3D'rgb(244%2C245%2C247)'%20stroke%3D'rgb(203%2C208%2C216)'%20stroke-dasharray%3D'5%204'%2F%3E%3Ctext%20x%3D'360'%20y%3D'152'%20font-family%3D'sans-serif'%20font-size%3D'14'%20font-weight%3D'700'%20fill%3D'rgb(107%2C114%2C128)'%20text-anchor%3D'middle'%3EPhoto%203%3C%2Ftext%3E%3Ctext%20x%3D'360'%20y%3D'172'%20font-family%3D'sans-serif'%20font-size%3D'11'%20fill%3D'rgb(156%2C163%2C175)'%20text-anchor%3D'middle'%3EClick%20to%20add%3C%2Ftext%3E%3C%2Fsvg%3E" width="100%" height="320" alt="Photo slot 3"></p>$html$
  ),
  ARRAY[]::text[]
)
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    body = EXCLUDED.body,
    fields = EXCLUDED.fields,
    archived = false;
